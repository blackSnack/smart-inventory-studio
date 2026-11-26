import type {Journal,JournalStore} from './operation-journal.js';
type Row={instanceId:string;planId:string;journal:Journal};
const STORE='operations';
function validate(j:Journal,instanceId:string,planId:string){
 if(j.plan.instanceId!==instanceId||j.plan.id!==planId||!Number.isSafeInteger(j.revision)||j.revision<0||j.steps.length!==j.plan.operations.length||j.steps.some((s,i)=>s.operation.id!==j.plan.operations[i].id))throw Error('invalid journal scope or structure');
}
export class IndexedDbJournalStore implements JournalStore{
 private constructor(private db:IDBDatabase,private instanceId:string){}
 static open(instanceId:string,databaseName='smart-inventory-journal-v1',factory:IDBFactory=indexedDB):Promise<IndexedDbJournalStore>{
  if(!instanceId.trim()||!databaseName.trim())return Promise.reject(Error('invalid database scope'));
  return new Promise((resolve,reject)=>{const req=factory.open(databaseName,1);req.onupgradeneeded=()=>{req.result.createObjectStore(STORE,{keyPath:['instanceId','planId']}).createIndex('instanceId','instanceId')};req.onerror=()=>reject(req.error);req.onblocked=()=>reject(Error('journal database blocked'));req.onsuccess=()=>{const db=req.result;db.onversionchange=()=>db.close();resolve(new IndexedDbJournalStore(db,instanceId))}});
 }
 close(){this.db.close()}
 async create(journal:Journal):Promise<void>{
  validate(journal,this.instanceId,journal.plan.id);if(journal.revision!==0||journal.steps.some(s=>s.state!=='planned'))throw Error('new journal must start planned');
  return new Promise((resolve,reject)=>{const tx=this.db.transaction(STORE,'readwrite');tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error??Error('journal create aborted'));tx.objectStore(STORE).add({instanceId:this.instanceId,planId:journal.plan.id,journal:structuredClone(journal)} satisfies Row)});
 }
 async read(id:string):Promise<Journal>{
  return new Promise((resolve,reject)=>{const tx=this.db.transaction(STORE,'readonly');const req=tx.objectStore(STORE).get([this.instanceId,id]);req.onsuccess=()=>{const row=req.result as Row|undefined;if(!row){reject(Error('journal not found'));return}try{validate(row.journal,this.instanceId,id);resolve(row.journal)}catch(e){reject(e)}};req.onerror=()=>reject(req.error)});
 }
 async compareAndSet(id:string,revision:number,next:Journal):Promise<boolean>{
  validate(next,this.instanceId,id);if(!Number.isSafeInteger(revision)||next.revision!==revision+1)throw Error('invalid revision increment');
  return new Promise((resolve,reject)=>{const tx=this.db.transaction(STORE,'readwrite');const store=tx.objectStore(STORE);let changed=false;tx.oncomplete=()=>resolve(changed);tx.onabort=()=>reject(tx.error??Error('journal CAS aborted'));const req=store.get([this.instanceId,id]);req.onsuccess=()=>{const row=req.result as Row|undefined;if(!row||row.journal.revision!==revision)return;
   try{validate(row.journal,this.instanceId,id);if(JSON.stringify(row.journal.plan)!==JSON.stringify(next.plan))throw Error('approved plan cannot change');const indexes=next.steps.flatMap((s,i)=>JSON.stringify(s)!==JSON.stringify(row.journal.steps[i])?[i]:[]);if(indexes.length!==1)throw Error('one journal transition required');const i=indexes[0],before=row.journal.steps[i],after=next.steps[i];if(JSON.stringify(before.operation)!==JSON.stringify(after.operation))throw Error('operation cannot change');const allowed=before.state==='planned'?['sent']:before.state==='sent'?['verified','unknown','blocked']:before.state==='unknown'?['verified','unknown','blocked']:[];if(!allowed.includes(after.state)||after.state!=='sent'&&!after.evidence?.trim()||row.journal.steps.slice(0,i).some(s=>s.state!=='verified'))throw Error('invalid journal transition');store.put({instanceId:this.instanceId,planId:id,journal:structuredClone(next)} satisfies Row);changed=true}catch{tx.abort()}
  }});
 }
 async pending():Promise<Journal[]>{
  return new Promise((resolve,reject)=>{const tx=this.db.transaction(STORE,'readonly'),req=tx.objectStore(STORE).index('instanceId').getAll(this.instanceId);req.onerror=()=>reject(req.error);req.onsuccess=()=>{try{const rows=(req.result as Row[]).filter(r=>r.instanceId===this.instanceId);for(const r of rows)validate(r.journal,this.instanceId,r.planId);resolve(rows.map(r=>r.journal).filter(j=>j.steps.some(s=>s.state!=='verified')))}catch(e){reject(e)}}});
 }
}
