import {probeSchema} from './provider-schema.js';
import {InvenTreeReadProvider} from './domain.js';
import {snapshotKey} from './approved-snapshot.js';
import type {Operation,OperationTransport,Observation} from './operation-journal.js';
const obj=(x:unknown):Record<string,unknown>=>{if(!x||typeof x!=='object'||Array.isArray(x))throw Error('invalid Part record');return x as Record<string,unknown>};
const id=(x:unknown):string=>{const s=typeof x==='number'&&Number.isSafeInteger(x)?String(x):x;if(typeof s!=='string'||!(/^[1-9][0-9]{0,15}$/).test(s)||!Number.isSafeInteger(Number(s)))throw Error('invalid Part/category ID');return s};
const text=(x:unknown,max:number,empty=false):string=>{if(typeof x!=='string'||x.length>max||(!empty&&!x.trim())||/[\u0000-\u001f]/.test(x))throw Error('invalid Part field');return x};
function parse(o:Operation){
 if(o.kind!=='create-part'||!o.id.trim())throw Error('unsupported Part operation');const p=o.payload;
 if(p.identityMode!=='partial'||p.newPartConfirmed!==true||p.expectedAbsent!==true||p.lookupComplete!==true)throw Error('explicit new partial identity approval required');
 const ipn=text(p.ipn,100);if(ipn!==ipn.trim())throw Error('invalid IPN');
 return {ipn,categoryId:id(p.categoryId),categoryName:text(p.categoryName,100),name:text(p.name,100),description:text(p.description,250,true),units:text(p.units,20)};
}
type Parsed=ReturnType<typeof parse>;
export class IsolatedPartCreateTransport implements OperationTransport{
 private attempted=new Set<string>();private ack=new Map<string,{key:string;id:string}>();
 private constructor(private base:URL,private token:string,private request:typeof fetch,private read:InvenTreeReadProvider){}
 static async open(config:{base:string;token:string;fixtureOnly:true},request:typeof fetch){
  const b=new URL(config.base.endsWith('/')?config.base:config.base+'/');if(config.fixtureOnly!==true||b.protocol!=='https:'||!b.hostname.endsWith('.test')||b.username||b.password||b.search||b.hash||!config.token.trim())throw Error('isolated fixture configuration required');
  const e=await probeSchema(b.href,config.token,[{key:'category',path:'/api/part/category/{id}/',method:'get'},{key:'parts',path:'/api/part/',method:'get'},{key:'create',path:'/api/part/',method:'post'},{key:'stock',path:'/api/stock/',method:'get'}],request);
  if(e.operations.some(o=>!o.declared))throw Error('Part create API not declared');return new IsolatedPartCreateTransport(b,config.token,request,new InvenTreeReadProvider(b.href,config.token,request));
 }
 private async call(path:string,method:'GET'|'POST',body?:Record<string,unknown>){const r=await this.request(new URL(path,this.base),{method,headers:{Authorization:'Token '+this.token,Accept:'application/json',...(body?{'Content-Type':'application/json'}:{})},redirect:'error',cache:'no-store',signal:AbortSignal.timeout(20000),...(body?{body:JSON.stringify(body)}:{})});if(!r.ok)throw Error('Part HTTP '+r.status);return obj(await r.json())}
 private async category(p:Parsed){const c=await this.call('api/part/category/'+p.categoryId+'/','GET');if(id(c.pk)!==p.categoryId||c.name!==p.categoryName||c.structural!==false)throw Error('approved category changed')}
 private async matching(p:Parsed){const rows=(await this.read.list('api/part/',{IPN:p.ipn})).map(obj),ids=rows.map(r=>id(r.pk));if(new Set(ids).size!==ids.length||rows.some(r=>r.IPN!==p.ipn))throw Error('invalid exact IPN lookup');return rows}
 private verify(raw:unknown,p:Parsed){const r=obj(raw);if(r.IPN!==p.ipn||r.name!==p.name||r.description!==p.description||r.units!==p.units||id(r.category)!==p.categoryId||r.active!==true||r.virtual!==false||r.trackable!==false||r.is_template!==false||r.assembly!==false||r.component!==true)throw Error('Part readback mismatch');return id(r.pk)}
 async send(o:Operation){const s=structuredClone(o),p=parse(s),key=snapshotKey(s);if(this.attempted.has(s.id))throw Error('already attempted; readback only');this.attempted.add(s.id);
  await this.category(p);if((await this.matching(p)).length)throw Error('existing IPN requires review');
  const result=await this.call('api/part/','POST',{IPN:p.ipn,name:p.name,description:p.description,category:Number(p.categoryId),units:p.units,active:true,virtual:false,trackable:false,is_template:false,assembly:false,component:true});this.ack.set(s.id,{key,id:this.verify(result,p)});
 }
 async observe(o:Operation):Promise<Observation>{try{const s=structuredClone(o),p=parse(s),ack=this.ack.get(s.id);if(!ack||ack.key!==snapshotKey(s))return {status:'unknown',evidence:'Fixture: no correlated Part create acknowledgement; no replay'};
  await this.category(p);const rows=await this.matching(p);if(rows.length!==1||id(rows[0].pk)!==ack.id)return {status:'blocked',evidence:'Fixture: Part IPN or identity conflict'};
  try{this.verify(rows[0],p)}catch{return {status:'blocked',evidence:'Fixture: Part fields changed'}}
  if((await this.read.getStockByPart(ack.id)).length)return {status:'blocked',evidence:'Fixture: unexpected initial stock record'};
  return {status:'verified',evidence:'Fixture: acknowledged partial Part record and no initial stock read back'};
 }catch{return {status:'unknown',evidence:'Fixture: Part readback unavailable'}}}
}
