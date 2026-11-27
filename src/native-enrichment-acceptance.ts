// Explicit local disposable-instance acceptance only. Never used by the PWA.
import {InvenTreeReadProvider} from './domain.js';
import {inspectSchema,type RequiredOperation} from './provider-schema.js';
import {snapshotKey} from './approved-snapshot.js';
import type {NativeReceiptEvidence} from './native-receipt-acceptance.js';
type Evidence={url:string;locator:string};
type Input={kind:'source';partId:string;ipn:string;url:string;comment:string}|{kind:'parameter';partId:string;ipn:string;templateId:string;templateName:string;units:string;value:string;evidence:Evidence[]};
type Attachment={id:string;link:string|null;comment:string;attachment:string|null};
type Value={id:string;value:string;note:string};
type Baseline={kind:'source';rows:Attachment[]}|{kind:'parameter';before:Value|null};
type Prepared={kind:'native-enrichment';base:string;instanceId:string;schemaSha256:string;input:Input;baseline:Baseline;executionAllowed:false};
const obj=(x:unknown):Record<string,unknown>=>{if(!x||typeof x!=='object'||Array.isArray(x))throw Error('invalid enrichment record');return x as Record<string,unknown>};
const id=(x:unknown):string=>{const s=typeof x==='number'&&Number.isSafeInteger(x)?String(x):x;if(typeof s!=='string'||!(/^[1-9][0-9]{0,15}$/).test(s)||!Number.isSafeInteger(Number(s)))throw Error('invalid native ID');return s};
const str=(x:unknown,max=4000,empty=false):string=>{if(typeof x!=='string'||x.length>max||!empty&&!x.trim())throw Error('invalid enrichment text');return x};
const url=(x:unknown)=>{const u=new URL(str(x));if(u.protocol!=='https:'||u.username||u.password)throw Error('invalid source URL');return u.href};
const sha=async(s:string|Uint8Array)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',typeof s==='string'?new TextEncoder().encode(s):new Uint8Array(s))),b=>b.toString(16).padStart(2,'0')).join('');
export const nativeEnrichmentPreparationHash=(p:Prepared)=>sha(snapshotKey(p));
const result=(status:'verified'|'unknown'|'blocked',reason:string)=>({status,reason,serverAuditRequired:true as const,productionWriteAllowed:false as const});
function parse(raw:unknown):Input{
 const r=obj(raw),partId=id(r.partId),ipn=str(r.ipn,100);
 const expected=r.kind==='source'?['kind','partId','ipn','url','comment']:['kind','partId','ipn','templateId','templateName','units','value','evidence'];
 if(Object.keys(r).length!==expected.length||expected.some(k=>!Object.hasOwn(r,k)))throw Error('unexpected enrichment fields');
 if(r.kind==='source')return {kind:'source',partId,ipn,url:url(r.url),comment:str(r.comment,250)};
 if(r.kind!=='parameter'||!Array.isArray(r.evidence)||!r.evidence.length||r.evidence.length>20)throw Error('reviewed parameter evidence required');
 return {kind:'parameter',partId,ipn,templateId:id(r.templateId),templateName:str(r.templateName,100),units:str(r.units,100,true),value:str(r.value),evidence:r.evidence.map(x=>{const e=obj(x);return {url:url(e.url),locator:str(e.locator,1000)}})};
}
function attachment(raw:unknown,partId:string):Attachment{
 const r=obj(raw);if(r.model_type!=='part'||id(r.model_id)!==partId)throw Error('attachment scope changed');
 return {id:id(r.pk),link:r.link===null?null:str(r.link,4000,true),comment:str(r.comment,4000,true),attachment:r.attachment===null?null:str(r.attachment,4000,true)};
}
function parameter(raw:unknown,p:Extract<Input,{kind:'parameter'}>):Value{
 const r=obj(raw);if(r.model_type!=='part.part'||id(r.model_id)!==p.partId||id(r.template)!==p.templateId)throw Error('parameter scope changed');
 return {id:id(r.pk),value:str(r.data,4000,true),note:str(r.note,4000,true)};
}
function sameUrl(r:Attachment,u:string){try{return r.link!==null&&url(r.link)===u}catch{return false}}
export class NativeEnrichmentAcceptance{
 private read:InvenTreeReadProvider;
 private constructor(private base:URL,private token:string,private request:typeof fetch){this.read=new InvenTreeReadProvider(base.href,token,request)}
 static open(base:string,token:string,request:typeof fetch=fetch){
  const u=new URL(base);if(!['http:','https:'].includes(u.protocol)||!['127.0.0.1','[::1]'].includes(u.hostname)||!u.port||u.username||u.password||u.search||u.hash||u.pathname!=='/'||typeof token!=='string'||!token.trim()||/[\r\n]/.test(token))throw Error('explicit loopback disposable instance required');
  return new NativeEnrichmentAcceptance(u,token,request);
 }
 private async call(path:string,method:'GET'|'POST'|'PATCH'='GET',body?:unknown,limit=2*1024*1024){
  const r=await this.request(new URL(path,this.base),{method,headers:{Authorization:'Token '+this.token,Accept:'application/json',...(body?{'Content-Type':'application/json'}:{})},redirect:'error',cache:'no-store',signal:AbortSignal.timeout(20000),...(body?{body:JSON.stringify(body)}:{})});
  if(!r.ok||!r.body)throw Error('native API request failed');
  const chunks:Uint8Array[]=[],reader=r.body.getReader();let size=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>limit)throw Error('native response limit');chunks.push(value)}}finally{try{void reader.cancel().catch(()=>{})}catch{}reader.releaseLock()}
  const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length}
  return {data:JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)) as unknown,bytes};
 }
 private async target(kind:Input['kind'],write:boolean){
  const v=obj((await this.call('api/')).data);if(v.server!=='InvenTree'||v.version!=='1.7.4'||v.apiVersion!==570)throw Error('isolated version mismatch');
  const auth=obj((await this.call('api/user/me/')).data);id(auth.pk??auth.id);
  const schema=await this.call('api/schema/?format=json','GET',undefined,16*1024*1024);
  const required:RequiredOperation[]=[{key:'part',path:'/api/part/{id}/',method:'get'}];
  if(kind==='source'){required.push({key:'attachments',path:'/api/attachment/',method:'get'});if(write)required.push({key:'create',path:'/api/attachment/',method:'post'})}
  else {required.push({key:'template',path:'/api/parameter/template/{id}/',method:'get'},{key:'parameters',path:'/api/parameter/',method:'get'});if(write)required.push({key:'create',path:'/api/parameter/',method:'post'},{key:'patch',path:'/api/parameter/{id}/',method:'patch'})}
  if(inspectSchema(schema.data,required).some(x=>!x.declared))throw Error('native enrichment API missing');return sha(schema.bytes);
 }
 private async current(p:Input):Promise<Baseline>{
  const part=obj((await this.call('api/part/'+p.partId+'/')).data);
  if(id(part.pk)!==p.partId||part.IPN!==p.ipn||part.active!==true)throw Error('reviewed Part identity changed');
  if(p.kind==='source'){
   const rows=(await this.read.list('api/attachment/',{model_type:'part',model_id:p.partId})).map(x=>attachment(x,p.partId)).sort((a,b)=>a.id.localeCompare(b.id));
   if(new Set(rows.map(r=>r.id)).size!==rows.length)throw Error('duplicate attachment ID');return {kind:'source',rows};
  }
  const t=obj((await this.call('api/parameter/template/'+p.templateId+'/')).data);
  if(id(t.pk)!==p.templateId||t.model_type!=='part.part'||t.name!==p.templateName||t.units!==p.units||t.enabled!==true||t.checkbox!==false||t.choices!==''||t.selectionlist!==null)throw Error('template changed or unsupported');
  const rows=(await this.read.list('api/parameter/',{model_type:'part.part',model_id:p.partId,template:p.templateId})).map(x=>parameter(x,p));
  if(rows.length>1)throw Error('duplicate parameter records');return {kind:'parameter',before:rows[0]??null};
 }
 private eligible(input:Input,b:Baseline){
  if(input.kind==='source'&&b.kind==='source'){if(b.rows.some(r=>sameUrl(r,input.url)))throw Error('source already exists');return}
  if(input.kind==='parameter'&&b.kind==='parameter'){if(b.before?.value.trim())throw Error('known parameter cannot be overwritten');return}
  throw Error('baseline kind mismatch');
 }
 async prepare(instanceId:string,raw:unknown):Promise<Prepared>{
  const input=parse(structuredClone(raw));str(instanceId,256);
  const schemaSha256=await this.target(input.kind,true),baseline=await this.current(input);this.eligible(input,baseline);
  if(snapshotKey(baseline)!==snapshotKey(await this.current(input)))throw Error('baseline changed during review');
  return {kind:'native-enrichment',base:this.base.href,instanceId,schemaSha256,input,baseline,executionAllowed:false};
 }
 private async validate(prepared:Prepared,approval:unknown){
  const a=obj(approval);if(['disposableInstanceConfirmed','writeAuthorized','visibilityConfirmed','exclusiveAccessConfirmed','identityConfirmed','sourceReviewed','fieldMappingConfirmed'].some(k=>a[k]!==true))throw Error('all local confirmations required');
  if(!prepared||prepared.kind!=='native-enrichment'||prepared.base!==this.base.href||prepared.executionAllowed!==false||!(/^[a-f0-9]{64}$/.test(prepared.schemaSha256)))throw Error('invalid prepared enrichment');
  str(prepared.instanceId,256);const input=parse(prepared.input),binding=await nativeEnrichmentPreparationHash(prepared);
  if(a.approvedPreparationSha256!==binding)throw Error('approval does not bind preparation');
  this.eligible(input,prepared.baseline);return {input,binding};
 }
 async execute(raw:Prepared,approval:unknown,evidence:NativeReceiptEvidence){
  const prepared=structuredClone(raw),{input:p,binding}=await this.validate(prepared,approval),b=prepared.baseline;
  if(await this.target(p.kind,true)!==prepared.schemaSha256||snapshotKey(await this.current(p))!==snapshotKey(b))throw Error('approved baseline changed');
  if(!await evidence.claim(binding))throw Error('already attempted; observe only');
  try{
   let pk:string;
   if(p.kind==='source'&&b.kind==='source'){
    const created=attachment((await this.call('api/attachment/','POST',{model_type:'part',model_id:Number(p.partId),link:p.url,comment:p.comment})).data,p.partId);
    if(created.link!==p.url||created.comment!==p.comment||created.attachment!==null&&created.attachment!==''||b.rows.some(r=>r.id===created.id))throw Error('attachment acknowledgement mismatch');
    pk=created.id;
   }else if(p.kind==='parameter'&&b.kind==='parameter'){
    const data=b.before?await this.call('api/parameter/'+b.before.id+'/','PATCH',{data:p.value}):await this.call('api/parameter/','POST',{model_type:'part.part',model_id:Number(p.partId),template:Number(p.templateId),data:p.value});
    const created=parameter(data.data,p);
    if(created.value!==p.value||b.before&&(created.id!==b.before.id||created.note!==b.before.note)||!b.before&&created.note!=='')throw Error('parameter acknowledgement mismatch');
    pk=created.id;
   }else throw Error('baseline mismatch');
   await evidence.acknowledge(binding,pk);
  }catch{return result('unknown','no durable correlated acknowledgement; never resend')}
  return this.observe(prepared,approval,evidence);
 }
 async observe(raw:Prepared,approval:unknown,evidence:NativeReceiptEvidence){
  const prepared=structuredClone(raw),{input:p,binding}=await this.validate(prepared,approval),b=prepared.baseline;
  let ack;try{ack=await evidence.read(binding)}catch{return result('unknown','private evidence unreadable')}
  if(!ack?.stockId)return result('unknown','no correlated acknowledgement; never resend');
  try{
   if(await this.target(p.kind,false)!==prepared.schemaSha256)return result('unknown','schema changed');
   const fresh=await this.current(p),pk=id(ack.stockId);
   if(p.kind==='source'&&b.kind==='source'&&fresh.kind==='source'){
    const created=fresh.rows.find(r=>r.id===pk);if(!created)return result('unknown','acknowledged attachment not visible');
    if(created.link!==p.url||created.comment!==p.comment||created.attachment!==null&&created.attachment!==''||snapshotKey(fresh.rows.filter(r=>r.id!==pk))!==snapshotKey(b.rows))return result('blocked','attachment baseline changed');
   }else if(p.kind==='parameter'&&b.kind==='parameter'&&fresh.kind==='parameter'){
    const row=fresh.before;if(!row)return result('unknown','parameter not visible');
    if(row.id!==pk||row.value!==p.value||row.note!==(b.before?.note??''))return result('blocked','parameter readback conflict');
   }else return result('blocked','baseline kind mismatch');
   return result('verified','correlated native record and reviewed readback');
  }catch{return result('unknown','enrichment readback unavailable')}
 }
}
