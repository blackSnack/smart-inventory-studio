import {authorizedNativeBase,assertNativeTarget,assertNativeMode,type ProductionNativeTarget} from './native-production-authorization.js';
// Explicit local disposable-instance acceptance. Not imported by PWA.
import {InvenTreeReadProvider} from './domain.js';
import {inspectSchema,type RequiredOperation} from './provider-schema.js';
import {snapshotKey} from './approved-snapshot.js';
import {parsePartCreate,partCreateId,partCreateBody,verifyCreatedPart,type ParsedPartCreate} from './part-create-contract.js';
import type {NativeReceiptEvidence} from './native-receipt-acceptance.js';
import {nativeApiVersion,parameterPath,parameterFilters,matchesPreparedApi} from './native-api-version.js';
import type {Operation} from './operation-journal.js';

type Prepared={kind:'native-part-create';base:string;instanceId:string;schemaSha256:string;apiVersion?:232;input:ParsedPartCreate;executionAllowed:false};
const obj=(x:unknown):Record<string,unknown>=>{if(!x||typeof x!=='object'||Array.isArray(x))throw Error('invalid native Part record');return x as Record<string,unknown>};
const zeroMinimum=(raw:unknown)=>{const v=obj(raw).minimum_stock;return v===0||typeof v==='string'&&/^0+(?:\.0+)?$/.test(v)};
const sha=async(s:string|Uint8Array)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',typeof s==='string'?new TextEncoder().encode(s):new Uint8Array(s))),b=>b.toString(16).padStart(2,'0')).join('');
export const nativePartPreparationHash=(p:Prepared)=>sha(snapshotKey(p));
const result=(status:'verified'|'unknown'|'blocked',reason:string)=>({status,reason,serverAuditRequired:true as const,productionWriteAllowed:false as const});
function parsed(raw:unknown):ParsedPartCreate{
 const r=obj(raw),keys=['ipn','categoryId','categoryName','name','description','units'];
 if(Object.keys(r).length!==keys.length||keys.some(k=>!Object.hasOwn(r,k)))throw Error('invalid new Part input');
 const op:Operation={id:'local-part-create',kind:'create-part',payload:{...r,identityMode:'partial',newPartConfirmed:true,expectedAbsent:true,lookupComplete:true}};
 return parsePartCreate(op);
}
const reads:RequiredOperation[]=[{key:'category',path:'/api/part/category/{id}/',method:'get'},{key:'parts',path:'/api/part/',method:'get'},{key:'part-detail',path:'/api/part/{id}/',method:'get'},{key:'stock',path:'/api/stock/',method:'get'},{key:'parameters',path:'/api/parameter/',method:'get'}];
export class NativePartCreateAcceptance{
 private read:InvenTreeReadProvider;
 private constructor(private base:URL,private token:string,private request:typeof fetch,private production?:ProductionNativeTarget){this.read=new InvenTreeReadProvider(base.href,token,request)}
 static open(base:string,token:string,request:typeof fetch=fetch,production?:ProductionNativeTarget){
  if(typeof token!=='string'||!token.trim()||/[\r\n]/.test(token))throw Error('explicit isolated token required');return new NativePartCreateAcceptance(authorizedNativeBase(base,production),token,request,production);
 }
 private async call(path:string,method:'GET'|'POST'='GET',body?:unknown,limit=2*1024*1024){
  const res=await this.request(new URL(path,this.base),{method,headers:{Authorization:'Token '+this.token,Accept:'application/json',...(body?{'Content-Type':'application/json'}:{})},redirect:'error',cache:'no-store',signal:AbortSignal.timeout(20000),...(body?{body:JSON.stringify(body)}:{})});
  if(!res.ok||!res.body)throw Error('native API request failed');
  const chunks:Uint8Array[]=[],reader=res.body.getReader();let size=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>limit)throw Error('native response limit');chunks.push(value)}}finally{try{void reader.cancel().catch(()=>{})}catch{}reader.releaseLock()}
  const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length}
  return {data:JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)) as unknown,bytes};
 }
 private async target(write:boolean){
  const version=obj((await this.call('api/')).data);const api=nativeApiVersion(version,this.production);
  const auth=obj((await this.call('api/user/me/')).data);const actorId=partCreateId(auth.pk??auth.id);
  const schema=await this.call('api/schema/?format=json','GET',undefined,16*1024*1024);
  const required:RequiredOperation[]=[...reads.map(r=>r.key==='parameters'?{...r,path:'/'+parameterPath(api)}:r),...(write?[{key:'create',path:'/api/part/',method:'post'} as const]:[])];
  if(inspectSchema(schema.data,required).some(x=>!x.declared))throw Error('native Part API missing');
  const digest=await sha(schema.bytes);assertNativeTarget(this.production,actorId,digest);return {digest,api};
 }
 private async category(p:ParsedPartCreate){
  const c=obj((await this.call('api/part/category/'+p.categoryId+'/')).data);
  if(partCreateId(c.pk)!==p.categoryId||c.name!==p.categoryName||c.structural!==false)throw Error('reviewed category changed');
 }
 private async matching(p:ParsedPartCreate){
  const rows=(await this.read.list('api/part/',{IPN:p.ipn})).map(obj),ids=rows.map(r=>partCreateId(r.pk));
  if(new Set(ids).size!==ids.length||rows.some(r=>r.IPN!==p.ipn))throw Error('invalid exact IPN lookup');
  return rows;
 }
 private async absent(p:ParsedPartCreate){await this.category(p);if((await this.matching(p)).length)throw Error('existing IPN requires review')}
 async prepare(instanceId:string,raw:unknown):Promise<Prepared>{
  if(typeof instanceId!=='string'||!instanceId.trim()||instanceId.length>256)throw Error('instance label required');
  const input=parsed(structuredClone(raw)),{digest:schemaSha256,api}=await this.target(true);
  await this.absent(input);await this.absent(input);
  return {kind:'native-part-create',base:this.base.href,instanceId,schemaSha256,...(api===232?{apiVersion:232 as const}:{}),input,executionAllowed:false};
 }
 private async validate(prepared:Prepared,approval:unknown){
  const r=obj(approval);assertNativeMode(this.production,r);
  if(['writeAuthorized','visibilityConfirmed','exclusiveAccessConfirmed','identityConfirmed','newPartConfirmed'].some(k=>r[k]!==true))throw Error('all local confirmations required');
  if(!prepared||prepared.kind!=='native-part-create'||prepared.base!==this.base.href||prepared.executionAllowed!==false||!(/^[a-f0-9]{64}$/).test(prepared.schemaSha256)||typeof prepared.instanceId!=='string'||!prepared.instanceId.trim())throw Error('invalid prepared Part');
  const input=parsed(prepared.input),binding=await nativePartPreparationHash(prepared);
  if(r.approvedPreparationSha256!==binding)throw Error('approval does not bind exact preparation');
  return {input,binding};
 }
 // NativeReceiptEvidence stores one opaque record ID per preparation; stockId is the legacy storage slot name.
 async execute(raw:Prepared,approval:unknown,evidence:NativeReceiptEvidence){
  const prepared=structuredClone(raw),{input,binding}=await this.validate(prepared,approval);
  const target=await this.target(true);matchesPreparedApi(target.api,prepared);if(target.digest!==prepared.schemaSha256)throw Error('schema changed after review');
  await this.absent(input);await this.absent(input);
  if(!await evidence.claim(binding))throw Error('Part creation already attempted; observe only');
  try{
   const created=(await this.call('api/part/','POST',{...partCreateBody(input),...(target.api===232?{minimum_stock:0}:{})})).data;
   if(target.api===232&&!zeroMinimum(created))throw Error('legacy minimum stock acknowledgement mismatch');
   await evidence.acknowledge(binding,verifyCreatedPart(created,input));
  }catch{return result('unknown','no durable correlated acknowledgement; never resend')}
  return this.observe(prepared,approval,evidence);
 }
 async observe(raw:Prepared,approval:unknown,evidence:NativeReceiptEvidence){
  const prepared=structuredClone(raw),{input,binding}=await this.validate(prepared,approval);
  let ack;try{ack=await evidence.read(binding)}catch{return result('unknown','private evidence unreadable')}
  if(!ack?.stockId)return result('unknown','no correlated acknowledgement; never resend');
  try{
   const target=await this.target(false);matchesPreparedApi(target.api,prepared);if(target.digest!==prepared.schemaSha256)return result('unknown','schema changed');
   await this.category(input);
   const id=partCreateId(ack.stockId),rows=await this.matching(input);
   if(rows.length!==1||partCreateId(rows[0].pk)!==id)return result('blocked','Part IPN or identity conflict');
   const detail=(await this.call('api/part/'+id+'/')).data;
   try{if(verifyCreatedPart(rows[0],input)!==id||verifyCreatedPart(detail,input)!==id||target.api===232&&(!zeroMinimum(rows[0])||!zeroMinimum(detail)))return result('blocked','Part fields changed')}catch{return result('blocked','Part fields changed')}
   if((await this.read.getStockByPart(id)).length||(await this.read.list(parameterPath(target.api),parameterFilters(target.api,id))).length)return result('blocked','unexpected initial stock or parameter record');
   return result('verified','acknowledged new partial Part, exact list/detail and no initial stock or parameters');
  }catch{return result('unknown','Part readback unavailable')}
 }
}
