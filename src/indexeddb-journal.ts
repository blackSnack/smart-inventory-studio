import type {Journal,JournalStore} from './operation-journal.js';
type Row={instanceId:string;planId:string;journal:Journal};
const STORE='operations';
function validate(j:Journal,instanceId:string,planId:string){
 const p=j.plan;
 if(p.instanceId!==instanceId||p.id!==planId||![p.id,p.instanceId,p.catalogHash,p.snapshotHash,p.approvalId].every(v=>typeof v==='string'&&v.trim())||!Number.isSafeInteger(j.revision)||j.revision<0||!Array.isArray(p.operations)||!p.operations.length||new Set(p.operations.map(o=>o.id)).size!==p.operations.length||p.operations.some(o=>!o.id||!o.kind)||!Array.isArray(j.steps)||j.steps.length!==p.operations.length||j.steps.some((s,i)=>JSON.stringify(s.operation)!==JSON.stringify(p.operations[i])))throw Error('invalid journal scope or structure');
 const first=j.steps.findIndex(s=>s.state!=='verified');
 if(j.steps.some((s,i)=>!['planned','sent','verified','unknown','blocked'].includes(s.state)||(['verified','unknown','blocked'].includes(s.state)&&(typeof s.evidence!=='string'||!s.evidence.trim()))||(first>=0&&i>first&&s.state!=='planned')))throw Error('invalid journal step state');
 if(j.abandonment){const i=j.abandonment.firstUnsent;if(!Number.isSafeInteger(i)||i<0||i>=j.steps.length||!j.abandonment.evidence?.trim()||j.steps.slice(0,i).some(s=>s.state!=='verified')||j.steps.slice(i).some(s=>s.state!=='planned'))throw Error('invalid stopped remainder');}
}
export class IndexedDbJournalStore implements JournalStore{
 private constructor(private db:IDBDatabase,private instanceId:string){}
 static open(instanceId:string,databaseName='smart-inventory-journal-v1',factory:IDBFactory=indexedDB):Promise<IndexedDbJournalStore>{
  if(!instanceId.trim()||!databaseName.trim())return Promise.reject(Error('invalid database scope'));
  return new Promise((resolve,reject)=>{const req=factory.open(databaseName,1);req.onupgradeneeded=()=>{req.result.createObjectStore(STORE,{keyPath:['instanceId','planId']}).createIndex('instanceId','instanceId')};req.onerror=()=>reject(req.error);req.onblocked=()=>reject(Error('journal database blocked'));req.onsuccess=()=>{const db=req.result;db.onversionchange=()=>db.close();resolve(new IndexedDbJournalStore(db,instanceId))}});
 }
 close(){this.db.close()}
 async create(journal:Journal):Promise<void>{
  const approved=structuredClone(journal);validate(approved,this.instanceId,approved.plan.id);if(approved.revision!==0||approved.abandonment||approved.steps.some(s=>s.state!=='planned'))throw Error('new journal must start planned');
  // Admission and insertion share one readwrite transaction across tabs. A UI pending() check alone is not atomic.
  return new Promise((resolve,reject)=>{const tx=this.db.transaction(STORE,'readwrite'),store=tx.objectStore(STORE);let failure:unknown;tx.oncomplete=()=>resolve();tx.onabort=()=>reject(failure??tx.error??Error('journal create aborted'));
   const req=store.index('instanceId').getAll(this.instanceId);req.onsuccess=()=>{try{for(const row of req.result as Row[]){validate(row.journal,this.instanceId,row.planId);if(!row.journal.abandonment&&row.journal.steps.some(s=>s.state!=='verified'))throw Error('another operation is pending for this inventory instance')}store.add({instanceId:this.instanceId,planId:approved.plan.id,journal:approved} satisfies Row)}catch(e){failure=e;tx.abort()}};
  });
 }
 async read(id:string):Promise<Journal>{
  return new Promise((resolve,reject)=>{const tx=this.db.transaction(STORE,'readonly');const req=tx.objectStore(STORE).get([this.instanceId,id]);req.onsuccess=()=>{const row=req.result as Row|undefined;if(!row){reject(Error('journal not found'));return}try{validate(row.journal,this.instanceId,id);resolve(row.journal)}catch(e){reject(e)}};req.onerror=()=>reject(req.error)});
 }
 async compareAndSet(id:string,revision:number,next:Journal):Promise<boolean>{
  next=structuredClone(next);validate(next,this.instanceId,id);if(!Number.isSafeInteger(revision)||next.revision!==revision+1)throw Error('invalid revision increment');
  return new Promise((resolve,reject)=>{const tx=this.db.transaction(STORE,'readwrite');const store=tx.objectStore(STORE);let changed=false;tx.oncomplete=()=>resolve(changed);tx.onabort=()=>reject(tx.error??Error('journal CAS aborted'));const req=store.get([this.instanceId,id]);req.onsuccess=()=>{const row=req.result as Row|undefined;if(!row||row.journal.revision!==revision)return;
   try{validate(row.journal,this.instanceId,id);if(JSON.stringify(row.journal.plan)!==JSON.stringify(next.plan)||row.journal.abandonment)throw Error('approved or stopped plan cannot change');if(next.abandonment){if(JSON.stringify(row.journal.steps)!==JSON.stringify(next.steps))throw Error('stop cannot change steps');store.put({instanceId:this.instanceId,planId:id,journal:structuredClone(next)} satisfies Row);changed=true;return}const indexes=next.steps.flatMap((s,i)=>JSON.stringify(s)!==JSON.stringify(row.journal.steps[i])?[i]:[]);if(indexes.length!==1)throw Error('one journal transition required');const i=indexes[0],before=row.journal.steps[i],after=next.steps[i];if(JSON.stringify(before.operation)!==JSON.stringify(after.operation))throw Error('operation cannot change');const allowed=before.state==='planned'?['sent']:before.state==='sent'?['verified','unknown','blocked']:before.state==='unknown'||before.state==='blocked'?['verified','unknown','blocked']:[];if(!allowed.includes(after.state)||after.state!=='sent'&&!after.evidence?.trim()||row.journal.steps.slice(0,i).some(s=>s.state!=='verified'))throw Error('invalid journal transition');store.put({instanceId:this.instanceId,planId:id,journal:structuredClone(next)} satisfies Row);changed=true}catch{tx.abort()}
  }});
 }
 async pending():Promise<Journal[]>{return (await this.all()).filter(j=>!j.abandonment&&j.steps.some(s=>s.state!=='verified'))}
 async stopped():Promise<Journal[]>{return (await this.all()).filter(j=>!!j.abandonment)}
 private async all():Promise<Journal[]>{
  return new Promise((resolve,reject)=>{const tx=this.db.transaction(STORE,'readonly'),req=tx.objectStore(STORE).index('instanceId').getAll(this.instanceId);req.onerror=()=>reject(req.error);req.onsuccess=()=>{try{const rows=(req.result as Row[]).filter(r=>r.instanceId===this.instanceId);for(const r of rows)validate(r.journal,this.instanceId,r.planId);resolve(rows.map(r=>r.journal))}catch(e){reject(e)}}});
 }
}
