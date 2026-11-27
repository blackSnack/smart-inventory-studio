import {readNativeStockByLocation,verifyLegacyLocationAncestors} from './native-legacy-stock.js';
import {nativeApiVersion,matchesPreparedApi} from './native-api-version.js';
import {verifyNativeLayoutStock} from './native-layout-migration.js';
import {retiredLocationName} from './native-retired-location.js';
import {authorizedNativeBase,assertNativeTarget,assertNativeMode,nativeCatalogHash,type ProductionNativeTarget} from './native-production-authorization.js';
// Explicit local disposable-instance execution; no PWA capability is enabled.
import {createLocalOperationContext,type LocalOperationContext} from './local-operation-context.js';
import {IsolatedTemplateSyncTransport} from './isolated-template-sync.js';
import {IsolatedCategoryAssociationTransport,planIsolatedAssociation} from './isolated-category-association.js';
import {IsolatedLocationCreateTransport} from './isolated-location-create.js';
import {IsolatedLocationTransport} from './isolated-location-transport.js';
import {IsolatedStockTransferTransport} from './isolated-stock-transfer.js';
import {InvenTreeReadProvider} from './domain.js';
import {InvenTreeReadAdapter} from './inventory-provider.js';
import {snapshotKey} from './approved-snapshot.js';
import {validateCatalog,type Catalog} from './catalog.js';
import type {ScalarTypeReview} from './inventree-association-read.js';
import type {FixtureEvidenceStore} from './fixture-operation-evidence.js';
import type {Operation,OperationTransport} from './operation-journal.js';

