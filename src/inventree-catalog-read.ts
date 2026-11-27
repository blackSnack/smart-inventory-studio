import {InvenTreeReadProvider} from './domain.js';
import {probeSchema,type RequiredOperation} from './provider-schema.js';
import type {CatalogReadPort,CategoryRef,ParameterTemplateRef,PartRecord,SourceRef} from './inventory-contract.js';
const endpoints:RequiredOperation[]=[
 {key:'part-detail',path:'/api/part/{id}/',method:'get'},
 {key:'categories',path:'/api/part/category/',method:'get'},
 {key:'category-templates',path:'/api/part/category/parameters/',method:'get'},
 {key:'parameters',path:'/api/parameter/',method:'get'},
 {key:'manufacturer-parts',path:'/api/company/part/manufacturer/',method:'get'},
 {key:'supplier-parts',path:'/api/company/part/',method:'get'},
 {key:'attachments',path:'/api/attachment/',method:'get'}
];
const row=(x:unknown):Record<string,unknown>=>{if(!x||typeof x!=='object'||Array.isArray(x))throw Error('invalid catalog row');return x as Record<string,unknown>};
const id=(x:unknown):string=>{const s=typeof x==='number'&&Number.isSafeInteger(x)?String(x):x;if(typeof s!=='string'||!(/^[1-9][0-9]{0,17}$/).test(s))throw Error('invalid catalog ID');return s};
const str=(x:unknown):string=>{if(typeof x!=='string')throw Error('invalid catalog text');return x};
const text=(x:unknown):string=>x==null?'':str(x);
const name=(x:unknown):string=>{const s=str(x);if(!s.trim())throw Error('missing catalog name');return s};
const unique=(rows:Record<string,unknown>[])=>{const ids=rows.map(r=>id(r.pk));if(new Set(ids).size!==ids.length)throw Error('duplicate catalog row');return rows};
const company=(r:Record<string,unknown>,key:'manufacturer'|'supplier')=>{const d=row(r[key+'_detail']);if(id(d.pk)!==id(r[key]))throw Error('company identity mismatch');return name(d.name)};
function source(kind:SourceRef['kind'],raw:unknown,label:string):SourceRef[]{
 // External links only, no download or authenticated fetch of an arbitrary URL.
 if(raw==null||raw==='')return [];const s=str(raw);try{const u=new URL(s);if(u.protocol==='https:'&&!u.username&&!u.password)return [{kind,url:u.href,label}]}catch{}return [];
}
// Standalone software adapter: explicit declaration probe, actual response validation, GET only.
// A schema declaration is not a permission check or production integration acceptance.
export class InvenTreeCatalogReadAdapter implements CatalogReadPort{
 private constructor(private base:URL,private token:string,private request:typeof fetch,private transport:InvenTreeReadProvider){}
 static async open(base:string,token:string,request:typeof fetch){
  const b=new URL(base.endsWith('/')?base:base+'/');const e=await probeSchema(b.href,token,endpoints,request);
  if(e.operations.some(o=>!o.declared))throw Error('catalog API not declared');
  return new InvenTreeCatalogReadAdapter(b,token,request,new InvenTreeReadProvider(b.href,token,request));
 }
 private async list(path:string,params:Record<string,string>={}):Promise<Record<string,unknown>[]>{
  return unique((await this.transport.list(path,params)).map(row));
 }
 async getCategories():Promise<CategoryRef[]>{
  const categories=(await this.list('api/part/category/')).map(r=>{if(!Object.hasOwn(r,'parent'))throw Error('missing category parent');return {id:id(r.pk),name:name(r.name),parentId:r.parent===null?null:id(r.parent)}});
  const byId=new Map(categories.map(c=>[c.id,c])),checked=new Set<string>();
  for(const c of categories){let current:CategoryRef|undefined=c;const chain=new Set<string>();while(current&&!checked.has(current.id)){if(chain.has(current.id))throw Error('cyclic category tree');chain.add(current.id);if(current.parentId===null)break;current=byId.get(current.parentId);if(!current)throw Error('missing category parent')}for(const k of chain)checked.add(k)}
  return categories;
 }
 async getParameterTemplates(categoryId:string):Promise<ParameterTemplateRef[]>{
  id(categoryId);
  // Public schema does not promise a category filter; read relations and select exact category locally.
  const relations=await this.list('api/part/category/parameters/'),seen=new Set<string>(),out:ParameterTemplateRef[]=[];
  for(const r of relations){if(id(r.category)!==categoryId)continue;const tid=id(r.template),d=row(r.template_detail);if(id(d.pk)!==tid||d.model_type!=='part.part'||seen.has(tid)||typeof d.enabled!=='boolean'||typeof d.checkbox!=='boolean')throw Error('invalid category template relation');seen.add(tid);
   if(!d.enabled)continue;const choices=text(d.choices),selection=d.selectionlist==null?null:id(d.selectionlist);
   // Native templates do not establish numeric/rating semantics from units alone.
   out.push({id:tid,name:name(d.name),unit:str(d.units).trim()||null,type:d.checkbox?'boolean':choices.trim()||selection?'enum':'unknown'});
  }
  return out;
 }
 async getPart(partId:string):Promise<PartRecord>{
  id(partId);const url=new URL('api/part/'+partId+'/',this.base);
  const response=await this.request(url,{method:'GET',headers:{Authorization:'Token '+this.token,Accept:'application/json'},cache:'no-store',redirect:'error',signal:AbortSignal.timeout(20000)});
  if(!response.ok)throw Error('part detail HTTP '+response.status);const p=row(await response.json());
  if(id(p.pk)!==partId)throw Error('part detail identity mismatch');
  const summary={id:partId,name:name(p.name),ipn:p.IPN==null?null:str(p.IPN),description:text(p.description),categoryId:p.category==null?null:id(p.category)};
  const [params,makers,suppliers,attachments]=await Promise.all([
   this.list('api/parameter/',{model_type:'part.part',model_id:partId}),
   this.list('api/company/part/manufacturer/',{part:partId,manufacturer_detail:'true'}),
   this.list('api/company/part/',{part:partId,supplier_detail:'true'}),
   this.list('api/attachment/',{model_type:'part',model_id:partId})
  ]);
  const templates=new Set<string>(),sources:SourceRef[]=source('other',p.link,'Part link');
  const parameters=params.map(r=>{const tid=id(r.template);if(r.model_type!=='part.part'||id(r.model_id)!==partId||templates.has(tid))throw Error('invalid part parameter scope');templates.add(tid);const v=str(r.data);return {templateId:tid,value:v.trim()?v:null}});
  const manufacturerParts=makers.flatMap(r=>{if(id(r.part)!==partId)throw Error('manufacturer part scope mismatch');const manufacturer=company(r,'manufacturer'),mpn=text(r.MPN);sources.push(...source('manufacturer',r.link,manufacturer));return mpn.trim()?[{manufacturer,mpn}]:[]});
  const supplierParts=suppliers.flatMap(r=>{if(id(r.part)!==partId)throw Error('supplier part scope mismatch');const supplier=company(r,'supplier'),sku=text(r.SKU);sources.push(...source('supplier',r.link,supplier));return sku.trim()?[{supplier,sku}]:[]});
  for(const r of attachments){if(r.model_type!=='part'||id(r.model_id)!==partId)throw Error('attachment part scope mismatch');sources.push(...source('other',r.link,text(r.comment)||'Attachment link'))}
  // Do not certify a datasheet by filename, promote private media to external evidence, or invent missing identities.
  return {...summary,parameters,manufacturerParts,supplierParts,sources:[...new Map(sources.map(s=>[JSON.stringify([s.kind,s.url,s.label]),s])).values()]};
 }
}
