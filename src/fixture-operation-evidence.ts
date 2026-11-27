import {snapshotKey} from './approved-snapshot.js';
import type {Operation} from './operation-journal.js';
export interface FixtureEvidenceStore {
 readonly base:string;readonly instanceId:string;
 claim(operation:Operation):Promise<boolean>;
 record(operation:Operation,acknowledgement:unknown):Promise<void>;
 read<T>(operation:Operation):Promise<T|undefined>;
}
export type FixtureEvidenceConfig={instanceId?:string;evidence?:FixtureEvidenceStore};
function scope(base:string,instanceId:string){
 const u=new URL(base.endsWith('/')?base:base+'/');if(u.protocol!=='https:'||!u.hostname.endsWith('.test')||u.username||u.password||u.search||u.hash||typeof instanceId!=='string'||!instanceId.trim())throw Error('isolated fixture evidence scope required');
 return u.href;
}
type Entry={base:string;instanceId:string;operationId:string;operationKey:string;acknowledgement?:unknown};
const storeName='fixture-evidence';
function entry(base:string,instanceId:string,operation:Operation):Entry{
 if(typeof operation.id!=='string'||!operation.id.trim()||typeof operation.kind!=='string'||!operation.kind.trim())throw Error('invalid fixture operation');
 return {base,instanceId,operationId:operation.id,operationKey:snapshotKey(operation)};
}
function copyAck(x:unknown){if(x===undefined)throw Error('missing fixture acknowledgement');const v=structuredClone(x);snapshotKey(v);return v}
function matches(a:Entry,b:Entry){return a.base===b.base&&a.instanceId===b.instanceId&&a.operationId===b.operationId&&a.operationKey===b.operationKey}
export class MemoryFixtureEvidence implements FixtureEvidenceStore{
 readonly base:string;private entries=new Map<string,Entry>();
 constructor(base:string,readonly instanceId:string){this.base=scope(base,instanceId)}
 async claim(o:Operation){const next=entry(this.base,this.instanceId,o);if(this.entries.has(next.operationId))return false;this.entries.set(next.operationId,next);return true}
 async record(o:Operation,ack:unknown){const next=entry(this.base,this.instanceId,o),old=this.entries.get(next.operationId);if(!old||!matches(old,next)||Object.hasOwn(old,'acknowledgement'))throw Error('fixture acknowledgement reservation mismatch');this.entries.set(next.operationId,{...next,acknowledgement:copyAck(ack)})}
 async read<T>(o:Operation):Promise<T|undefined>{const next=entry(this.base,this.instanceId,o),old=this.entries.get(next.operationId);return old&&matches(old,next)&&Object.hasOwn(old,'acknowledgement')?copyAck(old.acknowledgement) as T:undefined}
}
export function fixtureEvidenceFor(config:{base:string}&FixtureEvidenceConfig):FixtureEvidenceStore{
 const instanceId=config.instanceId??'ephemeral-fixture',base=scope(config.base,instanceId);
 if(config.evidence){if(config.instanceId===undefined||config.evidence.instanceId!==instanceId||config.evidence.base!==base)throw Error('fixture evidence scope mismatch');return config.evidence}
 return new MemoryFixtureEvidence(base,instanceId);
}
export class IndexedDbFixtureEvidence implements FixtureEvidenceStore{
 private constructor(private db:IDBDatabase,readonly base:string,readonly instanceId:string){}
 static async open(base:string,instanceId:string,databaseName='smart-inventory-fixture-evidence-v1',factory:IDBFactory=indexedDB):Promise<IndexedDbFixtureEvidence>{
  base=scope(base,instanceId);if(!databaseName.trim())throw Error('invalid fixture evidence database');
  return new Promise((resolve,reject)=>{const req=factory.open(databaseName,1);req.onupgradeneeded=()=>req.result.createObjectStore(storeName,{keyPath:['base','instanceId','operationId']});req.onerror=()=>reject(req.error);req.onblocked=()=>reject(Error('fixture evidence database blocked'));req.onsuccess=()=>{const db=req.result;db.onversionchange=()=>db.close();resolve(new IndexedDbFixtureEvidence(db,base,instanceId))}});
 }
 close(){this.db.close()}
 async claim(o:Operation):Promise<boolean>{
  const next=entry(this.base,this.instanceId,o);
  return new Promise((resolve,reject)=>{const tx=this.db.transaction(storeName,'readwrite'),s=tx.objectStore(storeName),req=s.get([next.base,next.instanceId,next.operationId]);let claimed=false;tx.oncomplete=()=>resolve(claimed);tx.onabort=()=>reject(tx.error??Error('fixture claim aborted'));req.onsuccess=()=>{if(req.result!==undefined)return;s.add(next);claimed=true}});
 }
 async record(o:Operation,acknowledgement:unknown):Promise<void>{
  const next=entry(this.base,this.instanceId,o),ack=copyAck(acknowledgement);
  return new Promise((resolve,reject)=>{const tx=this.db.transaction(storeName,'readwrite'),s=tx.objectStore(storeName),req=s.get([next.base,next.instanceId,next.operationId]);let failure:Error|undefined;tx.oncomplete=()=>resolve();tx.onabort=()=>reject(failure??tx.error??Error('fixture acknowledgement aborted'));req.onsuccess=()=>{const old=req.result as Entry|undefined;if(!old||!matches(old,next)||Object.hasOwn(old,'acknowledgement')){failure=Error('fixture acknowledgement reservation mismatch');tx.abort();return}s.put({...next,acknowledgement:ack})}});
 }
 async read<T>(o:Operation):Promise<T|undefined>{
  const next=entry(this.base,this.instanceId,o);return new Promise((resolve,reject)=>{const tx=this.db.transaction(storeName,'readonly'),req=tx.objectStore(storeName).get([next.base,next.instanceId,next.operationId]);req.onerror=()=>reject(req.error);req.onsuccess=()=>{try{const old=req.result as Entry|undefined;resolve(old&&matches(old,next)&&Object.hasOwn(old,'acknowledgement')?copyAck(old.acknowledgement) as T:undefined)}catch(e){reject(e)}}});
 }
}
