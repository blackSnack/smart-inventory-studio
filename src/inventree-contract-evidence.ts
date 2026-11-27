// Explicit, read-only local evidence collection. No schema or OPTIONS response grants write capability.
type Obj=Record<string,unknown>;
const obj=(x:unknown):x is Obj=>!!x&&typeof x==='object'&&!Array.isArray(x);
const own=(x:unknown,k:string):unknown=>obj(x)&&Object.hasOwn(x,k)?x[k]:undefined;
const words=(s:string)=>s.split(' ').filter(Boolean);
type ReadSpec={key:string;path:string;fields:string[];filters?:string[];list?:true;query?:Record<string,string>};
type WriteSpec={key:string;path:string;method:'POST'|'PATCH';fields:string[]};
const read=(key:string,path:string,fields:string,filters='',query:Record<string,string>={}):ReadSpec=>({key,path,fields:words(fields),filters:words(filters),list:true,query});
const detail=(key:string,path:string,fields:string):ReadSpec=>({key,path,fields:words(fields)});
const write=(key:string,path:string,method:'POST'|'PATCH',fields:string):WriteSpec=>({key,path,method,fields:words(fields)});
const partFields='pk name IPN description category active virtual trackable is_template assembly component units';
const templateFields='pk name model_type enabled checkbox choices selectionlist units';
const stockFields='pk part location quantity batch serial status supplier_part purchase_order sales_order owner customer parent belongs_to consumed_by packaging expiry_date allocated in_stock is_building child_items installed_items';
const locationFields='pk name parent structural description external exclude_from_stock';
export const contractReads:readonly ReadSpec[]=[
 read('part-list','/api/part/',partFields,'search IPN'),detail('part-detail','/api/part/{id}/',partFields),
 read('category-list','/api/part/category/','pk name parent structural'),detail('category-detail','/api/part/category/{id}/','pk name parent structural'),
 read('template-list','/api/parameter/template/',templateFields,'for_model',{for_model:'part.part'}),detail('template-detail','/api/parameter/template/{id}/',templateFields),
 read('category-bindings','/api/part/category/parameters/','pk category template default_value template_detail'),
 read('parameters','/api/parameter/','pk model_type model_id template data note','model_type model_id template',{model_type:'part.part'}),
 read('manufacturer-parts','/api/company/part/manufacturer/','pk part manufacturer manufacturer_detail MPN','part manufacturer_detail',{manufacturer_detail:'true'}),
 read('supplier-parts','/api/company/part/','pk part supplier supplier_detail SKU','part supplier_detail',{supplier_detail:'true'}),
 read('attachments','/api/attachment/','pk model_type model_id link comment attachment','model_type model_id',{model_type:'part'}),
 read('stock-list','/api/stock/',stockFields,'part include_variants location cascade',{include_variants:'false',cascade:'false'}),
 read('location-list','/api/stock/location/',locationFields),detail('location-detail','/api/stock/location/{id}/',locationFields),
 detail('location-metadata','/api/metadata/{model}/{id}/','metadata')
];
export const contractWrites:readonly WriteSpec[]=[
 write('part-create','/api/part/','POST','IPN name description category units active virtual trackable is_template assembly component'),
 write('category-create','/api/part/category/','POST','name parent description structural'),
 write('template-create','/api/parameter/template/','POST','name units description model_type enabled checkbox choices selectionlist'),
 write('category-association','/api/part/category/parameters/','POST','category template default_value'),
 write('parameter-create','/api/parameter/','POST','model_type model_id template data'),
 write('parameter-update','/api/parameter/{id}/','PATCH','data'),
 write('source-create','/api/attachment/','POST','model_type model_id link comment'),
 write('stock-create','/api/stock/','POST','part location quantity'),
 write('location-create','/api/stock/location/','POST','name parent description structural external exclude_from_stock'),
 write('location-rename','/api/stock/location/{id}/','PATCH','name'),
 write('metadata-update','/api/metadata/{model}/{id}/','PATCH','metadata'),
 write('stock-transfer','/api/stock/transfer/','POST','items items[].pk items[].quantity items[].merge location')
];
// Resolve only local JSON pointers and ordinary allOf composition. External refs and unions are unknown.
function resolved(root:Obj,x:unknown,depth=0,seen=new Set<string>()):Obj|undefined{
 if(depth>32||!obj(x))return;
 if(typeof x.$ref==='string'){
  if(!x.$ref.startsWith('#/')||seen.has(x.$ref))return;
  let y:unknown=root;for(const k of x.$ref.slice(2).split('/'))y=own(y,k.replace(/~1/g,'/').replace(/~0/g,'~'));
  const r=resolved(root,y,depth+1,new Set([...seen,x.$ref]));if(!r)return;return {...r,...Object.fromEntries(Object.entries(x).filter(([k])=>k!=='$ref'))};
 }
 if(x.oneOf||x.anyOf)return;
 if(Array.isArray(x.allOf)){
  const all=x.allOf.map(y=>resolved(root,y,depth+1,seen));if(all.some(y=>!y))return;
  const props:Obj={};const required=new Set<string>();
  for(const a of [...all as Obj[],x]){if(obj(a.properties))Object.assign(props,a.properties);if(Array.isArray(a.required))for(const k of a.required)if(typeof k==='string')required.add(k)}
  return {...Object.assign({},...all),...x,properties:props,required:[...required]};
 }
 return x;
}
function jsonSchema(root:Obj,node:unknown){const n=resolved(root,node);return resolved(root,own(own(own(n,'content'),'application/json'),'schema'))}
function field(root:Obj,schema:unknown,path:string,mode:'read'|'write'): 'declared'|'missing'|'unknown'|'wrong-access'{
 let s=resolved(root,schema);for(const seg of path.split('.')){
  if(!s)return 'unknown';if(!obj(s.properties))return 'unknown';
  const array=seg.endsWith('[]'),k=array?seg.slice(0,-2):seg;
  if(!Object.hasOwn(s.properties,k))return 'missing';
  s=resolved(root,s.properties[k]);if(!s)return 'unknown';
  if(mode==='write'&&s.readOnly===true||mode==='read'&&s.writeOnly===true)return 'wrong-access';
  if(array){s=resolved(root,s.items);if(!s)return 'unknown'}
 }return 'declared';
}
function responseSchema(root:Obj,op:Obj,list:boolean){
 const responses=own(op,'responses');if(!obj(responses))return;
 const keys=Object.keys(responses).filter(k=>/^2\d\d$/.test(k)).sort();
 for(const k of keys){let s=jsonSchema(root,responses[k]);if(!s)continue;
  if(list){if(s.type==='array')s=resolved(root,s.items);else s=resolved(root,own(own(s.properties,'results'),'items'))}
  if(s)return s;
 }
}
export function inspectInvenTreeContract(input:unknown){
 if(!obj(input)||typeof input.openapi!=='string'||!input.openapi.startsWith('3.')||!obj(input.paths))throw Error('invalid OpenAPI document');
 const schema=input,paths=input.paths;
 const reads=contractReads.map(r=>{const p=own(paths,r.path),op=own(p,'get'),s=obj(op)?responseSchema(schema,op,!!r.list):undefined;
  const params=[...(Array.isArray(own(p,'parameters'))?own(p,'parameters') as unknown[]:[]),...(Array.isArray(own(op,'parameters'))?own(op,'parameters') as unknown[]:[])].map(x=>resolved(schema,x));
  return {key:r.key,path:r.path,declared:obj(op),responseFields:Object.fromEntries(r.fields.map(k=>[k,field(schema,s,k,'read')])),queryFilters:Object.fromEntries((r.filters??[]).map(k=>[k,params.some(p=>p?.in==='query'&&p.name===k)?'declared':params.some(p=>!p)?'unknown':'missing']))}
 });
 const writes=contractWrites.map(w=>{const op=own(own(paths,w.path),w.method.toLowerCase()),s=jsonSchema(schema,own(op,'requestBody'));
  const extraRequired=Array.isArray(s?.required)?s.required.filter(k=>typeof k==='string'&&!w.fields.includes(k)&&own(own(s.properties,k),'readOnly')!==true):[];
  return {key:w.key,path:w.path,method:w.method,declared:obj(op),requestFields:Object.fromEntries(w.fields.map(k=>[k,field(schema,s,k,'write')])),extraRequiredFields:extraRequired.length,writeVerified:false as const}
 });
 return {reads,writes};
}
type SampleIds={part?:string;category?:string;template?:string;parameter?:string;location?:string};
type Config={base:string;token:string;samples?:SampleIds};
function configURL(c:Config){
 const b=new URL(c.base.endsWith('/')?c.base:c.base+'/');
 if(!['http:','https:'].includes(b.protocol)||b.username||b.password||b.search||b.hash||!c.token.trim()||/[\r\n]/.test(c.token))throw Error('invalid explicit configuration');
 for(const [k,v] of Object.entries(c.samples??{}))if(!['part','category','template','parameter','location'].includes(k)||typeof v!=='string'||!(/^[1-9][0-9]{0,15}$/).test(v)||!Number.isSafeInteger(Number(v)))throw Error('invalid explicit sample ID');
 return b;
}
function concrete(path:string,ids:SampleIds){
 if(!path.includes('{'))return path;
 const id=path.startsWith('/api/metadata/')||path.startsWith('/api/stock/location/')?ids.location:path.startsWith('/api/part/category/')?ids.category:path.startsWith('/api/parameter/template/')?ids.template:path.startsWith('/api/parameter/')?ids.parameter:ids.part;
 return id?path.replace('{model}','stocklocation').replace('{id}',id):undefined;
}
async function boundedJSON(r:Response,limit:number){
 const declared=r.headers.get('content-length');if(declared&&Number(declared)>limit){await r.body?.cancel();throw Error('response limit')}
 if(!r.body)throw Error('missing response body');
 const reader=r.body.getReader(),chunks:Uint8Array[]=[];let total=0;
 try{while(true){const {done,value}=await reader.read();if(done)break;total+=value.byteLength;if(total>limit)throw Error('response limit');chunks.push(value)}}finally{try{await reader.cancel()}catch{}reader.releaseLock()}
 const bytes=new Uint8Array(total);let n=0;for(const chunk of chunks){bytes.set(chunk,n);n+=chunk.byteLength}
 return {data:JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)) as unknown,bytes};
}
const hash=async(bytes:Uint8Array)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new Uint8Array(bytes))),b=>b.toString(16).padStart(2,'0')).join('');
type Result={status:'ok'|'denied'|'redirect'|'http-error'|'unavailable'|'invalid-json';httpStatus?:number;data?:unknown;bytes?:Uint8Array;allow?:string[]};
type Sample={status:string;httpStatus?:number;missingFields?:string[];paging?:string};
function statusOnly(r:Result){return {status:r.status,...(r.httpStatus===undefined?{}:{httpStatus:r.httpStatus})}}
function pageShape(data:unknown,limit:number){
 if(Array.isArray(data))return data.length<=limit?{rows:data,mode:'unpaginated-small-sample',next:null,count:undefined}:undefined;
 if(!obj(data)||!Array.isArray(data.results)||data.results.length>limit||typeof data.count!=='number'||!Number.isSafeInteger(data.count)||data.count<0||data.next!==null&&typeof data.next!=='string'||data.results.length>data.count||data.next&&(!data.results.length||data.results.length>=data.count)||!data.next&&data.results.length!==data.count)return;
 return {rows:data.results,mode:'paged',next:data.next,count:data.count};
}
export async function collectInvenTreeEvidence(config:Config,request:typeof fetch=fetch){
 const b=configURL(config),ids={...config.samples},token=config.token;
 async function call(u:URL,method:'GET'|'OPTIONS',limit=2*1024*1024):Promise<Result>{
  if(u.origin!==b.origin||!u.pathname.startsWith(b.pathname+'api/')||u.username||u.password||u.hash)throw Error('unsafe probe target');
  let r:Response;try{r=await request(u,{method,headers:{Authorization:'Token '+token,Accept:'application/json'},cache:'no-store',redirect:'error',signal:AbortSignal.timeout(20000)})}catch{return {status:'unavailable'}}
  const httpStatus=r.status;
  if(!r.ok){try{await r.body?.cancel()}catch{}return {status:httpStatus===401||httpStatus===403?'denied':httpStatus>=300&&httpStatus<400?'redirect':'http-error',httpStatus}}
  const allow=(r.headers.get('allow')??'').split(',').map(x=>x.trim().toUpperCase()).filter(x=>['GET','OPTIONS','POST','PATCH','PUT','DELETE','HEAD'].includes(x));
  try{const parsed=await boundedJSON(r,limit);return {status:'ok',httpStatus,allow,...parsed}}catch{return {status:'invalid-json',httpStatus,allow}}
 }
 const url=(p:string,q:Record<string,string>={})=>{const u=new URL(p.slice(1),b);for(const [k,v] of Object.entries(q))u.searchParams.set(k,v);return u};
 const info=await call(url('/api/'),'GET'),data=info.data;
 const version=own(data,'version')==='1.7.4'&&own(data,'apiVersion')===570&&own(data,'server')==='InvenTree'?'target-match':'unverified-or-mismatch';
 // /api/ itself allows anonymous access; separately check an authenticated endpoint.
 const auth=await call(url('/api/user/me/'),'GET');
 const authenticated=auth.status==='ok'&&obj(auth.data)&&((typeof auth.data.pk==='number'&&Number.isSafeInteger(auth.data.pk)&&auth.data.pk>0)||(typeof auth.data.id==='number'&&Number.isSafeInteger(auth.data.id)&&auth.data.id>0));
 const schemaResponse=await call(url('/api/schema/',{format:'json'}),'GET',16*1024*1024);let schema:ReturnType<typeof inspectInvenTreeContract>|null=null;
 try{if(schemaResponse.status==='ok')schema=inspectInvenTreeContract(schemaResponse.data)}catch{}
 const schemaHash=schema&&schemaResponse.bytes?await hash(schemaResponse.bytes):null;
 const reads:Record<string,Sample>=Object.create(null),options:Record<string,unknown>=Object.create(null);
 // Do not continue into inventory if authenticated identity or schema cannot be checked.
 if(authenticated&&schema){
 for(const r of contractReads){
  const p=concrete(r.path,ids);if(!p){reads[r.key]={status:'sample-id-required'};continue}
  if(!schema.reads.find(x=>x.key===r.key)?.declared){reads[r.key]={status:'schema-not-declared'};continue}
  const q:Record<string,string>={...r.query,...(r.list?{limit:'1'}:{})};
  if(ids.part&&['manufacturer-parts','supplier-parts','stock-list'].includes(r.key))q.part=ids.part;
  if(ids.part&&['parameters','attachments'].includes(r.key))q.model_id=ids.part;
  const u=url(p,q),first=await call(u,'GET');
  if(first.status!=='ok'){reads[r.key]=statusOnly(first);continue}
  let rows:unknown[],paging='not-applicable';
  if(r.list){
   const page=pageShape(first.data,1);if(!page){reads[r.key]={status:'invalid-sample-envelope'};continue}
   rows=page.rows.slice();paging=page.mode;
   if(page.next){
    let next:URL;try{next=new URL(page.next,u)}catch{reads[r.key]={status:'unsafe-next'};continue}
    const seen=new Set<string>();let valid=next.origin===u.origin&&next.pathname===u.pathname&&!next.username&&!next.password&&!next.hash&&next.href!==u.href;
    next.searchParams.forEach((v,k)=>{if(seen.has(k)||(!Object.hasOwn(q,k)&&!['offset','page'].includes(k))||Object.hasOwn(q,k)&&q[k]!==v)valid=false;seen.add(k)});
    if(!Object.entries(q).every(([k,v])=>next.searchParams.get(k)===v)||!valid||!['offset','page'].some(k=>next.searchParams.has(k))){reads[r.key]={status:'unsafe-next'};continue}
    const second=await call(next,'GET');if(second.status!=='ok'){reads[r.key]={...statusOnly(second),paging:'second-page-failed'};continue}
    const secondPage=pageShapeForNext(second.data,page.count!);
    if(!secondPage||rows.some(a=>secondPage.some(z=>own(a,'pk')!==undefined&&own(a,'pk')===own(z,'pk')))){reads[r.key]={status:'invalid-second-page'};continue}
    rows.push(...secondPage);paging='two-pages-sampled';
   }
  }else rows=[first.data];
  const missing=r.fields.filter(k=>rows.some(x=>!obj(x)||!Object.hasOwn(x,k)));
  // Never confuse an empty collection with evidence of a compatible record.
  const scoped=rows.every(x=>{
   if(!obj(x))return false;
   if(q.model_type&&x.model_type!==q.model_type)return false;
   if(r.key==='template-list'&&x.model_type!=='part.part'&&x.model_type!==null)return false;
   if(q.part&&String(x.part)!==q.part||q.model_id&&String(x.model_id)!==q.model_id)return false;
   if(!r.list&&r.key!=='location-metadata'&&String(x.pk)!==p.split('/').filter(Boolean).at(-1))return false;
   return true;
  });
  reads[r.key]={status:!rows.length?'empty-unverified':missing.length?'fields-missing':!scoped?'scope-mismatch':'sample-compatible',httpStatus:first.httpStatus,missingFields:missing,paging};
 }
 const cache=new Map<string,Result>();
 for(const w of contractWrites){
  const p=concrete(w.path,ids);if(!p){options[w.key]={status:'sample-id-required'};continue}
  if(!schema.writes.find(x=>x.key===w.key)?.declared){options[w.key]={status:'schema-not-declared'};continue}
  let result=cache.get(p);if(!result){result=await call(url(p),'OPTIONS');cache.set(p,result)}
  // InvenTree 1.7.4 metadata enumerates GET/POST/PUT, not PATCH. PUT is merely a hint.
  const method=w.method==='PATCH'?'PUT':'POST',actions=own(result.data,'actions'),a=own(actions,method);
  options[w.key]={...statusOnly(result),allowHeader:result.allow?.includes(w.method)??false,actionMethod:method,actionAdvertised:obj(a),patchUsesPutHint:w.method==='PATCH',fieldsAdvertised:obj(a)?w.fields.filter(k=>!k.includes('[]')).every(k=>Object.hasOwn(a,k)&&own(a[k],'read_only')!==true):false,writeVerified:false};
 }
 }
 return {target:'InvenTree 1.7.4 / API 570',version,versionProbe:statusOnly(info),authenticatedRead:authenticated,authProbe:statusOnly(auth),schema:{...statusOnly(schemaResponse),sha256:schemaHash,contract:schema},reads,options,actualWriteVerified:false as const,writeEnabled:false as const,runtimeAcceptanceRequired:true as const};
}
function pageShapeForNext(data:unknown,count:number):unknown[]|undefined{
 if(!obj(data)||data.count!==count||!Array.isArray(data.results)||data.results.length!==1||count<2||data.next!==null&&typeof data.next!=='string'||count===2&&data.next!==null||count>2&&!data.next)return;
 return data.results;
}
