import {fixtureEvidenceFor,type FixtureEvidenceConfig,type FixtureEvidenceStore} from './fixture-operation-evidence.js';
import {probeSchema} from './provider-schema.js';
import {InvenTreeReadProvider} from './domain.js';
import {snapshotKey} from './approved-snapshot.js';
import type {Operation,OperationTransport,Observation} from './operation-journal.js';
const obj=(x:unknown):Record<string,unknown>=>{if(!x||typeof x!=='object'||Array.isArray(x))throw Error('invalid parameter record');return x as Record<string,unknown>};
const id=(x:unknown):string=>{const s=typeof x==='number'&&Number.isSafeInteger(x)?String(x):x;if(typeof s!=='string'||!(/^[1-9][0-9]{0,15}$/).test(s)||!Number.isSafeInteger(Number(s)))throw Error('invalid parameter ID');return s};
const str=(x:unknown,max=4000):string=>{if(typeof x!=='string'||x.length>max)throw Error('invalid parameter text');return x};
type ValueRow={id:string;value:string;note:string};
function parse(o:Operation){
 if(o.kind!=='set-part-parameter'||!o.id.trim())throw Error('unsupported parameter operation');
 const p=o.payload,partId=id(p.partId),templateId=id(p.templateId),templateName=str(p.templateName,100),units=str(p.units,100),value=str(p.value);
 if(!templateName.trim()||!value.trim()||!Array.isArray(p.evidence)||!p.evidence.length||p.evidence.length>20)throw Error('reviewed value and evidence required');
 for(const x of p.evidence){const e=obj(x),url=new URL(str(e.url)),locator=str(e.locator,1000);if(url.protocol!=='https:'||url.username||url.password||!locator.trim())throw Error('invalid source evidence')}
 let before:ValueRow|null=null;
 if(p.before!==null){const b=obj(p.before);before={id:id(b.id),value:str(b.value),note:str(b.note)};if(before.value===value||before.value.trim()&&p.allowCorrection!==true)throw Error('known value correction requires approval')}
 return {partId,templateId,templateName,units,value,before};
}
type Parsed=ReturnType<typeof parse>;
function valueRow(raw:unknown,p:Parsed):ValueRow{const r=obj(raw);if(r.model_type!=='part.part'||id(r.model_id)!==p.partId||id(r.template)!==p.templateId)throw Error('parameter scope changed');return {id:id(r.pk),value:str(r.data),note:str(r.note)}}
export class IsolatedParameterWriteTransport implements OperationTransport{

 private constructor(private evidence:FixtureEvidenceStore,private base:URL,private token:string,private request:typeof fetch,private read:InvenTreeReadProvider){}
 static async open(config:{base:string;token:string;fixtureOnly:true}&FixtureEvidenceConfig,request:typeof fetch){
  const evidence=fixtureEvidenceFor(config);const b=new URL(config.base.endsWith('/')?config.base:config.base+'/');if(config.fixtureOnly!==true||b.protocol!=='https:'||!b.hostname.endsWith('.test')||b.username||b.password||b.search||b.hash||!config.token.trim())throw Error('isolated fixture configuration required');
  const e=await probeSchema(b.href,config.token,[{key:'part',path:'/api/part/{id}/',method:'get'},{key:'template',path:'/api/parameter/template/{id}/',method:'get'},{key:'parameter',path:'/api/parameter/',method:'get'},{key:'create',path:'/api/parameter/',method:'post'},{key:'patch',path:'/api/parameter/{id}/',method:'patch'}],request);
  if(e.operations.some(o=>!o.declared))throw Error('parameter API not declared');return new IsolatedParameterWriteTransport(evidence,b,config.token,request,new InvenTreeReadProvider(b.href,config.token,request));
 }
 private async call(path:string,method:'GET'|'POST'|'PATCH',body?:Record<string,unknown>){const r=await this.request(new URL(path,this.base),{method,headers:{Authorization:'Token '+this.token,Accept:'application/json',...(body?{'Content-Type':'application/json'}:{})},redirect:'error',cache:'no-store',signal:AbortSignal.timeout(20000),...(body?{body:JSON.stringify(body)}:{})});if(!r.ok)throw Error('parameter HTTP '+r.status);return obj(await r.json())}
 private async current(p:Parsed):Promise<ValueRow|null>{
  const part=await this.call('api/part/'+p.partId+'/','GET');if(id(part.pk)!==p.partId||part.active!==true)throw Error('part identity changed');
  const t=await this.call('api/parameter/template/'+p.templateId+'/','GET');
  if(id(t.pk)!==p.templateId||t.model_type!=='part.part'||t.name!==p.templateName||t.units!==p.units||t.enabled!==true||t.checkbox!==false||t.choices!==''||t.selectionlist!==null)throw Error('template definition changed or unsupported');
  const rows=(await this.read.list('api/parameter/',{model_type:'part.part',model_id:p.partId,template:p.templateId})).map(r=>valueRow(r,p));
  if(rows.length>1)throw Error('duplicate parameter records');return rows[0]??null;
 }
 async send(o:Operation){
  const snapshot=structuredClone(o),p=parse(snapshot),key=snapshotKey(snapshot);if(!await this.evidence.claim(snapshot))throw Error('already attempted; readback only');
  if(snapshotKey(await this.current(p))!==snapshotKey(p.before))throw Error('approved parameter baseline changed');
  const raw=p.before?await this.call('api/parameter/'+p.before.id+'/','PATCH',{data:p.value}):await this.call('api/parameter/','POST',{model_type:'part.part',model_id:Number(p.partId),template:Number(p.templateId),data:p.value});
  const row=valueRow(raw,p);if(row.value!==p.value||p.before&&(row.id!==p.before.id||row.note!==p.before.note))throw Error('parameter acknowledgement mismatch');
  await this.evidence.record(snapshot,{key,id:row.id});
 }
 async observe(o:Operation):Promise<Observation>{try{
  const snapshot=structuredClone(o),p=parse(snapshot),a=await this.evidence.read<{key:string;id:string}>(snapshot),row=await this.current(p);
  if(!a||a.key!==snapshotKey(snapshot))return {status:'unknown',evidence:'Fixture: no correlated write acknowledgement; no replay'};
  if(!row)return {status:'unknown',evidence:'Fixture: parameter not visible'};
  if(row.id!==a.id||row.value!==p.value||p.before&&row.note!==p.before.note)return {status:'blocked',evidence:'Fixture: parameter readback conflict'};
  return {status:'verified',evidence:'Fixture: correlated parameter ID and exact value read back'};
 }catch{return {status:'unknown',evidence:'Fixture: parameter readback unavailable'}}}
}
