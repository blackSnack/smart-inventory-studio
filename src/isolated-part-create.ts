import {fixtureEvidenceFor,type FixtureEvidenceConfig,type FixtureEvidenceStore} from './fixture-operation-evidence.js';
import {probeSchema} from './provider-schema.js';
import {InvenTreeReadProvider} from './domain.js';
import {snapshotKey} from './approved-snapshot.js';
import type {Operation,OperationTransport,Observation} from './operation-journal.js';
import {parsePartCreate as parse,partCreateId as id,partCreateBody,verifyCreatedPart,type ParsedPartCreate as Parsed} from './part-create-contract.js';
const obj=(x:unknown):Record<string,unknown>=>{if(!x||typeof x!=='object'||Array.isArray(x))throw Error('invalid Part record');return x as Record<string,unknown>};
export class IsolatedPartCreateTransport implements OperationTransport{

 private constructor(private evidence:FixtureEvidenceStore,private base:URL,private token:string,private request:typeof fetch,private read:InvenTreeReadProvider){}
 static async open(config:{base:string;token:string;fixtureOnly:true}&FixtureEvidenceConfig,request:typeof fetch){
  const evidence=fixtureEvidenceFor(config);const b=new URL(config.base.endsWith('/')?config.base:config.base+'/');if(config.fixtureOnly!==true||b.protocol!=='https:'||!b.hostname.endsWith('.test')||b.username||b.password||b.search||b.hash||!config.token.trim())throw Error('isolated fixture configuration required');
  const e=await probeSchema(b.href,config.token,[{key:'category',path:'/api/part/category/{id}/',method:'get'},{key:'parts',path:'/api/part/',method:'get'},{key:'create',path:'/api/part/',method:'post'},{key:'stock',path:'/api/stock/',method:'get'},{key:'parameters',path:'/api/parameter/',method:'get'}],request);
  if(e.operations.some(o=>!o.declared))throw Error('Part create API not declared');return new IsolatedPartCreateTransport(evidence,b,config.token,request,new InvenTreeReadProvider(b.href,config.token,request));
 }
 private async call(path:string,method:'GET'|'POST',body?:Record<string,unknown>){const r=await this.request(new URL(path,this.base),{method,headers:{Authorization:'Token '+this.token,Accept:'application/json',...(body?{'Content-Type':'application/json'}:{})},redirect:'error',cache:'no-store',signal:AbortSignal.timeout(20000),...(body?{body:JSON.stringify(body)}:{})});if(!r.ok)throw Error('Part HTTP '+r.status);return obj(await r.json())}
 private async category(p:Parsed){const c=await this.call('api/part/category/'+p.categoryId+'/','GET');if(id(c.pk)!==p.categoryId||c.name!==p.categoryName||c.structural!==false)throw Error('approved category changed')}
 private async matching(p:Parsed){const rows=(await this.read.list('api/part/',{IPN:p.ipn})).map(obj),ids=rows.map(r=>id(r.pk));if(new Set(ids).size!==ids.length||rows.some(r=>r.IPN!==p.ipn))throw Error('invalid exact IPN lookup');return rows}
 async send(o:Operation){const s=structuredClone(o),p=parse(s),key=snapshotKey(s);if(!await this.evidence.claim(s))throw Error('already attempted; readback only');
  await this.category(p);if((await this.matching(p)).length)throw Error('existing IPN requires review');
  const result=await this.call('api/part/','POST',partCreateBody(p));await this.evidence.record(s,{key,id:verifyCreatedPart(result,p)});
 }
 async observe(o:Operation):Promise<Observation>{try{const s=structuredClone(o),p=parse(s),ack=await this.evidence.read<{key:string;id:string}>(s);if(!ack||ack.key!==snapshotKey(s))return {status:'unknown',evidence:'Fixture: no correlated Part create acknowledgement; no replay'};
  await this.category(p);const rows=await this.matching(p);if(rows.length!==1||id(rows[0].pk)!==ack.id)return {status:'blocked',evidence:'Fixture: Part IPN or identity conflict'};
  try{verifyCreatedPart(rows[0],p)}catch{return {status:'blocked',evidence:'Fixture: Part fields changed'}}
  if((await this.read.getStockByPart(ack.id)).length)return {status:'blocked',evidence:'Fixture: unexpected initial stock record'};
  if((await this.read.list('api/parameter/',{model_type:'part.part',model_id:ack.id})).length)return {status:'blocked',evidence:'Fixture: unexpected initial parameter record'};
  return {status:'verified',evidence:'Fixture: acknowledged partial Part record; no initial stock or parameter records read back'};
 }catch{return {status:'unknown',evidence:'Fixture: Part readback unavailable'}}}
}
