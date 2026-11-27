import type {BrowserWorkStore,BrowserWorkRecord,NativeWorkResult,NativeQueueItem} from './browser-native-workflow.js';
type Row=BrowserWorkRecord&{scope:string;id:string};
const STORE='native-operations',QUEUE='native-queues';
export class IndexedDbNativeWorkStore implements BrowserWorkStore{
 private constructor(private db:IDBDatabase){}
 static open(factory:IDBFactory=indexedDB,databaseName='smart-inventory-native-acceptance-v1'):Promise<IndexedDbNativeWorkStore>{
  return new Promise((resolve,reject)=>{const r=factory.open(databaseName,2);r.onupgradeneeded=()=>{if(!r.result.objectStoreNames.contains(STORE))r.result.createObjectStore(STORE,{keyPath:['scope','id']}).createIndex('scope','scope');if(!r.result.objectStoreNames.contains(QUEUE))r.result.createObjectStore(QUEUE,{keyPath:'scope'})};r.onerror=()=>reject(r.error);r.onblocked=()=>reject(Error('native journal blocked'));r.onsuccess=()=>{r.result.onversionchange=()=>r.result.close();resolve(new IndexedDbNativeWorkStore(r.result))}});
 }
 close(){this.db.close()}
 async getQueue(scope:string):Promise<NativeQueueItem[]>{
  return new Promise((resolve,reject)=>{const r=this.db.transaction(QUEUE).objectStore(QUEUE).get(scope);r.onsuccess=()=>resolve(r.result?.items??[]);r.onerror=()=>reject(r.error)});
 }
 async saveQueue(scope:string,items:NativeQueueItem[]){
  const copy=structuredClone(items);if(!scope||!copy.length||copy.length>1000||new Set(copy.map(x=>x.id)).size!==copy.length||copy.some(x=>typeof x.id!=='string'||!x.id||x.id.length>128))throw Error('invalid native queue');
  for(let i=0;i<copy.length;i++){const x=copy[i];if(x.kind==='after-part-create'&&!copy.slice(0,i).some(p=>p.id===x.createId&&p.kind==='create-part'))throw Error('missing preceding Part creation')}
  return new Promise<void>((resolve,reject)=>{const tx=this.db.transaction([QUEUE,STORE],'readwrite'),q=tx.objectStore(QUEUE),s=tx.objectStore(STORE);let error:unknown;tx.oncomplete=()=>resolve();tx.onabort=()=>reject(error??tx.error??Error('queue save failed'));
   const r=q.get(scope);r.onsuccess=()=>{if(r.result){error=Error('existing queue must be resumed or stopped');tx.abort();return}const h=s.index('scope').getAll(scope);h.onsuccess=()=>{const rows=h.result as Row[];if(rows.some(x=>copy.some(i=>i.id===x.id)||x.state==='reviewed'||x.state==='sent'||x.state==='unknown'||x.state==='blocked'&&x.ackBinding!==undefined)){error=Error('unresolved or repeated operation');tx.abort();return}q.add({scope,items:copy})}};
  });
 }
 // Only independently verified prefix entries can be removed automatically.
 async resumeQueue(scope:string):Promise<NativeQueueItem[]>{
  return new Promise((resolve,reject)=>{const tx=this.db.transaction([QUEUE,STORE],'readwrite'),q=tx.objectStore(QUEUE),s=tx.objectStore(STORE);let items:NativeQueueItem[]=[];tx.oncomplete=()=>resolve(items);tx.onabort=()=>reject(tx.error??Error('queue resume failed'));const r=q.get(scope);r.onsuccess=()=>{if(!r.result)return;items=r.result.items;const step=()=>{if(!items.length){q.delete(scope);return}const h=s.get([scope,items[0].id]);h.onsuccess=()=>{if(h.result?.state==='verified'){items=items.slice(1);step()}else q.put({scope,items})}};step()}});
 }
 async stopQueue(scope:string,expectedHead:string){
  return new Promise<void>((resolve,reject)=>{const tx=this.db.transaction([QUEUE,STORE],'readwrite'),q=tx.objectStore(QUEUE);let error:unknown;tx.oncomplete=()=>resolve();tx.onabort=()=>reject(error??tx.error??Error('queue stop failed'));const r=q.get(scope);r.onsuccess=()=>{if(r.result?.items?.[0]?.id!==expectedHead){error=Error('queue changed; reload');tx.abort();return}q.delete(scope)}});
 }
 async list(scope:string):Promise<BrowserWorkRecord[]>{
  return new Promise((resolve,reject)=>{const r=this.db.transaction(STORE).objectStore(STORE).index('scope').getAll(scope);r.onsuccess=()=>resolve(r.result as Row[]);r.onerror=()=>reject(r.error)});
 }
 async get(scope:string,id:string):Promise<BrowserWorkRecord|undefined>{
  return new Promise((resolve,reject)=>{const r=this.db.transaction(STORE).objectStore(STORE).get([scope,id]);r.onsuccess=()=>resolve(r.result as Row|undefined);r.onerror=()=>reject(r.error)});
 }
 async admit(record:BrowserWorkRecord){
  const p=structuredClone(record),scope=p.preparation.scope,id=p.preparation.id;
  if(p.state!=='reviewed'||!id||!scope)throw Error('invalid native journal admission');
  return new Promise<void>((resolve,reject)=>{const tx=this.db.transaction([STORE,QUEUE],'readwrite'),s=tx.objectStore(STORE),q=tx.objectStore(QUEUE);let error:unknown;tx.oncomplete=()=>resolve();tx.onabort=()=>reject(error??tx.error??Error('native admission failed'));
   const queue=q.get(scope);queue.onsuccess=()=>{if(queue.result?.items?.[0]?.id!==id){error=Error('queue changed or stopped');tx.abort();return}const r=s.index('scope').getAll(scope);r.onsuccess=()=>{try{const rows=r.result as Row[];if(rows.some(x=>x.id===id||x.state==='reviewed'||x.state==='sent'||x.state==='unknown'||x.state==='blocked'&&x.ackBinding!==undefined))throw Error('unresolved native operation or duplicate ID');s.add({...p,scope,id} satisfies Row)}catch(e){error=e;tx.abort()}}};
  });
 }
 private change<T>(scope:string,id:string,fn:(r:Row)=>{next?:Row;value:T}):Promise<T>{
  return new Promise((resolve,reject)=>{const tx=this.db.transaction(STORE,'readwrite'),s=tx.objectStore(STORE);let error:unknown,value:T;tx.oncomplete=()=>resolve(value);tx.onabort=()=>reject(error??tx.error??Error('native journal update failed'));const req=s.get([scope,id]);req.onsuccess=()=>{try{const r=req.result as Row|undefined;if(!r)throw Error('missing native operation');const a=fn(r);value=a.value;if(a.next)s.put(a.next)}catch(e){error=e;tx.abort()}}});
 }
 async claim(scope:string,id:string,binding:string){
  if(!/^[a-f0-9]{64}$/.test(binding))throw Error('invalid binding');
  return this.change(scope,id,r=>r.state==='reviewed'&&r.ackBinding===undefined?{next:{...r,state:'sent',ackBinding:binding},value:true}:{value:false});
 }
 async acknowledge(scope:string,id:string,binding:string,ack:unknown){
  await this.change(scope,id,r=>{if(!['sent','unknown','blocked'].includes(r.state)||r.ackBinding!==binding||Object.hasOwn(r,'ack')||ack===undefined)throw Error('invalid acknowledgement');return {next:{...r,ack:structuredClone(ack)},value:undefined}});
 }
 async abandonUnsent(scope:string,id:string){
  await this.change(scope,id,r=>{if(r.state!=='reviewed'||r.ackBinding!==undefined)throw Error('only never-reserved work may be stopped');return {next:{...r,state:'blocked',result:{status:'blocked',reason:'operator stopped never-reserved operation',serverAuditRequired:true,productionWriteAllowed:false}},value:undefined}});
 }
 async finish(scope:string,id:string,result:NativeWorkResult){
  await this.change(scope,id,r=>{if(r.state==='verified')return {value:undefined};if(result.status==='verified'&&!Object.hasOwn(r,'ack'))throw Error('no correlated native acknowledgement');return {next:{...r,state:result.status,result:structuredClone(result)},value:undefined}});
 }
}
