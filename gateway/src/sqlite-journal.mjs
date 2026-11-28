import {snapshotKey} from '../../dist/approved-snapshot.js';

function pack(value) {
  if(value===undefined)return ['u'];
  if(value===null)return ['n'];
  if(typeof value==='string'||typeof value==='boolean')return ['p',value];
  if(typeof value==='number'){if(!Number.isFinite(value))throw Error('invalid journal numeric value');return ['d',Object.is(value,-0)?'-0':String(value)]}
  if(Array.isArray(value))return ['a',value.map(pack)];
  if(typeof value==='object'&&(Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null)){
    return ['o',Object.keys(value).sort().map(key=>[key,pack(value[key])])];
  }
  throw Error('invalid journal data');
}

function unpack(value) {
  if(!Array.isArray(value)||typeof value[0]!=='string')throw Error('invalid stored journal encoding');
  if(value[0]==='u'&&value.length===1)return undefined;
  if(value[0]==='n'&&value.length===1)return null;
  if(value[0]==='p'&&value.length===2&&(typeof value[1]==='string'||typeof value[1]==='boolean'))return value[1];
  if(value[0]==='d'&&value.length===2&&typeof value[1]==='string'){
    const number=value[1]==='-0'?-0:Number(value[1]);
    if(Number.isFinite(number)&&String(number)===value[1]||value[1]==='-0')return number;
  }
  if(value[0]==='a'&&value.length===2&&Array.isArray(value[1]))return value[1].map(unpack);
  if(value[0]==='o'&&value.length===2&&Array.isArray(value[1])){
    const out={};
    for(const entry of value[1]){
      if(!Array.isArray(entry)||entry.length!==2||typeof entry[0]!=='string'||Object.hasOwn(out,entry[0]))throw Error('invalid stored journal object');
      Object.defineProperty(out,entry[0],{value:unpack(entry[1]),enumerable:true,writable:true,configurable:true});
    }
    return out;
  }
  throw Error('invalid stored journal encoding');
}

const serialize=value=>JSON.stringify(pack(value));
const deserialize=value=>unpack(JSON.parse(value));

function validate(journal,instanceId,planId) {
  const p=journal?.plan;
  if(!p||p.instanceId!==instanceId||p.id!==planId||
      ![p.id,p.instanceId,p.catalogHash,p.snapshotHash,p.approvalId].every(v=>typeof v==='string'&&v.trim())||
      !Number.isSafeInteger(journal.revision)||journal.revision<0||
      !Array.isArray(p.operations)||!p.operations.length||
      new Set(p.operations.map(o=>o.id)).size!==p.operations.length||
      p.operations.some(o=>!o||typeof o.id!=='string'||!o.id.trim()||typeof o.kind!=='string'||!o.kind.trim()||
        !o.payload||typeof o.payload!=='object'||Array.isArray(o.payload))||
      !Array.isArray(journal.steps)||journal.steps.length!==p.operations.length||
      journal.steps.some((s,i)=>snapshotKey(s.operation)!==snapshotKey(p.operations[i])))throw Error('invalid journal scope or structure');
  const first=journal.steps.findIndex(s=>s.state!=='verified');
  if(journal.steps.some((s,i)=>!['planned','sent','verified','unknown','blocked'].includes(s.state)||
      (['verified','unknown','blocked'].includes(s.state)&&(typeof s.evidence!=='string'||!s.evidence.trim()))||
      (first>=0&&i>first&&s.state!=='planned')))throw Error('invalid journal step state');
  if(journal.abandonment){
    const i=journal.abandonment.firstUnsent;
    if(!Number.isSafeInteger(i)||i<0||i>=journal.steps.length||!journal.abandonment.evidence?.trim()||
        journal.steps.slice(0,i).some(s=>s.state!=='verified')||
        journal.steps.slice(i).some(s=>s.state!=='planned'))throw Error('invalid stopped remainder');
  }
}

function transaction(db,action) {
  db.exec('BEGIN IMMEDIATE');
  try {const value=action();db.exec('COMMIT');return value}
  catch(error){try{db.exec('ROLLBACK')}catch{}throw error}
}

