import type {Catalog} from './catalog.js';
import type {PartRecord} from './inventory-contract.js';
import {previewCategoryTemplateAssociations,type AssociationSnapshot} from './category-template-association.js';
import type {CategoryMapping} from './parameter-mapping.js';
import {reviewEnrichment,approvedEnrichment,type Suggestion} from './enrichment-review.js';
import type {ApprovedPlan,Operation} from './operation-journal.js';
type LinkKey='datasheetUrl'|'imageUrl';
const linkKeys:LinkKey[]=['datasheetUrl','imageUrl'];
export interface ReviewedProviderPart {
 part:PartRecord;mapping:CategoryMapping;identityConfirmed:true;baselineComplete:true;
 parameterRecords:{id:string;templateId:string;value:string;note:string|null}[];
 knownSources:Record<LinkKey,string|null>;suggestions:Suggestion[];accepted:string[];
}
const nonblank=(x:unknown):x is string=>typeof x==='string'&&!!x.trim();
const id=(x:unknown):x is string=>typeof x==='string'&&/^[1-9][0-9]{0,15}$/.test(x)&&Number.isSafeInteger(Number(x));
function safeURL(raw:string){const u=new URL(raw);if(u.protocol!=='https:'||u.username||u.password)throw Error('invalid reviewed link');return u.href}
type Header=Omit<ApprovedPlan,'operations'>;
// Pure reviewed plan. No native write capability or catalog freeze is inferred.
export function planProviderEnrichment(header:Header,catalog:Catalog,snapshot:AssociationSnapshot,rows:ReviewedProviderPart[]):ApprovedPlan{
 const h=structuredClone(header),s=structuredClone(snapshot),inputs=structuredClone(rows);
 if(![h.id,h.instanceId,h.catalogHash,h.snapshotHash,h.approvalId].every(nonblank)||!Array.isArray(inputs)||!inputs.length||inputs.length>100||new Set(inputs.map(r=>r.part.id)).size!==inputs.length||s.instanceId!==h.instanceId||s.complete!==true)throw Error('invalid batch approval');
 const operations:Operation[]=[];
 for(const r of inputs){
  const p=r.part,m=r.mapping;
  if(r.identityConfirmed!==true||r.baselineComplete!==true||!id(p.id)||!nonblank(p.ipn)||p.categoryId!==m.remoteCategoryId||!id(p.categoryId)||!r.accepted.length||!(p.manufacturerParts.some(x=>nonblank(x.manufacturer)&&nonblank(x.mpn))||p.supplierParts.some(x=>nonblank(x.supplier)&&nonblank(x.sku))))throw Error('reviewed exact Part identity and complete baseline required');
  const category=catalog.categories.find(c=>c.key===m.categoryKey);if(!category)throw Error('unknown catalog category');
  const bindings=previewCategoryTemplateAssociations(catalog,m,s,h.instanceId),native=new Map(s.templates.map(t=>[t.id,t]));
  const records=new Map(r.parameterRecords.map(x=>[x.templateId,x]));
  if(records.size!==r.parameterRecords.length||new Set(r.parameterRecords.map(x=>x.id)).size!==r.parameterRecords.length||r.parameterRecords.some(x=>!id(x.id)||!id(x.templateId)||typeof x.value!=='string'||x.value.length>4000||(x.note!==null&&(typeof x.note!=='string'||x.note.length>4000)))||p.parameters.length!==records.size||new Set(p.parameters.map(x=>x.templateId)).size!==p.parameters.length||p.parameters.some(x=>{const y=records.get(x.templateId);return !y||(y.value.trim()?y.value:null)!==x.value}))throw Error('parameter baseline does not match Part detail');
  const known:Record<string,string|null>=Object.create(null);
  for(const key of category.parameters){const binding=Object.hasOwn(m.templates,key)?m.templates[key]:undefined;known[key]=binding?records.get(binding)?.value??null:null}
  const existingLinks=new Set(p.sources.map(x=>safeURL(x.url)));
  for(const key of linkKeys){const value=r.knownSources[key];if(value!==null&&(typeof value!=='string'||!existingLinks.has(safeURL(value))))throw Error('source baseline does not match Part detail');known[key]=value}
  const fields=reviewEnrichment(known,[...category.parameters,...linkKeys],r.suggestions),approved=approvedEnrichment(fields,r.accepted),newLinks=new Set<string>();
  for(const key of r.accepted){
   const value=approved[key],field=fields.find(f=>f.key===key)!;
   if(linkKeys.includes(key as LinkKey)){
    const url=safeURL(value);if(existingLinks.has(url)||newLinks.has(url))throw Error('existing or duplicate source link requires review');newLinks.add(url);
    operations.push({id:h.id+':'+operations.length,kind:'set-part-source',payload:{partId:p.id,ipn:p.ipn,url,comment:key==='datasheetUrl'?'Reviewed datasheet link':'Reviewed image link',sourceReviewed:true,expectedAbsent:true,evidence:structuredClone(field.evidence)}});continue;
   }
   const binding=bindings.find(b=>b.key===key),template=binding?.templateId?native.get(binding.templateId):undefined;
   if(binding?.status!=='direct'||!template||!id(template.id)||!['string','number'].includes(template.type)||template.name.length>100||(template.unit??'').length>100)throw Error('direct reviewed scalar template binding required: '+key);
   const before=records.get(template.id);
   operations.push({id:h.id+':'+operations.length,kind:'set-part-parameter',payload:{partId:p.id,templateId:template.id,templateName:template.name,units:template.unit??'',value,before:before?{id:before.id,value:before.value,note:before.note}:null,evidence:structuredClone(field.evidence)}});
  }
 }
 if(!operations.length||operations.length>1000)throw Error('invalid operation count');
 return {...h,operations};
}
