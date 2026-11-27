import {assertLocalOperationContext,type LocalOperationContext} from './local-operation-context.js';
import {probeSchema} from './provider-schema.js';
import {readCabinetMetadata} from './cabinet-metadata.js';
import {InvenTreeReadAdapter,type LocationSummary} from './inventory-provider.js';
import type {Operation,OperationTransport,Observation} from './operation-journal.js';
// Explicit fixture-only transport. Never constructed by the production PWA.
// The running server's version, model identifier, permissions and concurrency semantics require separate approval.
const required=[{key:'location-list',path:'/api/stock/location/',method:'get'},{key:'rename-location',path:'/api/stock/location/{id}/',method:'patch'},{key:'metadata-read',path:'/api/metadata/{model}/{id}/',method:'get'},{key:'metadata-write',path:'/api/metadata/{model}/{id}/',method:'patch'}] as const;
const obj=(x:unknown):x is Record<string,unknown>=>!!x&&typeof x==='object'&&!Array.isArray(x);
const id=(x:unknown)=>{if(typeof x!=='string'||!/^\d{1,18}$/.test(x)||/^0+$/.test(x))throw Error('invalid provider location ID');return x};
const name=(x:unknown)=>{if(typeof x!=='string'||!x.trim()||x.length>128||/[\u0000-\u001f]/.test(x))throw Error('invalid location name');return x};
const norm=(x:string)=>x.trim().toLowerCase();
const canon=(x:unknown):string=>{if(x===null||typeof x==='string'||typeof x==='boolean'||typeof x==='number'&&Number.isFinite(x))return JSON.stringify(x);if(Array.isArray(x))return '['+x.map(canon).join(',')+']';if(obj(x))return '{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+canon(x[k])).join(',')+'}';throw Error('invalid metadata')};
const equal=(a:unknown,b:unknown)=>canon(a)===canon(b);
type Rename={kind:'rename';locationId:string;parentId:string;from:string;to:string};
type Meta={kind:'metadata';locationId:string;before:Record<string,unknown>;after:Record<string,unknown>;leaves:{locationId:string;parentId:string;name:string}[]};
function parse(operation:Operation):Rename|Meta{
 if(!operation.id)throw Error('missing operation ID');const p=operation.payload;
 if(operation.kind==='rename-location')return {kind:'rename',locationId:id(p.locationId),parentId:id(p.expectedParentId),from:name(p.expectedName),to:name(p.name)};
 if(operation.kind!=='update-location-metadata'||!obj(p.expectedMetadata)||!obj(p.metadata)||!Array.isArray(p.expectedLeaves)||!p.expectedLeaves.length)throw Error('unsupported migration operation');
 const leaves=p.expectedLeaves.map(x=>{if(!obj(x))throw Error('invalid leaf');return {locationId:id(x.locationId),parentId:id(x.parentId),name:name(x.name)}});
 if(new Set(leaves.map(l=>l.locationId)).size!==leaves.length)throw Error('duplicate leaf');const before=p.expectedMetadata,after=p.metadata;
 // Only Studio's namespace may change. No unrelated keys may be removed or edited.
 const without=(m:Record<string,unknown>)=>Object.fromEntries(Object.entries(m).filter(([k])=>k!=='smart_inventory'));
 if(!equal(without(before),without(after))||!obj(after.smart_inventory)||!obj(after.smart_inventory.cabinet))throw Error('invalid metadata scope');
 const oldNS=before.smart_inventory??{};if(!obj(oldNS)||!equal(Object.fromEntries(Object.entries(oldNS).filter(([k])=>k!=='cabinet')),Object.fromEntries(Object.entries(after.smart_inventory).filter(([k])=>k!=='cabinet'))))throw Error('unrelated Studio metadata changed');
 return {kind:'metadata',locationId:id(p.locationId),before,after,leaves};
}
function leaf(locations:LocationSummary[],locationId:string,parentId:string){const x=locations.find(l=>l.id===locationId);if(!x||x.parentId!==parentId||x.structural||locations.some(l=>l.parentId===locationId))throw Error('location precondition changed');return x}
export class IsolatedLocationTransport implements OperationTransport{
 private constructor(private base:URL,private token:string,private metadataModel:string,private request:typeof fetch,private adapter:InvenTreeReadAdapter){}
 static async open(config:{base:string;token:string;metadataModel:string;fixtureOnly:true},request:typeof fetch){
  const u=new URL(config.base.endsWith('/')?config.base:config.base+'/');if(config.fixtureOnly!==true||u.protocol!=='https:'||!u.hostname.endsWith('.test')||u.username||u.password||u.search||u.hash||!config.token.trim()||!/^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)?$/.test(config.metadataModel))throw Error('isolated fixture configuration required');
  return IsolatedLocationTransport.openTransport(u,config,request);
 }
 static async openLocalAcceptance(ctx:LocalOperationContext){
  assertLocalOperationContext(ctx);const config={token:ctx.token,metadataModel:'stocklocation'},request=ctx.request,u=new URL(ctx.base);
  return IsolatedLocationTransport.openTransport(u,config,request);
 }
 private static async openTransport(u:URL,config:{token:string;metadataModel:string},request:typeof fetch){
  const evidence=await probeSchema(u.href,config.token,[...required],request);if(evidence.operations.some(o=>!o.declared))throw Error('migration API not declared');
  return new IsolatedLocationTransport(u,config.token,config.metadataModel,request,new InvenTreeReadAdapter(u.href,config.token,request));
 }
 private async call(path:string,method:'GET'|'PATCH',body?:Record<string,unknown>){const r=await this.request(new URL(path,this.base),{method,headers:{Authorization:'Token '+this.token,Accept:'application/json',...(body?{'Content-Type':'application/json'}:{})},redirect:'error',cache:'no-store',signal:AbortSignal.timeout(20000),...(body?{body:JSON.stringify(body)}:{})});if(!r.ok)throw Error('migration HTTP '+r.status);return r.json()}
 private async locations(){const l=await this.adapter.getLocations();if(new Set(l.map(x=>x.id)).size!==l.length)throw Error('duplicate locations');return l}
 private metadataPath(locationId:string){return 'api/metadata/'+this.metadataModel+'/'+locationId+'/'}
 private async metadata(locationId:string){const r=await this.call(this.metadataPath(locationId),'GET');if(!obj(r)||!obj(r.metadata))throw Error('invalid metadata response');return r.metadata}
 private verifyLeaves(o:Meta,l:LocationSummary[]){const root=l.find(x=>x.id===o.locationId);if(!root?.structural)throw Error('root changed');const binding=readCabinetMetadata(o.after,l,o.locationId);const compartments=binding?.layout.cells.flatMap(c=>c.drawer.compartments)??[];if(!binding||binding.revision!==0||binding.leafBindings.length!==compartments.length||binding.leafBindings.length!==o.leaves.length||binding.leafBindings.some(b=>!o.leaves.some(x=>x.locationId===b.locationId))||readCabinetMetadata(o.before,l,o.locationId)!==null)throw Error('invalid legacy binding');for(const expected of o.leaves){const x=leaf(l,expected.locationId,expected.parentId);if(x.name!==expected.name)throw Error('leaf name changed');let parent=x.parentId;const seen=new Set([x.id]);while(parent&&parent!==root.id){if(seen.has(parent))throw Error('cyclic tree');seen.add(parent);parent=l.find(y=>y.id===parent)?.parentId??null}if(parent!==root.id)throw Error('leaf outside root')}}
 async send(operation:Operation){const o=parse(operation),l=await this.locations();
  if(o.kind==='rename'){const x=leaf(l,o.locationId,o.parentId);if(x.name!==o.from||l.some(y=>y.id!==x.id&&y.parentId===x.parentId&&norm(y.name)===norm(o.to)))throw Error('rename precondition changed');await this.call('api/stock/location/'+o.locationId+'/','PATCH',{name:o.to});return}
  this.verifyLeaves(o,l);if(!equal(await this.metadata(o.locationId),o.before))throw Error('metadata precondition changed');await this.call(this.metadataPath(o.locationId),'PATCH',{metadata:o.after});
 }
 async observe(operation:Operation):Promise<Observation>{try{const o=parse(operation),l=await this.locations();if(o.kind==='rename'){const x=leaf(l,o.locationId,o.parentId);if(l.some(y=>y.id!==x.id&&y.parentId===x.parentId&&norm(y.name)===norm(o.to)))return {status:'blocked',evidence:'Fixture: sibling name conflict'};if(x.name===o.to)return {status:'verified',evidence:'Fixture: original location ID and parent retained, target name read back'};if(x.name===o.from)return {status:'unknown',evidence:'Fixture: old name remains; no automatic replay'};return {status:'blocked',evidence:'Fixture: unexpected location name'}}this.verifyLeaves(o,l);const m=await this.metadata(o.locationId);if(equal(m,o.after))return {status:'verified',evidence:'Fixture: expected metadata and all leaf references read back'};if(equal(m,o.before))return {status:'unknown',evidence:'Fixture: original metadata remains; no automatic replay'};return {status:'blocked',evidence:'Fixture: unexpected metadata'}}catch{return {status:'unknown',evidence:'Fixture: readback unavailable or preconditions changed'}}}
}
