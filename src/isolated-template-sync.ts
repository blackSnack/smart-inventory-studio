import {fixtureEvidenceFor,type FixtureEvidenceConfig,type FixtureEvidenceStore} from './fixture-operation-evidence.js';
import {probeSchema} from './provider-schema.js';
import {InvenTreeReadProvider} from './domain.js';
import {snapshotKey} from './approved-snapshot.js';
import type {Operation,OperationTransport,Observation} from './operation-journal.js';
const object=(x:unknown):Record<string,unknown>=>{if(!x||typeof x!=='object'||Array.isArray(x))throw Error('invalid schema record');return x as Record<string,unknown>};
const id=(x:unknown):string=>{const s=typeof x==='number'&&Number.isSafeInteger(x)?String(x):x;if(typeof s!=='string'||!(/^[1-9][0-9]{0,15}$/).test(s)||!Number.isSafeInteger(Number(s)))throw Error('invalid ID');return s};
const parent=(x:unknown)=>x===null?null:id(x);
const text=(x:unknown,max:number,empty=false):string=>{if(typeof x!=='string'||x.length>max||(!empty&&!x.trim())||/[\u0000-\u001f]/.test(x))throw Error('invalid schema text');return x};
const norm=(s:string)=>s.trim().toLowerCase();
type Category={kind:'category';name:string;parentId:string|null;description:string;structural:boolean};
type Template={kind:'template';name:string;units:string;description:string};
type Definition=Category|Template;
function parse(o:Operation):Definition{
 if(!o.id.trim())throw Error('invalid operation ID');const p=o.payload;
 if(p.expectedAbsent!==true)throw Error('explicit create approval required');
 const name=text(p.name,100),description=text(p.description,250,true);
 if(o.kind==='create-category'){if(typeof p.structural!=='boolean')throw Error('missing structural flag');return {kind:'category',name,parentId:parent(p.parentId),description,structural:p.structural}}
 // Initial fixture supports scalar text templates only. Numeric/enum/boolean semantic mapping requires separate evidence.
 if(o.kind==='create-parameter-template'&&p.modelType==='part.part'&&p.fieldType==='string')return {kind:'template',name,description,units:text(p.units,100,true)};
 throw Error('unsupported schema creation');
}
type RecordRow={id:string;definition:Definition};
function readRow(raw:unknown,kind:Definition['kind']):RecordRow{
 const r=object(raw),pk=id(r.pk),name=text(r.name,100),description=text(r.description,250,true);
 if(kind==='category'){if(typeof r.structural!=='boolean')throw Error('invalid category structure');return {id:pk,definition:{kind,name,description,parentId:parent(r.parent),structural:r.structural}}}
 if((r.model_type!=='part.part'&&r.model_type!==null)||typeof r.checkbox!=='boolean'||typeof r.enabled!=='boolean'||typeof r.choices!=='string')throw Error('unexpected template model or shape');
 // Keep conflict detection for existing enum/disabled definitions too; do not silently reuse them.
 return {id:pk,definition:{kind,name,description,units:text(r.units,100,true)}};
}
const path=(d:Definition)=>d.kind==='category'?'api/part/category/':'api/parameter/template/';
const conflict=(a:Definition,b:Definition)=>a.kind===b.kind&&norm(a.name)===norm(b.name)&&(a.kind!=='category'||b.kind==='category'&&a.parentId===b.parentId);
export class IsolatedTemplateSyncTransport implements OperationTransport{

