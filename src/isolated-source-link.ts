import {probeSchema} from './provider-schema.js';
import {InvenTreeReadProvider} from './domain.js';
import {snapshotKey} from './approved-snapshot.js';
import type {Operation,OperationTransport,Observation} from './operation-journal.js';
const obj=(x:unknown):Record<string,unknown>=>{if(!x||typeof x!=='object'||Array.isArray(x))throw Error('invalid attachment record');return x as Record<string,unknown>};
const id=(x:unknown):string=>{const s=typeof x==='number'&&Number.isSafeInteger(x)?String(x):x;if(typeof s!=='string'||!(/^[1-9][0-9]{0,15}$/).test(s)||!Number.isSafeInteger(Number(s)))throw Error('invalid attachment ID');return s};
const text=(x:unknown,max=4000):string=>{if(typeof x!=='string'||x.length>max)throw Error('invalid attachment text');return x};
function safeUrl(x:unknown){const u=new URL(text(x));if(u.protocol!=='https:'||u.username||u.password)throw Error('invalid reviewed link');return u.href}
type LinkRow={id:string;link:string|null;comment:string;attachment:string|null};
function row(raw:unknown,partId:string):LinkRow{const r=obj(raw);if(r.model_type!=='part'||id(r.model_id)!==partId)throw Error('attachment scope changed');return {id:id(r.pk),link:r.link===null?null:text(r.link),comment:text(r.comment),attachment:r.attachment===null?null:text(r.attachment)}}
function parse(o:Operation){if(o.kind!=='set-part-source'||!o.id.trim())throw Error('unsupported source operation');const p=o.payload;if(p.sourceReviewed!==true||p.expectedAbsent!==true)throw Error('explicit source approval required');const partId=id(p.partId),ipn=text(p.ipn,100),url=safeUrl(p.url),comment=text(p.comment,250);if(!ipn.trim()||!comment.trim())throw Error('reviewed identity and label required');return {partId,ipn,url,comment}}
type Parsed=ReturnType<typeof parse>;
const equivalent=(r:LinkRow,url:string)=>{try{return r.link!==null&&safeUrl(r.link)===url}catch{return false}};
export class IsolatedSourceLinkTransport implements OperationTransport{
 private attempted=new Set<string>();private ack=new Map<string,{key:string;id:string;before:LinkRow[]}>();
 private constructor(private base:URL,private token:string,private request:typeof fetch,private read:InvenTreeReadProvider){}
 static async open(config:{base:string;token:string;fixtureOnly:true},request:typeof fetch){
  const b=new URL(config.base.endsWith('/')?config.base:config.base+'/');if(config.fixtureOnly!==true||b.protocol!=='https:'||!b.hostname.endsWith('.test')||b.username||b.password||b.search||b.hash||!config.token.trim())throw Error('isolated fixture configuration required');
  const e=await probeSchema(b.href,config.token,[{key:'part',path:'/api/part/{id}/',method:'get'},{key:'attachments',path:'/api/attachment/',method:'get'},{key:'create',path:'/api/attachment/',method:'post'}],request);
  if(e.operations.some(o=>!o.declared))throw Error('source API not declared');return new IsolatedSourceLinkTransport(b,config.token,request,new InvenTreeReadProvider(b.href,config.token,request));
 }
 private async call(path:string,method:'GET'|'POST',body?:Record<string,unknown>){const r=await this.request(new URL(path,this.base),{method,headers:{Authorization:'Token '+this.token,Accept:'application/json',...(body?{'Content-Type':'application/json'}:{})},redirect:'error',cache:'no-store',signal:AbortSignal.timeout(20000),...(body?{body:JSON.stringify(body)}:{})});if(!r.ok)throw Error('source HTTP '+r.status);return obj(await r.json())}
 private async current(p:Parsed){const part=await this.call('api/part/'+p.partId+'/','GET');if(id(part.pk)!==p.partId||part.IPN!==p.ipn||part.active!==true)throw Error('Part identity changed');const rows=(await this.read.list('api/attachment/',{model_type:'part',model_id:p.partId})).map(r=>row(r,p.partId));if(new Set(rows.map(r=>r.id)).size!==rows.length)throw Error('duplicate attachment ID');return rows.sort((a,b)=>a.id.localeCompare(b.id))}
 async send(o:Operation){const s=structuredClone(o),p=parse(s),key=snapshotKey(s);if(this.attempted.has(s.id))throw Error('already attempted; readback only');this.attempted.add(s.id);const before=await this.current(p);if(before.some(r=>equivalent(r,p.url)))throw Error('existing source link requires review');
  const result=row(await this.call('api/attachment/','POST',{model_type:'part',model_id:Number(p.partId),link:p.url,comment:p.comment}),p.partId);
  if(result.link!==p.url||result.comment!==p.comment||result.attachment!==null&&result.attachment!==''||before.some(r=>r.id===result.id))throw Error('source acknowledgement mismatch');this.ack.set(s.id,{key,id:result.id,before});
 }
 async observe(o:Operation):Promise<Observation>{try{const s=structuredClone(o),p=parse(s),ack=this.ack.get(s.id),rows=await this.current(p);if(!ack||ack.key!==snapshotKey(s))return {status:'unknown',evidence:'Fixture: no correlated link acknowledgement; no replay'};
  const created=rows.find(r=>r.id===ack.id);if(!created)return {status:'unknown',evidence:'Fixture: acknowledged attachment not visible'};
  if(created.link!==p.url||created.comment!==p.comment||created.attachment!==null&&created.attachment!==''||snapshotKey(rows.filter(r=>r.id!==ack.id))!==snapshotKey(ack.before))return {status:'blocked',evidence:'Fixture: link or attachment baseline changed'};
  return {status:'verified',evidence:'Fixture: acknowledged link and existing attachment references read back'};
 }catch{return {status:'unknown',evidence:'Fixture: source readback unavailable'}}}
}