export class SQLiteJournalStore {
  constructor(db,instanceId) {
    if(typeof instanceId!=='string'||!instanceId.trim()||instanceId.length>256)throw Error('invalid journal instance');
    this.db=db;this.instanceId=instanceId;
  }
  create(journal) {
    const approved=structuredClone(journal);
    validate(approved,this.instanceId,approved.plan.id);
    if(approved.revision!==0||approved.abandonment||approved.steps.some(s=>s.state!=='planned'))throw Error('new journal must start planned');
    return transaction(this.db,()=>{
      const rows=this.db.prepare('SELECT plan_id,journal_json FROM gateway_journals WHERE instance_id=?').all(this.instanceId);
      const ids=new Set(approved.plan.operations.map(o=>o.id));
      for(const row of rows){
        const existing=deserialize(row.journal_json);validate(existing,this.instanceId,row.plan_id);
        if(existing.plan.operations.some(o=>ids.has(o.id)))throw Error('operation ID already used for this inventory instance');
        if(!existing.abandonment&&existing.steps.some(s=>s.state!=='verified'))throw Error('another operation is pending for this inventory instance');
      }
      this.db.prepare('INSERT INTO gateway_journals(instance_id,plan_id,revision,journal_json,updated_at) VALUES(?,?,?,?,?)')
        .run(this.instanceId,approved.plan.id,approved.revision,serialize(approved),Date.now());
      for(const operation of approved.plan.operations){
        this.db.prepare('INSERT INTO gateway_journal_operation_ids(instance_id,operation_id,plan_id) VALUES(?,?,?)')
          .run(this.instanceId,operation.id,approved.plan.id);
      }
    });
  }
  read(id) {
    const row=this.db.prepare('SELECT plan_id,journal_json FROM gateway_journals WHERE instance_id=? AND plan_id=?').get(this.instanceId,id);
    if(!row)throw Error('journal not found');
    const journal=deserialize(row.journal_json);validate(journal,this.instanceId,id);return journal;
  }
  compareAndSet(id,revision,next) {
    const approved=structuredClone(next);
    validate(approved,this.instanceId,id);
    if(!Number.isSafeInteger(revision)||approved.revision!==revision+1)throw Error('invalid revision increment');
    return transaction(this.db,()=>{
      const row=this.db.prepare('SELECT revision,journal_json FROM gateway_journals WHERE instance_id=? AND plan_id=?').get(this.instanceId,id);
      if(!row||row.revision!==revision)return false;
      const current=deserialize(row.journal_json);validate(current,this.instanceId,id);
      if(snapshotKey(current.plan)!==snapshotKey(approved.plan)||current.abandonment)throw Error('approved or stopped plan cannot change');
      if(approved.abandonment){
        if(snapshotKey(current.steps)!==snapshotKey(approved.steps))throw Error('stop cannot change steps');
        const i=approved.abandonment.firstUnsent;
        if(!Number.isSafeInteger(i)||i<0||i>=current.steps.length||!approved.abandonment.evidence?.trim()||
            current.steps.slice(0,i).some(s=>s.state!=='verified')||
            current.steps.slice(i).some(s=>s.state!=='planned'))throw Error('invalid stopped remainder');
      } else {
        const changed=approved.steps.flatMap((s,i)=>snapshotKey(s)!==snapshotKey(current.steps[i])?[i]:[]);
        if(changed.length!==1)throw Error('one journal transition required');
        const i=changed[0],before=current.steps[i],after=approved.steps[i];
        if(snapshotKey(before.operation)!==snapshotKey(after.operation))throw Error('operation cannot change');
        const allowed=before.state==='planned'?['sent']:before.state==='sent'?['verified','unknown','blocked']:
          before.state==='unknown'||before.state==='blocked'?['verified','unknown','blocked']:[];
        if(!allowed.includes(after.state)||(after.state!=='sent'&&!after.evidence?.trim())||
            current.steps.slice(0,i).some(s=>s.state!=='verified'))throw Error('invalid journal transition');
      }
      const result=this.db.prepare('UPDATE gateway_journals SET revision=?,journal_json=?,updated_at=? WHERE instance_id=? AND plan_id=? AND revision=?')
        .run(approved.revision,serialize(approved),Date.now(),this.instanceId,id,revision);
      return result.changes===1;
    });
  }
  async pending() {
    return this.all().filter(j=>!j.abandonment&&j.steps.some(s=>s.state!=='verified'));
  }
  async stopped() {
    return this.all().filter(j=>!!j.abandonment);
  }
  all() {
    return this.db.prepare('SELECT plan_id,journal_json FROM gateway_journals WHERE instance_id=?').all(this.instanceId)
      .map(row=>{const journal=deserialize(row.journal_json);validate(journal,this.instanceId,row.plan_id);return journal});
  }
}
