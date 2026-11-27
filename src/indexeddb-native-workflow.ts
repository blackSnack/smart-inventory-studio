import type {BrowserWorkStore,BrowserWorkRecord,NativeWorkResult} from './browser-native-workflow.js';
type Row=BrowserWorkRecord&{scope:string;id:string};
const STORE='native-operations';
export class IndexedDbNativeWorkStore implements BrowserWorkStore{
 private constructor(private db:IDBDatabase){}
 static open(factory:IDBFactory=indexedDB,databaseName='smart-inventory-native-acceptance-v1'):Promise<IndexedDbNativeWorkStore>{
  return new Promise((resolve,reject)=>{const r=factory.open(databaseName,1);r.onupgradeneeded=()=>r.result.createObjectStore(STORE,{keyPath:['scope','id']}).createIndex('scope','scope');r.onerror=()=>reject(r.error);r.onblocked=()=>reject(Error('native journal blocked'));r.onsuccess=()=>{r.result.onversionchange=()=>r.result.close();resolve(new IndexedDbNativeWorkStore(r.result))}});
 }
 close(){this.db.close()}
 async list(scope:string):Promise<BrowserWorkRecord[]>{
  return new Promise((resolve,reject)=>{const r=this.db.transaction(STORE).objectStore(STORE).index('scope').getAll(scope);r.onsuccess=()=>resolve(r.result as Row[]);r.onerror=()=>reject(r.error)});
 }
 async get(scope:string,id:string):Promise<BrowserWorkRecord|undefined>{
  return new Promise((resolve,reject)=>{const r=this.db.transaction(STORE).objectStore(STORE).get([scope,id]);r.onsuccess=()=>resolve(r.result as Row|undefined);r.onerror=()=>reject(r.error)});
 }
 async admit(record:BrowserWorkRecord){
  const p=structuredClone(record),scope=p.preparation.scope,id=p.preparation.id;
  if(p.state!=='reviewed'||!id||!scope)throw Error('invalid native journal admission');
  return new Promise<void>((resolve,reject)=>{const tx=this.db.transaction(STORE,'readwrite'),s=tx.objectStore(STORE);let error:unknown;tx.oncomplete=()=>resolve();tx.onabort=()=>reject(error??tx.error??Error('native admission failed'));
   const r=s.index('scope').getAll(scope);r.onsuccess=()=>{try{const rows=r.result as Row[];if(rows.some(x=>x.id===id||x.state==='reviewed'||x.state==='sent'||x.state==='unknown'||x.state==='blocked'&&x.ackBinding!==undefined))throw Error('unresolved native operation or duplicate ID');s.add({...p,scope,id} satisfies Row)}catch(e){error=e;tx.abort()}};
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
  await this.change(scope,id,r=>{if(r.state!=='sent'||r.ackBinding!==binding||Object.hasOwn(r,'ack')||ack===undefined)throw Error('invalid acknowledgement');return {next:{...r,ack:structuredClone(ack)},value:undefined}});
 }
 async finish(scope:string,id:string,result:NativeWorkResult){
  await this.change(scope,id,r=>{if(r.state==='verified')throw Error('verified native operation is immutable');if(result.status==='verified'&&!Object.hasOwn(r,'ack'))throw Error('no correlated native acknowledgement');return {next:{...r,state:result.status,result:structuredClone(result)},value:undefined}});
 }
}
