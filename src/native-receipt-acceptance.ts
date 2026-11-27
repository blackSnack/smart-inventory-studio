import {authorizedNativeBase,assertNativeTarget,assertNativeMode,type ProductionNativeTarget} from './native-production-authorization.js';
// Local disposable-instance acceptance only; never imported by the PWA or fixture router.
import {InvenTreeReceiptCandidateReader,type ReceiptCandidateInput} from './inventree-receipt-candidate.js';
import {receiptId,receiptDecimal} from './receipt-stock-baseline.js';
import {inspectSchema} from './provider-schema.js';
import {nativeApiVersion,matchesPreparedApi,type NativeApiVersion} from './native-api-version.js';
import {snapshotKey} from './approved-snapshot.js';

type Candidate=Awaited<ReturnType<InvenTreeReceiptCandidateReader['readCandidate']>>;
type Prepared={base:string;schemaSha256:string;apiVersion?:232;candidate:Candidate;executionAllowed:false};
type Approval={approvedPreparationSha256:string;writeAuthorized:true;visibilityConfirmed:true;exclusiveAccessConfirmed:true;identityConfirmed:true;physicalSpaceConfirmed:true};
export interface NativeReceiptEvidence {
 claim(binding:string):Promise<boolean>;
 acknowledge(binding:string,stockId:string):Promise<void>;
 read(binding:string):Promise<{stockId?:string}|undefined>;
}
const row=(x:unknown):Record<string,unknown>=>{if(!x||typeof x!=='object'||Array.isArray(x))throw Error('invalid native response');return x as Record<string,unknown>};
const sha=async(s:string|Uint8Array)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',typeof s==='string'?new TextEncoder().encode(s):new Uint8Array(s))),b=>b.toString(16).padStart(2,'0')).join('');
export async function nativeReceiptPreparationHash(prepared:Prepared){return sha(snapshotKey(prepared))}
function approved(x:unknown,production?:ProductionNativeTarget):asserts x is Approval{
 const r=row(x),keys=['writeAuthorized','visibilityConfirmed','exclusiveAccessConfirmed','identityConfirmed','physicalSpaceConfirmed'];
 assertNativeMode(production,r);if(keys.some(k=>r[k]!==true))throw Error('all local acceptance confirmations required');
}
function report(status:'verified'|'unknown'|'blocked',reason:string){
 return {status,reason,serverAuditRequired:true as const,productionWriteAllowed:false as const};
}
export class NativeReceiptAcceptance {
 private constructor(private base:URL,private token:string,private request:typeof fetch,private production?:ProductionNativeTarget){}
 static open(base:string,token:string,request:typeof fetch=fetch,production?:ProductionNativeTarget){
  if(typeof token!=='string'||!token.trim()||/[\r\n]/.test(token))throw Error('explicit isolated token required');
  return new NativeReceiptAcceptance(authorizedNativeBase(base,production),token,request,production);
 }
 private async call(path:string,method:'GET'|'POST'='GET',body?:unknown,limit=2*1024*1024){
  const u=new URL(path,this.base);
  const r=await this.request(u,{method,headers:{Authorization:'Token '+this.token,Accept:'application/json',...(body?{'Content-Type':'application/json'}:{})},redirect:'error',cache:'no-store',signal:AbortSignal.timeout(20000),...(body?{body:JSON.stringify(body)}:{})});
  if(!r.ok||!r.body)throw Error('native API request failed');
  const chunks:Uint8Array[]=[],reader=r.body.getReader();let size=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>limit)throw Error('native response limit');chunks.push(value)}}finally{try{void reader.cancel().catch(()=>{})}catch{}reader.releaseLock()}
  const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length}
  return {data:JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)) as unknown,bytes};
 }
 private async target(requirePost:boolean){
  const version=row((await this.call('api/')).data);
  const api=nativeApiVersion(version,this.production);
  const auth=row((await this.call('api/user/me/')).data);
  const actorId=receiptId(auth.pk??auth.id);
  const schema=await this.call('api/schema/?format=json','GET',undefined,16*1024*1024);
  const required=[{key:'part',path:'/api/part/{id}/',method:'get' as const},{key:'locations',path:'/api/stock/location/',method:'get' as const},{key:'stock',path:'/api/stock/',method:'get' as const}];
  if(inspectSchema(schema.data,[...required,...(api===232?[{key:'location-detail',path:'/api/stock/location/{id}/',method:'get' as const}]:[]),...(requirePost?[{key:'create',path:'/api/stock/',method:'post' as const}]:[])]).some(x=>!x.declared))throw Error('native receipt API missing');
  const digest=await sha(schema.bytes);assertNativeTarget(this.production,actorId,digest);return {digest,api};
 }
 private async legacyLocation(candidate:Candidate,api:NativeApiVersion){
  if(api!==232)return;
  for(const a of candidate.input.allocations){for(const expected of candidate.paths[a.locationId]){
   const actual=row((await this.call('api/stock/location/'+expected.id+'/')).data);
   if(receiptId(actual.pk)!==expected.id||actual.name!==expected.name||actual.structural!==expected.structural||actual.external!==false||(actual.parent===null?null:receiptId(actual.parent))!==expected.parentId)throw Error('legacy receipt location changed or external');
  }}
 }
 private reader(api:NativeApiVersion){return InvenTreeReceiptCandidateReader.open(this.base.href,this.token,this.request,api===232)}
 async prepare(instanceId:string,input:ReceiptCandidateInput):Promise<Prepared>{
  if(input.allocations?.length!==1)throw Error('one explicit disposable receipt allocation required');
  const {digest:schemaSha256,api}=await this.target(true),candidate=await (await this.reader(api)).readCandidate(instanceId,input);
  await this.legacyLocation(candidate,api);
  return {base:this.base.href,schemaSha256,...(api===232?{apiVersion:232 as const}:{}),candidate,executionAllowed:false};
 }
 private async validate(prepared:Prepared,approval:unknown){
  approved(approval,this.production);
  if(!prepared||prepared.base!==this.base.href||prepared.executionAllowed!==false||!(/^[a-f0-9]{64}$/).test(prepared.schemaSha256)||prepared.candidate?.executionAllowed!==false||prepared.candidate.input?.allocations?.length!==1)throw Error('invalid prepared receipt');
  const binding=await nativeReceiptPreparationHash(prepared);
  if(approval.approvedPreparationSha256!==binding)throw Error('approval does not bind exact preparation');
  return binding;
 }
 async execute(raw:Prepared,approval:unknown,evidence:NativeReceiptEvidence){
  const prepared=structuredClone(raw),binding=await this.validate(prepared,approval);
  const target=await this.target(true);matchesPreparedApi(target.api,prepared);if(target.digest!==prepared.schemaSha256)throw Error('schema changed after review');
  const candidate=await (await this.reader(target.api)).recheck(prepared.candidate);await this.legacyLocation(candidate,target.api);
  if(!await evidence.claim(binding))throw Error('receipt already attempted; observe only');
  const a=candidate.input.allocations[0];
  try{
   const result=(await this.call('api/stock/','POST',{part:Number(candidate.input.partId),location:Number(a.locationId),quantity:a.quantity})).data;
   if(target.api===570&&(!Array.isArray(result)||result.length!==1))throw Error('invalid receipt acknowledgement');
   const r=row(target.api===232?result:(result as unknown[])[0]),id=receiptId(r.pk);
   if(receiptId(r.part)!==candidate.input.partId||receiptId(r.location)!==a.locationId||receiptDecimal(r.quantity)!==String(a.quantity)||candidate.byLocation[a.locationId].some(s=>s.id===id))throw Error('receipt acknowledgement mismatch');
   await evidence.acknowledge(binding,id);
  }catch{return report('unknown','no durable correlated acknowledgement; never resend')}
  return this.observe(prepared,approval,evidence);
 }
 async observe(raw:Prepared,approval:unknown,evidence:NativeReceiptEvidence){
  const prepared=structuredClone(raw),binding=await this.validate(prepared,approval);
  let ack;try{ack=await evidence.read(binding)}catch{return report('unknown','private evidence unreadable')}
  if(!ack?.stockId)return report('unknown','no correlated acknowledgement; never resend');
  try{
   const target=await this.target(false);matchesPreparedApi(target.api,prepared);if(target.digest!==prepared.schemaSha256)return report('unknown','schema changed');
   const before=prepared.candidate,a=before.input.allocations[0],fresh=await (await this.reader(target.api)).readCandidate(before.instanceId,before.input);
   await this.legacyLocation(fresh,target.api);
   const stock=fresh.byLocation[a.locationId],created=stock.find(s=>s.id===ack.stockId);
   if(!created)return report('unknown','acknowledged stock not visible');
   if(snapshotKey(before.part)!==snapshotKey(fresh.part)||snapshotKey(before.paths)!==snapshotKey(fresh.paths)||snapshotKey(before.byLocation[a.locationId])!==snapshotKey(stock.filter(s=>s.id!==ack.stockId))||created.partId!==before.input.partId||created.quantity!==String(a.quantity)||created.batch?.trim()||created.serial?.trim()||created.status!=='10')return report('blocked','receipt or prior baseline changed');
   return report('verified','acknowledged new StockItem and unchanged reviewed stock baseline');
  }catch{return report('unknown','readback unavailable')}
 }
}
