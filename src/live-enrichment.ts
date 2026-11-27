import type {Catalog} from './catalog.js';
import type {PartRecord} from './inventory-contract.js';
import type {AssociationSnapshot} from './category-template-association.js';
import type {ScalarTypeReview} from './inventree-association-read.js';
import {indexAssociationSnapshot} from './category-template-association.js';
import type {CategoryMapping} from './parameter-mapping.js';
import type {EnrichmentRequest} from './ai-enrichment-provider.js';
import {reviewEnrichment,type Suggestion} from './enrichment-review.js';
export type LinkKey='datasheetUrl'|'imageUrl';
export const liveLinkKeys:LinkKey[]=['datasheetUrl','imageUrl'];
export interface LiveBaseline {part:PartRecord;parameterRecords:{id:string;templateId:string;value:string;note:string}[];baselineComplete:false}
export type LiveMapping={categoryKey:string;templates:Record<string,string>;missingSources:LinkKey[]};
export function publicIdentity(p:PartRecord){
 const makers=[...new Map(p.manufacturerParts.filter(m=>m.manufacturer.trim()&&m.mpn.trim()).map(m=>[JSON.stringify([m.manufacturer,m.mpn]),m])).values()];
 const suppliers=[...new Map(p.supplierParts.filter(m=>m.supplier.trim()&&m.sku.trim()).map(m=>[JSON.stringify([m.supplier,m.sku]),m])).values()];
 if(makers.length===1)return {name:makers[0].manufacturer+' '+makers[0].mpn,...makers[0]};
 if(!makers.length&&suppliers.length===1)return {name:suppliers[0].supplier+' '+suppliers[0].sku,...suppliers[0]};
 throw Error('元件型号不唯一或未核验，不能推断技术参数');
}
// Suggestions are never approved mappings until the user confirms the displayed IDs/semantics.
export function mappingCandidates(catalog:Catalog,b:LiveBaseline,s:AssociationSnapshot,categoryKey:string){
 const category=catalog.categories.find(c=>c.key===categoryKey),p=b.part;indexAssociationSnapshot(s,s.instanceId);
 if(!category||!p.categoryId||!s.categories.some(c=>c.id===p.categoryId))throw Error('分类待核对');
 const direct=new Set(s.relations.filter(r=>r.categoryId===p.categoryId).map(r=>r.templateId));
 return category.parameters.flatMap(key=>{const f=catalog.fieldDefinitions[key];if(f.type!=='string'&&f.type!=='number')return [];const names=new Set([f.labelZh,f.labelEn,...(f.aliases??[])]);
 const candidates=s.templates.filter(t=>direct.has(t.id)&&t.enabled&&t.type==='unknown'&&(!Object.hasOwn(t,'scalarReviewable')||(t as typeof t&{scalarReviewable:boolean}).scalarReviewable===true)&&t.unit===f.unit&&names.has(t.name));return candidates.length===1?[{key,template:candidates[0],type:f.type as 'string'|'number'}]:[]}).filter((x,_,all)=>all.filter(y=>y.template.id===x.template.id).length===1);
}
export function scalarReviews(catalog:Catalog,b:LiveBaseline,s:AssociationSnapshot,config:LiveMapping):ScalarTypeReview[]{
 const candidates=mappingCandidates(catalog,b,s,config.categoryKey);
 return Object.entries(config.templates).map(([key,id])=>{const c=candidates.find(x=>x.key===key&&x.template.id===id);if(!c)throw Error('映射不匹配');return {templateId:id,name:c.template.name,unit:c.template.unit,type:c.type,confirmed:true}});
}
export function prepareLiveResearch(catalog:Catalog,b:LiveBaseline,s:AssociationSnapshot,config:LiveMapping):{request:EnrichmentRequest;mapping:CategoryMapping}{
 const p=b.part,identity=publicIdentity(p),category=catalog.categories.find(c=>c.key===config.categoryKey),{categories,templates,pairs}=indexAssociationSnapshot(s,s.instanceId);
 if(!p.ipn?.trim()||!p.categoryId||!categories.has(p.categoryId)||!category)throw Error('元件身份或分类待核对');
 const keys=Object.keys(config.templates),ids=Object.values(config.templates);
 if(new Set(ids).size!==ids.length||new Set(config.missingSources).size!==config.missingSources.length||config.missingSources.some(k=>!liveLinkKeys.includes(k)))throw Error('重复或无效映射');
 const records=new Map(b.parameterRecords.map(x=>[x.templateId,x]));
 if(records.size!==b.parameterRecords.length||p.parameters.length!==records.size||p.parameters.some(x=>!records.has(x.templateId)||(records.get(x.templateId)!.value.trim()?records.get(x.templateId)!.value:null)!==x.value))throw Error('参数基线不一致');
 const known:Record<string,string|null>=Object.create(null);
 for(const k of keys){const f=catalog.fieldDefinitions[k],t=templates.get(config.templates[k]);if(!category.parameters.includes(k)||!f||!t?.enabled||!['string','number'].includes(t.type)||f.type!==t.type||f.unit!==t.unit||!pairs.has(JSON.stringify([p.categoryId,t.id])))throw Error('需要直接且已审核的参数映射');known[k]=records.get(t.id)?.value??null}
 for(const k of config.missingSources)known[k]=null;
 const allowedKeys=[...keys,...config.missingSources];if(!allowedKeys.length)throw Error('没有已审核的补全字段');
 // Public identity, explicitly reviewed values only. No internal name, IPN, URLs, locations or stock sent.
 return {request:{partId:p.id,...identity,category:category.key,known,allowedKeys,sourceUrls:[]},mapping:{categoryKey:category.key,remoteCategoryId:p.categoryId,templates:structuredClone(config.templates)}};
}
export function reviewLiveResearch(b:LiveBaseline,request:EnrichmentRequest,suggestions:Suggestion[]){
 const all=[...suggestions,...request.allowedKeys.filter(k=>!suggestions.some(s=>s.key===k)).map(key=>({key,value:null,evidence:[]}))];
 // Omitted fields are explicitly unknown; only approved mapped values and confirmed missing sources are eligible.
 return reviewEnrichment(request.known,request.allowedKeys,all).map(f=>{
 if(liveLinkKeys.includes(f.key as LinkKey)&&f.value!==null){try{const u=new URL(f.value);if(u.protocol!=='https:'||u.username||u.password||b.part.sources.some(x=>x.url===u.href))return {...f,status:'unsupported' as const}}catch{return {...f,status:'unsupported' as const}}}
 return f;
 });
}
