import {assertLocalOperationContext,type LocalOperationContext} from './local-operation-context.js';
import {fixtureEvidenceFor,type FixtureEvidenceConfig,type FixtureEvidenceStore} from './fixture-operation-evidence.js';
import {probeSchema} from './provider-schema.js';
import {InvenTreeReadProvider} from './domain.js';
import {InvenTreeReadAdapter,type LocationSummary} from './inventory-provider.js';
import {snapshotKey} from './approved-snapshot.js';
import type {Operation,OperationTransport,Observation} from './operation-journal.js';
const obj=(x:unknown):Record<string,unknown>=>{if(!x||typeof x!=='object'||Array.isArray(x))throw Error('invalid location record');return x as Record<string,unknown>};
const id=(x:unknown):string=>{const s=typeof x==='number'&&Number.isSafeInteger(x)?String(x):x;if(typeof s!=='string'||!(/^[1-9][0-9]{0,15}$/).test(s)||!Number.isSafeInteger(Number(s)))throw Error('invalid location ID');return s};
const text=(x:unknown,max:number,empty=false):string=>{if(typeof x!=='string'||x.length>max||(!empty&&!x.trim())||/[\u0000-\u001f]/.test(x))throw Error('invalid location field');return x};
function parse(o:Operation){
 if(o.kind!=='create-location'||!o.id.trim())throw Error('unsupported location operation');
 const p=o.payload;if(p.expectedAbsent!==true||p.physicalConfirmed!==true||typeof p.structural!=='boolean')throw Error('explicit physical layout approval required');
 const parentId=p.parentId===null?null:id(p.parentId),parentName=parentId===null?null:text(p.parentName,128),name=text(p.name,128),description=text(p.description,250,true);
 if(name!==name.trim()||parentId===null&&p.parentName!==null)throw Error('invalid location approval');
 return {parentId,parentName,name,description,structural:p.structural};
}
type Parsed=ReturnType<typeof parse>;
const sorted=(rows:LocationSummary[])=>rows.slice().sort((a,b)=>a.id.localeCompare(b.id));
export class IsolatedLocationCreateTransport implements OperationTransport{

 private constructor(private evidence:FixtureEvidenceStore,private base:URL,private token:string,private request:typeof fetch,private read:InvenTreeReadProvider,private locations:InvenTreeReadAdapter){}
 static async open(config:{base:string;token:string;fixtureOnly:true}&FixtureEvidenceConfig,request:typeof fetch){
  const evidence=fixtureEvidenceFor(config);const b=new URL(config.base.endsWith('/')?config.base:config.base+'/');if(config.fixtureOnly!==true||b.protocol!=='https:'||!b.hostname.endsWith('.test')||b.username||b.password||b.search||b.hash||!config.token.trim())throw Error('isolated fixture configuration required');
  return IsolatedLocationCreateTransport.openTransport(b,config,request,evidence);
 }
 static async openLocalAcceptance(ctx:LocalOperationContext,evidence:FixtureEvidenceStore){
  assertLocalOperationContext(ctx,evidence);const config={token:ctx.token},request=ctx.request,b=new URL(ctx.base);
  return IsolatedLocationCreateTransport.openTransport(b,config,request,evidence);
 }
 private static async openTransport(b:URL,config:{token:string},request:typeof fetch,evidence:FixtureEvidenceStore){
  const e=await probeSchema(b.href,config.token,[{key:'locations',path:'/api/stock/location/',method:'get'},{key:'create',path:'/api/stock/location/',method:'post'},{key:'detail',path:'/api/stock/location/{id}/',method:'get'},{key:'stock',path:'/api/stock/',method:'get'}],request);
  if(e.operations.some(o=>!o.declared))throw Error('location create API not declared');return new IsolatedLocationCreateTransport(evidence,b,config.token,request,new InvenTreeReadProvider(b.href,config.token,request),new InvenTreeReadAdapter(b.href,config.token,request));
 }
 private async call(path:string,method:'GET'|'POST',body?:Record<string,unknown>){const r=await this.request(new URL(path,this.base),{method,headers:{Authorization:'Token '+this.token,Accept:'application/json',...(body?{'Content-Type':'application/json'}:{})},redirect:'error',cache:'no-store',signal:AbortSignal.timeout(20000),...(body?{body:JSON.stringify(body)}:{})});if(!r.ok)throw Error('location HTTP '+r.status);return obj(await r.json())}
 private parent(rows:LocationSummary[],p:Parsed){if(p.parentId!==null&&!rows.some(x=>x.id===p.parentId&&x.name===p.parentName&&x.structural))throw Error('approved structural parent changed')}
 private verify(raw:unknown,p:Parsed){const r=obj(raw);if(r.name!==p.name||r.description!==p.description||(r.parent===null?null:id(r.parent))!==p.parentId||r.structural!==p.structural||r.external!==false||r.exclude_from_stock!==false)throw Error('location readback mismatch');return id(r.pk)}
 async send(o:Operation){const s=structuredClone(o),p=parse(s),key=snapshotKey(s);if(!await this.evidence.claim(s))throw Error('already attempted; readback only');
  const before=sorted(await this.locations.getLocations());this.parent(before,p);
  if(before.some(x=>x.parentId===p.parentId&&x.name.trim().toLowerCase()===p.name.toLowerCase()))throw Error('existing sibling requires review');
  const result=await this.call('api/stock/location/','POST',{name:p.name,description:p.description,parent:p.parentId===null?null:Number(p.parentId),structural:p.structural,external:false,exclude_from_stock:false});
  const newId=this.verify(result,p);if(before.some(x=>x.id===newId))throw Error('existing ID returned for create');await this.evidence.record(s,{key,id:newId,before});
 }
 async observe(o:Operation):Promise<Observation>{try{const s=structuredClone(o),p=parse(s),a=await this.evidence.read<{key:string;id:string;before:LocationSummary[]}>(s);if(!a||a.key!==snapshotKey(s))return {status:'unknown',evidence:'Fixture: no correlated location acknowledgement; no replay'};
  const rows=sorted(await this.locations.getLocations());this.parent(rows,p);const x=rows.find(l=>l.id===a.id);
  if(!x)return {status:'unknown',evidence:'Fixture: acknowledged location not visible'};
  if(x.name!==p.name||x.parentId!==p.parentId||x.structural!==p.structural||snapshotKey(rows.filter(l=>l.id!==a.id))!==snapshotKey(a.before))return {status:'blocked',evidence:'Fixture: location tree changed'};
  try{if(this.verify(await this.call('api/stock/location/'+a.id+'/','GET'),p)!==a.id)throw Error('wrong location ID')}catch{return {status:'blocked',evidence:'Fixture: location detail conflict'}}
  if((await this.read.list('api/stock/',{location:a.id,cascade:'false'})).length)return {status:'blocked',evidence:'Fixture: unexpected initial stock'};
  return {status:'verified',evidence:'Fixture: acknowledged location ID, unchanged tree and empty initial stock read back'};
 }catch{return {status:'unknown',evidence:'Fixture: location readback unavailable'}}}
}