const kinds=['create-category','create-parameter-template','associate-category-template','create-location','rename-location','update-location-metadata','transfer-stock'] as const;
type Kind=typeof kinds[number];
type Wire={method:'POST'|'PATCH';path:string;body:unknown};
type ReadTrace={path:string;sha256:string};
type Extra={rows?:Record<string,unknown>[];stock?:Record<string,unknown>[]};
type Prepared={kind:'native-operations';base:string;instanceId:string;catalogSha256:string;schemaSha256:string;actorId:string;apiVersion?:232;operation:Operation;wire:Wire;reads:ReadTrace[];extra:Extra;executionAllowed:false};
export interface NativeOperationEvidence {
 claim(operationKey:string,binding:string):Promise<boolean>;
 record(operationKey:string,binding:string,ack:unknown):Promise<void>;
 read(operationKey:string,binding:string):Promise<{ack:unknown}|undefined>;
}
const obj=(x:unknown):Record<string,unknown>=>{if(!x||typeof x!=='object'||Array.isArray(x))throw Error('invalid native record');return x as Record<string,unknown>};
const str=(x:unknown,max=256):string=>{if(typeof x!=='string'||!x.trim()||x.length>max)throw Error('invalid operation text');return x};
const id=(x:unknown):string=>{const s=typeof x==='number'&&Number.isSafeInteger(x)?String(x):x;if(typeof s!=='string'||!(/^[1-9][0-9]{0,15}$/).test(s)||!Number.isSafeInteger(Number(s)))throw Error('invalid native ID');return s};
const hash=async(s:string|Uint8Array)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',typeof s==='string'?new TextEncoder().encode(s):new Uint8Array(s))),b=>b.toString(16).padStart(2,'0')).join('');
const eq=(a:unknown,b:unknown)=>snapshotKey(a)===snapshotKey(b);
export const nativeOperationsPreparationHash=(p:Prepared)=>hash(snapshotKey(p));
const result=(status:'verified'|'unknown'|'blocked',reason:string)=>({status,reason,serverAuditRequired:true as const,productionWriteAllowed:false as const});
const traceSort=(rows:ReadTrace[])=>rows.slice().sort((a,b)=>a.path.localeCompare(b.path)||a.sha256.localeCompare(b.sha256));
const sortRows=(rows:Record<string,unknown>[])=>{
 const ids=rows.map(r=>id(r.pk??r.id));if(new Set(ids).size!==ids.length)throw Error('duplicate native record ID');
 return rows.slice().sort((a,b)=>id(a.pk??a.id).localeCompare(id(b.pk??b.id)));
};
function rawOperation(raw:unknown):Operation{
 const r=obj(raw);str(r.id,128);if(!kinds.includes(r.kind as Kind))throw Error('unsupported local operation');
 const payload=obj(r.payload);snapshotKey(payload);return {id:r.id as string,kind:r.kind as Kind,payload:structuredClone(payload)};
}
function wirePath(op:Operation,legacy=false):{method:'POST'|'PATCH';path:string}{
 const p=op.payload;
 switch(op.kind){
 case 'create-category':return {method:'POST',path:'/api/part/category/'};
 case 'create-parameter-template':return {method:'POST',path:legacy?'/api/part/parameter/template/':'/api/parameter/template/'};
 case 'associate-category-template':return {method:'POST',path:'/api/part/category/parameters/'};
 case 'create-location':return {method:'POST',path:'/api/stock/location/'};
 case 'rename-location':return {method:'PATCH',path:'/api/stock/location/'+id(p.locationId)+'/'};
 case 'update-location-metadata':return {method:'PATCH',path:legacy?'/api/stock/location/'+id(p.locationId)+'/metadata/':'/api/metadata/stocklocation/'+id(p.locationId)+'/'};
 case 'transfer-stock':return {method:'POST',path:'/api/stock/transfer/'};
 default:throw Error('unsupported local write');
 }
}
function allowedRead(path:string){
 return /^\/api\/(?:|user\/me\/|schema\/|part\/category\/|part\/category\/parameters\/|(?:part\/)?parameter\/template\/|stock\/|stock\/location\/(?:[1-9][0-9]*\/(?:metadata\/)?)?|metadata\/stocklocation\/[1-9][0-9]*\/)$/.test(path);
}
async function bounded(r:Response,limit:number){
 if(!r.body)return new Uint8Array();
 const declared=r.headers.get('content-length');if(declared&&Number(declared)>limit){void r.body.cancel().catch(()=>{});throw Error('native response limit')}
 const chunks:Uint8Array[]=[],reader=r.body.getReader();let size=0;
 try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>limit)throw Error('native response limit');chunks.push(value)}}finally{try{void reader.cancel().catch(()=>{})}catch{}reader.releaseLock()}
 const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length}return bytes;
}
class AdapterEvidence implements FixtureEvidenceStore{
 private claimed=false;private ack:unknown;
 constructor(readonly base:string,readonly instanceId:string,private operation:Operation,ack?:unknown){this.ack=structuredClone(ack)}
 async claim(o:Operation){if(!eq(o,this.operation)||this.claimed)return false;this.claimed=true;return true}
 async record(o:Operation,ack:unknown){if(!this.claimed||!eq(o,this.operation)||ack===undefined||this.ack!==undefined)throw Error('adapter acknowledgement mismatch');snapshotKey(ack);this.ack=structuredClone(ack)}
 async read<T>(o:Operation):Promise<T|undefined>{return eq(o,this.operation)?structuredClone(this.ack) as T|undefined:undefined}
 get acknowledgement(){return structuredClone(this.ack)}
}
// Use only existing checked adapter methods; fixture open() remains restricted to .test.
async function adapter(ctx:LocalOperationContext,operation:Operation,evidence:AdapterEvidence):Promise<OperationTransport>{
 switch(operation.kind){
 case 'create-category':case 'create-parameter-template':return IsolatedTemplateSyncTransport.openLocalAcceptance(ctx,evidence);
 case 'fixture-associate-category-template':return IsolatedCategoryAssociationTransport.openLocalAcceptance(ctx,evidence);
 case 'create-location':return IsolatedLocationCreateTransport.openLocalAcceptance(ctx,evidence);
 case 'rename-location':case 'update-location-metadata':return IsolatedLocationTransport.openLocalAcceptance(ctx);
 case 'transfer-stock':return IsolatedStockTransferTransport.openLocalAcceptance(ctx,evidence);
 default:throw Error('unsupported adapter');
 }
}
function internal(op:Operation):Operation{return op.kind==='associate-category-template'?{...op,kind:'fixture-associate-category-template'}:op}
const stockFields=['pk','part','location','quantity','batch','serial','status','supplier_part','purchase_order','sales_order','owner','customer','parent','belongs_to','consumed_by','packaging','expiry_date','allocated','in_stock','is_building','child_items','installed_items'];
function stockRecord(raw:unknown,location:string){
 const r=obj(raw);if(stockFields.some(k=>!Object.hasOwn(r,k))||id(r.location)!==location)throw Error('incomplete stock conservation evidence');
 id(r.pk);id(r.part);return Object.fromEntries(stockFields.map(k=>[k,r[k]]));
}
async function extraState(ctx:LocalOperationContext,op:Operation):Promise<Extra>{
 const read=new InvenTreeReadProvider(ctx.base,ctx.token,ctx.request);
 if(op.kind==='create-category'||op.kind==='create-parameter-template'){
  const rows=op.kind==='create-category'?await read.list('api/part/category/'):await read.list(ctx.apiVersion===232?'api/part/parameter/template/':'api/parameter/template/',ctx.apiVersion===232?{}:{for_model:'part.part'});
  const keys=op.kind==='create-category'?['pk','name','description','parent','structural']:ctx.apiVersion===232?['pk','name','description','units','checkbox','choices']:['pk','name','description','units','model_type','enabled','checkbox','choices','selectionlist'];
  return {rows:sortRows(rows.map(x=>{const r=obj(x);if(keys.some(k=>!Object.hasOwn(r,k)))throw Error('incomplete definition evidence');return Object.fromEntries(keys.map(k=>[k,r[k]]))}))};
 }
 if(['create-location','rename-location','update-location-metadata','transfer-stock'].includes(op.kind)){
  const rows=sortRows((await new InvenTreeReadAdapter(ctx.base,ctx.token,ctx.request).getLocations()).map(r=>({...r})));
  if(op.kind==='rename-location'||op.kind==='update-location-metadata'){
   const retiring=op.kind==='update-location-metadata'&&Array.isArray(op.payload.retiringLocationIds)?op.payload.retiringLocationIds.map(id):[];
   const leaves=op.kind==='rename-location'?[id(op.payload.locationId)]:Array.isArray(op.payload.expectedLeaves)?[...op.payload.expectedLeaves.map(x=>id(obj(x).locationId)),...retiring]:[];
   if(!leaves.length||leaves.length>10000||new Set(leaves).size!==leaves.length)throw Error('invalid conservation scope');
   if(ctx.apiVersion===232)await verifyLegacyLocationAncestors(read,rows as unknown as import('./inventory-provider.js').LocationSummary[],op.kind==='update-location-metadata'?[id(op.payload.locationId),...leaves]:leaves);
   const stock:Record<string,unknown>[]=[];
   for(const leaf of leaves){if(!rows.some(r=>r.id===leaf&&r.structural===false)||rows.some(r=>r.parentId===leaf))throw Error('invalid conservation leaf');
    const items=(await readNativeStockByLocation(read,leaf,ctx.apiVersion===232)).map(r=>stockRecord(r,leaf));
    if((retiring.includes(leaf)||op.kind==='rename-location'&&op.payload.retireConfirmed===true)&&items.length)throw Error('retiring location retains stock records');
    if(retiring.includes(leaf)&&!rows.some(r=>r.id===leaf&&r.name===retiredLocationName(leaf)))throw Error('retired marker not verified');
    stock.push(...items);
   }
   if(op.kind==='update-location-metadata'){if(retiring.length&&op.payload.migrationExpected===undefined)throw Error('complete migration stock expectation required');if(op.payload.migrationExpected!==undefined)verifyNativeLayoutStock(op.payload.migrationExpected,stock)}
   return {rows,stock:sortRows(stock)};
  }
  return {rows};
 }
 return {};
}
function extraVerified(op:Operation,before:Extra,after:Extra,ack:unknown){
 const a=before.rows,b=after.rows;
 if(op.kind==='create-category'||op.kind==='create-parameter-template'||op.kind==='create-location'){
  if(!a||!b)return false;const pk=id(obj(ack).id);
  return b.some(r=>id(r.pk??r.id)===pk)&&eq(a,b.filter(r=>id(r.pk??r.id)!==pk));
 }
 if(op.kind==='rename-location'){
  if(!a||!b)return false;
  return eq(a.map(r=>r.id===id(op.payload.locationId)?{...r,name:op.payload.name}:r),b)&&eq(before.stock,after.stock);
 }
 return eq(before,after);
}
export class NativeOperationsAcceptance{
 private constructor(private base:URL,private token:string,private catalog:Catalog,private catalogSha256:string,private request:typeof fetch,private production?:ProductionNativeTarget){}
 static open(base:string,token:string,rawCatalog:unknown,catalogSha256:string,request:typeof fetch=fetch,production?:ProductionNativeTarget){
  const u=authorizedNativeBase(base,production);if(typeof token!=='string'||!token.trim()||/[\r\n]/.test(token)||!(/^[a-f0-9]{64}$/).test(catalogSha256))throw Error('explicit isolated token/catalog hash required');
  if(production&&production.catalogSha256!==catalogSha256)throw Error('production catalog mismatch');return new NativeOperationsAcceptance(u,token,validateCatalog(structuredClone(rawCatalog)),catalogSha256,request,production);
 }
 private session(instanceId:string,op:Operation,mode:'prepare'|'execute'|'observe',prepared?:Prepared,binding?:string,operationKey?:string,store?:NativeOperationEvidence,apiVersion?:232){
  let wire:Wire|undefined,sent=false,trace:ReadTrace[]=[],count=0,bytesTotal=0;
  const stop=Error('local preparation captured the write; no request sent');
  const dispatcher:typeof fetch=async(input,init)=>{
   if(typeof input!=='string'&&!(input instanceof URL))throw Error('invalid local request');
   const u=new URL(input,this.base),method=init?.method??'GET';
   if(u.origin!==this.base.origin||u.username||u.password||u.hash||++count>20000)throw Error('unsafe native request scope');
   if(method==='GET'){if(!allowedRead(u.pathname))throw Error('unsupported local read');}
   else{
    const expected=wirePath(op,apiVersion===232);
    if(wire||u.search||method!==expected.method||u.pathname!==expected.path||typeof init?.body!=='string')throw Error('unexpected local mutation');
    wire={method:expected.method,path:u.pathname,body:JSON.parse(init.body)};snapshotKey(wire);
    if(mode==='prepare')throw stop;
    if(mode!=='execute'||!prepared||!binding||!operationKey||!store||!eq(wire,prepared.wire)||!eq(traceSort(trace),prepared.reads))throw Error('write not bound to exact reviewed reads and request');
    if(!await store.claim(operationKey,binding))throw Error('operation already reserved; observe only');
    sent=true;
   }
   const headers=new Headers(init?.headers);headers.set('Authorization','Token '+this.token);headers.set('Accept','application/json');
   const response=await this.request(u,{...init,method,headers,cache:'no-store',redirect:'error',signal:AbortSignal.timeout(20000)});
   const bytes=await bounded(response,u.pathname==='/api/schema/'?16*1024*1024:4*1024*1024);
   bytesTotal+=bytes.length;if(bytesTotal>128*1024*1024)throw Error('local evidence read limit');
   if(method==='GET'&&mode!=='observe'){
    if(!response.ok)throw Error('local read denied or unavailable');
    const copy=new URL(u);copy.searchParams.sort();
    trace.push({path:copy.pathname+copy.search,sha256:await hash(u.pathname==='/api/schema/'?bytes:snapshotKey(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes))))});
   }
   return new Response([204,205,304].includes(response.status)?null:new Uint8Array(bytes).buffer,{status:response.status,headers:response.headers});
  };
  return {ctx:createLocalOperationContext(this.base.href,this.token,instanceId,dispatcher,this.production,apiVersion),stop,reads:()=>traceSort(trace),wire:()=>wire,sent:()=>sent};
 }
 private async target(ctx:LocalOperationContext){
  const get=async(path:string)=>{const r=await ctx.request(new URL(path,ctx.base));if(!r.ok)throw Error('native target probe failed');return r};
  const version=obj(await (await get('api/')).json());const api=nativeApiVersion(version,this.production);
  const auth=obj(await (await get('api/user/me/')).json()),actorId=id(auth.pk??auth.id);
  const schema=await get('api/schema/?format=json'),schemaSha256=await hash(new Uint8Array(await schema.arrayBuffer()));
  assertNativeTarget(this.production,actorId,schemaSha256);return {actorId,schemaSha256,...(api===232?{apiVersion:232 as const}:{})};
 }
 private async hydrate(ctx:LocalOperationContext,op:Operation):Promise<Operation>{
  if(op.kind==='transfer-stock'){
   const p=op.payload,source=id(p.sourceId),target=id(p.targetId);if(source===target)throw Error('invalid transfer locations');
   const read=new InvenTreeReadProvider(ctx.base,ctx.token,ctx.request);
   const legacy=ctx.apiVersion===232,expectedSource=await readNativeStockByLocation(read,source,legacy),expectedTarget=await readNativeStockByLocation(read,target,legacy);
   if(p.continuation!==undefined){const c=obj(p.continuation);if(!Array.isArray(c.splits)||!c.splits.length||c.splits.length>999)throw Error('invalid prior split list');const expectedPrior=[];for(const x of c.splits){const locationId=id(obj(x).locationId);expectedPrior.push({locationId,rows:await readNativeStockByLocation(read,locationId,legacy)})}return {...op,payload:{...p,expectedSource,expectedTarget,expectedPrior}}}
   if(p.linkedExpected!==undefined){if(!Array.isArray(p.linkedExpected)||p.linkedExpected.length<2||p.linkedExpected.length>10000)throw Error('invalid linked stock evidence');const ids=[...new Set(p.linkedExpected.map(x=>id(obj(x).location)))].filter(x=>x!==source&&x!==target).sort(),expectedLinked=[];for(const locationId of ids)expectedLinked.push({locationId,rows:await readNativeStockByLocation(read,locationId,legacy)});return {...op,payload:{...p,expectedSource,expectedTarget,expectedLinked}}}
   return {...op,payload:{...p,expectedSource,expectedTarget}};
  }
  if(op.kind==='associate-category-template'){
   const p=op.payload,categoryId=id(p.categoryId),templateId=id(p.templateId),categoryKey=str(p.categoryKey),fieldKey=str(p.fieldKey);
   if(!Array.isArray(p.reviews)||!p.reviews.length||p.reviews.length>10000)throw Error('explicit scalar mapping reviews required');
   const reviews=structuredClone(p.reviews) as ScalarTypeReview[];
   const e=new AdapterEvidence(ctx.base,ctx.instanceId,internal(op)),t=await IsolatedCategoryAssociationTransport.openLocalAcceptance(ctx,e);
   const b=await t.readCandidate(ctx.instanceId,reviews);
   // Candidate only: complete flag is provisional for the pure planner; visibility must be independently approved before write.
   const planned=planIsolatedAssociation(op.id,this.catalog,{categoryKey,remoteCategoryId:categoryId,templates:{[fieldKey]:templateId}},fieldKey,{...b,snapshot:{...b.snapshot,complete:true}},reviews);
   return {...planned,kind:'associate-category-template',payload:{...planned.payload,catalogCategoryKey:categoryKey,catalogFieldKey:fieldKey}};
  }
  return op;
 }
 async prepare(instanceId:string,raw:unknown):Promise<Prepared>{
  if(this.production&&await nativeCatalogHash(this.catalog)!==this.production.catalogSha256)throw Error('production catalog contents changed');
  str(instanceId);const input=rawOperation(raw);
  const probe=this.session(instanceId,input,'observe'),initial=await this.target(probe.ctx);
  
  const hydration=this.session(instanceId,input,'observe',undefined,undefined,undefined,undefined,initial.apiVersion);
  const operation=await this.hydrate(hydration.ctx,input);
  const s=this.session(instanceId,operation,'prepare',undefined,undefined,undefined,undefined,initial.apiVersion),target=await this.target(s.ctx);matchesPreparedApi(target.apiVersion??570,initial);
  if(target.actorId!==initial.actorId||target.schemaSha256!==initial.schemaSha256)throw Error('target changed during preparation');
  const extra=await extraState(s.ctx,operation);
  const o=internal(operation),e=new AdapterEvidence(this.base.href,instanceId,o),t=await adapter(s.ctx,o,e);
  try{await t.send(o)}catch(err){if(err!==s.stop)throw err}
  const wire=s.wire();if(!wire||s.sent())throw Error('no single reviewed mutation captured');
  return {kind:'native-operations',base:this.base.href,instanceId,catalogSha256:this.catalogSha256,...target,operation,wire,reads:s.reads(),extra,executionAllowed:false};
 }
 private async validate(prepared:Prepared,approval:unknown){
  if(this.production&&await nativeCatalogHash(this.catalog)!==this.production.catalogSha256)throw Error('production catalog contents changed');
  const a=obj(approval);assertNativeMode(this.production,a);
  if(['writeAuthorized','visibilityConfirmed','exclusiveAccessConfirmed','operationReviewed','physicalAndReferenceReviewConfirmed'].some(k=>a[k]!==true))throw Error('all local confirmations required');
  if(!prepared||prepared.kind!=='native-operations'||prepared.base!==this.base.href||prepared.executionAllowed!==false||prepared.catalogSha256!==this.catalogSha256||!(/^[a-f0-9]{64}$/).test(prepared.schemaSha256))throw Error('invalid prepared operation');
  str(prepared.instanceId);id(prepared.actorId);rawOperation(prepared.operation);
  const binding=await nativeOperationsPreparationHash(prepared);
  if(a.approvedPreparationSha256!==binding)throw Error('approval does not bind exact preparation');
  const operationKey=await hash(snapshotKey({base:prepared.base,instanceId:prepared.instanceId,operationId:prepared.operation.id}));
  return {binding,operationKey};
 }
 async execute(raw:Prepared,approval:unknown,store:NativeOperationEvidence){
  const p=structuredClone(raw),{binding,operationKey}=await this.validate(p,approval);
  const s=this.session(p.instanceId,p.operation,'execute',p,binding,operationKey,store,p.apiVersion),target=await this.target(s.ctx);
  matchesPreparedApi(target.apiVersion??570,p);
  if(target.schemaSha256!==p.schemaSha256||target.actorId!==p.actorId||!eq(await extraState(s.ctx,p.operation),p.extra))throw Error('approved target or baseline changed');
  const o=internal(p.operation),e=new AdapterEvidence(this.base.href,p.instanceId,o),t=await adapter(s.ctx,o,e);
  try{
   await t.send(o);
   if(!s.sent())throw Error('no native write sent');
   const ack=e.acknowledgement;
   if(ack===undefined&&!['rename-location','update-location-metadata'].includes(p.operation.kind))throw Error('missing adapter acknowledgement');
   await store.record(operationKey,binding,ack??{successfulResponse:true});
  }catch(err){if(!s.sent())throw err;return result('unknown','no durable correlated acknowledgement; never resend')}
  return this.observe(p,approval,store);
 }
 async observe(raw:Prepared,approval:unknown,store:NativeOperationEvidence){
  const p=structuredClone(raw),{binding,operationKey}=await this.validate(p,approval);
  let saved;try{saved=await store.read(operationKey,binding)}catch{return result('unknown','private evidence unreadable or mismatched')}
  if(!saved)return result('unknown','no correlated acknowledgement; never resend');
  try{
   const s=this.session(p.instanceId,p.operation,'observe',undefined,undefined,undefined,undefined,p.apiVersion),target=await this.target(s.ctx);
   matchesPreparedApi(target.apiVersion??570,p);
   if(target.schemaSha256!==p.schemaSha256||target.actorId!==p.actorId)return result('unknown','target or schema changed');
   const o=internal(p.operation),e=new AdapterEvidence(this.base.href,p.instanceId,o,saved.ack),t=await adapter(s.ctx,o,e),observed=await t.observe(o);
   if(observed.status!=='verified')return result(observed.status,'native adapter readback not verified');
   if(!extraVerified(p.operation,p.extra,await extraState(s.ctx,p.operation),saved.ack))return result('blocked','prior tree, definitions or stock references changed');
   return result('verified','correlated native response and exact operation readback; prior state checked');
  }catch{return result('unknown','native readback unavailable')}
 }
}
