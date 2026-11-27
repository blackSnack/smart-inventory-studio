// Browser acceptance uses the same native runners as the local CLI. Production write capability is NOT granted.
import {NativeReceiptAcceptance,nativeReceiptPreparationHash,type NativeReceiptEvidence} from './native-receipt-acceptance.js';
import {NativePartCreateAcceptance,nativePartPreparationHash} from './native-part-create-acceptance.js';
import {NativeEnrichmentAcceptance,nativeEnrichmentPreparationHash} from './native-enrichment-acceptance.js';
import {NativeOperationsAcceptance,nativeOperationsPreparationHash,type NativeOperationEvidence} from './native-operations-acceptance.js';
import {localOperationBase} from './local-operation-context.js';
import {snapshotKey} from './approved-snapshot.js';
import {validateCatalog,type Catalog} from './catalog.js';
import {InvenTreeReadProvider} from './domain.js';
import {inspectInvenTreeContract} from './inventree-contract-evidence.js';
import type {Operation} from './operation-journal.js';

type Receipt=Awaited<ReturnType<NativeReceiptAcceptance['prepare']>>;
type Part=Awaited<ReturnType<NativePartCreateAcceptance['prepare']>>;
type Enrichment=Awaited<ReturnType<NativeEnrichmentAcceptance['prepare']>>;
type Operations=Awaited<ReturnType<NativeOperationsAcceptance['prepare']>>;
export type NativeWorkInput={id:string;kind:'receive-existing-part';payload:{partId:string;locationId:string;quantity:number}}|{id:string;kind:'create-part';payload:unknown}|{id:string;kind:'enrichment';payload:unknown;expectedBefore?:unknown}|{id:string;kind:'operation';payload:Operation};
type NativePrepared={kind:'receive-existing-part';value:Receipt}|{kind:'create-part';value:Part}|{kind:'enrichment';value:Enrichment}|{kind:'operation';value:Operations};
type Target={actorId:string;schemaSha256:string};
export type BrowserPreparation={id:string;scope:string;target:Target;catalogHash:string;input:NativeWorkInput;prepared:NativePrepared;executionAllowed:false};
export type BrowserApproval={preparationSha256:string;disposableConfirmed:true;visibilityConfirmed:true;exclusiveConfirmed:true;identityAndPhysicalConfirmed:true;sourceAndMappingConfirmed:true;writeAuthorized:true};
export type NativeWorkResult={status:'verified'|'unknown'|'blocked';reason:string;serverAuditRequired:true;productionWriteAllowed:false};
export type BrowserWorkState='reviewed'|'sent'|'verified'|'unknown'|'blocked';
export interface BrowserWorkRecord {preparation:BrowserPreparation;approval:BrowserApproval;state:BrowserWorkState;ack?:unknown;ackBinding?:string;result?:NativeWorkResult}
export interface BrowserWorkStore{
 admit(record:BrowserWorkRecord):Promise<void>;
 claim(scope:string,id:string,binding:string):Promise<boolean>;
 acknowledge(scope:string,id:string,binding:string,ack:unknown):Promise<void>;
 get(scope:string,id:string):Promise<BrowserWorkRecord|undefined>;
 list(scope:string):Promise<BrowserWorkRecord[]>;
 abandonUnsent(scope:string,id:string):Promise<void>;
 finish(scope:string,id:string,result:NativeWorkResult):Promise<void>;
}
const obj=(x:unknown):Record<string,unknown>=>{if(!x||typeof x!=='object'||Array.isArray(x))throw Error('invalid native response');return x as Record<string,unknown>};
const sha=async(s:string|Uint8Array)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',typeof s==='string'?new TextEncoder().encode(s):new Uint8Array(s))),b=>b.toString(16).padStart(2,'0')).join('');
export const browserPreparationHash=(p:BrowserPreparation)=>sha(snapshotKey(p));
const validId=(x:unknown):string=>{const s=String(x);if(!/^[1-9][0-9]{0,15}$/.test(s)||!Number.isSafeInteger(Number(s)))throw Error('invalid native identity');return s};
const result=(status:NativeWorkResult['status'],reason:string):NativeWorkResult=>({status,reason,serverAuditRequired:true,productionWriteAllowed:false});
export class BrowserNativeWorkflow{
 readonly scope:string;private catalog:Catalog;
 private constructor(private base:URL,private token:string,catalog:Catalog,private catalogHash:string,private request:typeof fetch){this.scope='disposable:'+base.href;this.catalog=catalog}
 static async open(base:string,token:string,catalog:unknown,request:typeof fetch=fetch){
  const u=localOperationBase(base);if(!token.trim()||/[\r\n]/.test(token))throw Error('isolated token required');
  const c=validateCatalog(structuredClone(catalog));const runner=new BrowserNativeWorkflow(u,token,c,await sha(snapshotKey(c)),request);
  await runner.probe();return runner;
 }
 private async get(path:string,limit=16*1024*1024){
  const r=await this.request(new URL(path,this.base),{method:'GET',headers:{Authorization:'Token '+this.token,Accept:'application/json'},cache:'no-store',redirect:'error',signal:AbortSignal.timeout(20000)});
  if(!r.ok||!r.body)throw Error('native preflight failed');
  const chunks:Uint8Array[]=[],reader=r.body.getReader();let n=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;n+=value.byteLength;if(n>limit)throw Error('response limit');chunks.push(value)}}finally{try{void reader.cancel().catch(()=>{})}catch{}reader.releaseLock()}
  const bytes=new Uint8Array(n);let off=0;for(const x of chunks){bytes.set(x,off);off+=x.length}
  return {data:JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)) as unknown,bytes};
 }
 async probe(){
  const v=obj((await this.get('api/',1024*1024)).data);
  if(v.server!=='InvenTree'||v.version!=='1.7.4'||v.apiVersion!==570)throw Error('requires InvenTree 1.7.4 / API 570');
  const a=obj((await this.get('api/user/me/',1024*1024)).data),actorId=validId(a.pk??a.id),s=await this.get('api/schema/?format=json');
  const contract=inspectInvenTreeContract(s.data);
  return {target:{actorId,schemaSha256:await sha(s.bytes)},version:'1.7.4',apiVersion:570,contract,writeEnabled:false as const};
 }
 async listChoices(kind:'categories'|'templates'|'locations'|'stock',locationId?:string){
  const read=new InvenTreeReadProvider(this.base.href,this.token,this.request);
  switch(kind){case 'categories':return read.list('api/part/category/');case 'templates':return read.list('api/parameter/template/',{for_model:'part.part'});case 'locations':return read.getLocations();case 'stock':return read.list('api/stock/',{location:validId(locationId),cascade:'false'})}
 }
 async readMetadata(locationId:string){const r=obj((await this.get('api/metadata/stocklocation/'+validId(locationId)+'/')).data);return obj(r.metadata)}
 async searchParts(query:string){if(!query.trim())return [];return new InvenTreeReadProvider(this.base.href,this.token,this.request).searchParts(query.trim())}
 private receipt(){return NativeReceiptAcceptance.open(this.base.href,this.token,this.request)}
 private part(){return NativePartCreateAcceptance.open(this.base.href,this.token,this.request)}
 private enrichment(){return NativeEnrichmentAcceptance.open(this.base.href,this.token,this.request)}
 private operations(){return NativeOperationsAcceptance.open(this.base.href,this.token,this.catalog,this.catalogHash,this.request)}
 async prepare(raw:NativeWorkInput):Promise<BrowserPreparation>{
  const input=structuredClone(raw);if(typeof input.id!=='string'||!input.id.trim()||input.id.length>128)throw Error('invalid stable operation ID');
  const {target}=await this.probe();let prepared:NativePrepared;
  switch(input.kind){
   case 'receive-existing-part':{const p=input.payload;prepared={kind:input.kind,value:await this.receipt().prepare(this.scope,{partId:p.partId,quantity:p.quantity,allocations:[{locationId:p.locationId,quantity:p.quantity}]})};break}
   case 'create-part':prepared={kind:input.kind,value:await this.part().prepare(this.scope,input.payload)};break;
   case 'enrichment':{const value=await this.enrichment().prepare(this.scope,input.payload);if(Object.hasOwn(input,'expectedBefore')&&(value.baseline.kind!=='parameter'||snapshotKey(value.baseline.before)!==snapshotKey(input.expectedBefore)))throw Error('reviewed parameter baseline changed');prepared={kind:input.kind,value};break}
   case 'operation':if(input.payload.id!==input.id)throw Error('operation ID mismatch');prepared={kind:input.kind,value:await this.operations().prepare(this.scope,input.payload)};break;
   default:throw Error('unsupported native workflow');
  }
  if(prepared.value.schemaSha256!==target.schemaSha256||snapshotKey((await this.probe()).target)!==snapshotKey(target))throw Error('target changed during preparation');
  return {id:input.id,scope:this.scope,target,catalogHash:this.catalogHash,input,prepared,executionAllowed:false};
 }
 private async validate(p:BrowserPreparation,a:BrowserApproval){
  if(p.scope!==this.scope||p.id!==p.input.id||p.prepared.kind!==p.input.kind||p.catalogHash!==this.catalogHash||p.executionAllowed!==false||p.prepared.value.schemaSha256!==p.target.schemaSha256)throw Error('preparation scope mismatch');
  if(!a||[a.disposableConfirmed,a.visibilityConfirmed,a.exclusiveConfirmed,a.identityAndPhysicalConfirmed,a.sourceAndMappingConfirmed,a.writeAuthorized].some(v=>v!==true)||a.preparationSha256!==await browserPreparationHash(p))throw Error('exact preparation approval required');
  if(snapshotKey((await this.probe()).target)!==snapshotKey(p.target))throw Error('target identity or schema changed');
 }
 private async dispatch(p:BrowserPreparation,store:BrowserWorkStore,observe:boolean):Promise<NativeWorkResult>{
  const scope=p.scope,id=p.id;
  const claim=(binding:string)=>store.claim(scope,id,binding),acknowledge=(binding:string,ack:unknown)=>store.acknowledge(scope,id,binding,ack);
  const read=async(binding:string)=>{const row=await store.get(scope,id);if(!row||row.ackBinding!==binding)return undefined;return row.ack};
  const receiptEvidence:NativeReceiptEvidence={claim,acknowledge:(b,stockId)=>acknowledge(b,{stockId}),read:async b=>await read(b) as {stockId?:string}|undefined};
  const operationEvidence:NativeOperationEvidence={claim:(_key,b)=>claim(b),record:(_key,b,ack)=>acknowledge(b,ack),read:async(_key,b)=>{const ack=await read(b);return ack===undefined?undefined:{ack}}};
  const common={disposableInstanceConfirmed:true,writeAuthorized:true,visibilityConfirmed:true,exclusiveAccessConfirmed:true,identityConfirmed:true,physicalSpaceConfirmed:true,newPartConfirmed:true,sourceReviewed:true,fieldMappingConfirmed:true,operationReviewed:true,physicalAndReferenceReviewConfirmed:true} as const;
  const q=p.prepared;
  switch(q.kind){
  case 'receive-existing-part':{const runner=this.receipt(),a={...common,approvedPreparationSha256:await nativeReceiptPreparationHash(q.value)};return observe?runner.observe(q.value,a,receiptEvidence):runner.execute(q.value,a,receiptEvidence)}
  case 'create-part':{const runner=this.part(),a={...common,approvedPreparationSha256:await nativePartPreparationHash(q.value)};return observe?runner.observe(q.value,a,receiptEvidence):runner.execute(q.value,a,receiptEvidence)}
  case 'enrichment':{const runner=this.enrichment(),a={...common,approvedPreparationSha256:await nativeEnrichmentPreparationHash(q.value)};return observe?runner.observe(q.value,a,receiptEvidence):runner.execute(q.value,a,receiptEvidence)}
  case 'operation':{const runner=this.operations(),a={...common,approvedPreparationSha256:await nativeOperationsPreparationHash(q.value)};return observe?runner.observe(q.value,a,operationEvidence):runner.execute(q.value,a,operationEvidence)}
  }
 }
 async execute(raw:BrowserPreparation,approval:BrowserApproval,store:BrowserWorkStore){
  const p=structuredClone(raw),a=structuredClone(approval);await this.validate(p,a);
  await store.admit({preparation:p,approval:a,state:'reviewed'});
  let r:NativeWorkResult;
  try{r=await this.dispatch(p,store,false)}catch{
   const saved=await store.get(p.scope,p.id);
   r=result(saved?.state==='sent'?'unknown':'blocked',saved?.state==='sent'?'request outcome uncertain; readback only':'preflight stopped before durable write reservation');
  }
  await store.finish(p.scope,p.id,r);return r;
 }
 async recover(id:string,store:BrowserWorkStore){
  const row=await store.get(this.scope,id);if(!row||row.state==='verified')throw Error('no pending native operation');
  if(!row.ackBinding)throw Error('never reserved; explicitly stop the unsent operation');
  const p=row.preparation;await this.validate(p,row.approval);
  const r=await this.dispatch(p,store,true);await store.finish(p.scope,id,r);return r;
 }
}