 private constructor(private evidence:FixtureEvidenceStore,private base:URL,private token:string,private request:typeof fetch,private read:InvenTreeReadProvider){}
 static async open(config:{base:string;token:string;fixtureOnly:true}&FixtureEvidenceConfig,request:typeof fetch){
  const evidence=fixtureEvidenceFor(config);const b=new URL(config.base.endsWith('/')?config.base:config.base+'/');if(config.fixtureOnly!==true||b.protocol!=='https:'||!b.hostname.endsWith('.test')||b.username||b.password||b.search||b.hash||!config.token.trim())throw Error('isolated fixture configuration required');
  const required=(['/api/part/category/','/api/parameter/template/'] as const).flatMap((path,i)=>(['get','post'] as const).map(method=>({key:i+method,path,method})));
  const e=await probeSchema(b.href,config.token,required,request);if(e.operations.some(o=>!o.declared))throw Error('schema sync API not declared');
  return new IsolatedTemplateSyncTransport(evidence,b,config.token,request,new InvenTreeReadProvider(b.href,config.token,request));
 }
 private async rows(d:Definition){const records=(await this.read.list(path(d),d.kind==='template'?{for_model:'part.part'}:{})).map(x=>readRow(x,d.kind));if(new Set(records.map(x=>x.id)).size!==records.length)throw Error('duplicate schema ID');return records}
 private verify(raw:unknown,d:Definition){const row=readRow(raw,d.kind);if(snapshotKey(row.definition)!==snapshotKey(d))throw Error('schema readback mismatch');if(d.kind==='template'){const r=object(raw);if(r.model_type!=='part.part'||r.enabled!==true||r.checkbox!==false||r.choices!==''||r.selectionlist!==null)throw Error('template semantic mismatch')}return row.id}
 async send(o:Operation){
  const snapshot=structuredClone(o),d=parse(snapshot),key=snapshotKey(snapshot);if(!await this.evidence.claim(snapshot))throw Error('already attempted; readback only');
  const rows=await this.rows(d);if(d.kind==='category'&&d.parentId!==null&&!rows.some(r=>r.id===d.parentId))throw Error('category parent missing');if(rows.some(r=>conflict(r.definition,d)))throw Error('existing name requires explicit mapping, not creation');
  const body=d.kind==='category'?{name:d.name,parent:d.parentId===null?null:Number(d.parentId),description:d.description,structural:d.structural}:{name:d.name,units:d.units,description:d.description,model_type:'part.part',enabled:true,checkbox:false,choices:'',selectionlist:null};
  const res=await this.request(new URL(path(d),this.base),{method:'POST',headers:{Authorization:'Token '+this.token,Accept:'application/json','Content-Type':'application/json'},cache:'no-store',redirect:'error',signal:AbortSignal.timeout(20000),body:JSON.stringify(body)});
  if(!res.ok)throw Error('schema create HTTP '+res.status);const pk=this.verify(await res.json(),d);if(rows.some(r=>r.id===pk))throw Error('existing ID returned for create');await this.evidence.record(snapshot,{key,id:pk});
 }
 async observe(o:Operation):Promise<Observation>{try{
  const snapshot=structuredClone(o),d=parse(snapshot),ack=await this.evidence.read<{key:string;id:string}>(snapshot);if(!ack||ack.key!==snapshotKey(snapshot))return {status:'unknown',evidence:'Fixture: no correlated create acknowledgement; no replay'};
  const raw=await this.read.list(path(d),d.kind==='template'?{for_model:'part.part'}:{}),rows=raw.map(x=>readRow(x,d.kind));if(new Set(rows.map(r=>r.id)).size!==rows.length)throw Error('duplicate schema ID');
  const matched=rows.filter(r=>conflict(r.definition,d));if(matched.length!==1||matched[0].id!==ack.id)return {status:'blocked',evidence:'Fixture: schema name or ID changed'};
  if(d.kind==='category'&&d.parentId!==null&&!rows.some(r=>r.id===d.parentId))return {status:'blocked',evidence:'Fixture: category parent changed'};
  try{this.verify(raw[rows.findIndex(r=>r.id===ack.id)],d)}catch{return {status:'blocked',evidence:'Fixture: schema definition changed'}}
  return {status:'verified',evidence:'Fixture: acknowledged schema ID and exact definition read back'};
 }catch{return {status:'unknown',evidence:'Fixture: schema readback unavailable'}}}
}
