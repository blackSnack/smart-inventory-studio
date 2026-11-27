import type {PhotoDraft} from './ai-provider.js';
import {parseDraft} from './ai-provider.js';
import type {Catalog} from './catalog.js';
import {indexAssociationSnapshot,type AssociationSnapshot} from './category-template-association.js';
import {reviewEnrichment,approvedEnrichment,type Evidence} from './enrichment-review.js';
import type {NativeQueueItem} from './browser-native-workflow.js';
type Choice={templateId:string;templateName:string;units:string};
export type PhotoInheritanceField={key:string;value:string;kind:'parameter'|'source';evidence:Evidence[];choices:Choice[];reason?:string};
export function photoInheritanceFields(catalog:Catalog,raw:PhotoDraft,categoryId:string,s:AssociationSnapshot):PhotoInheritanceField[]{
 const d=parseDraft(raw,catalog.categories.map(c=>c.key)),category=catalog.categories.find(c=>c.key===d.category),{categories,templates,pairs}=indexAssociationSnapshot(s,s.instanceId);
 if(!category||!categories.has(categoryId))throw Error('reviewed category required');
 if(Object.keys(d.parameters).some(k=>!category.parameters.includes(k)))throw Error('unmapped draft field');
 const out:PhotoInheritanceField[]=[];
 for(const key of category.parameters){
  const value=d.parameters[key];if(!value?.trim())continue;
  const f=catalog.fieldDefinitions[key],evidence=d.fieldEvidence?.[key]??[],names=new Set([f.labelZh,f.labelEn,...f.aliases??[]]);
  const choices=[...templates.values()].filter(t=>['string','number'].includes(f.type)&&t.enabled&&t.type==='unknown'&&(t as typeof t&{scalarReviewable?:boolean}).scalarReviewable===true&&t.unit===f.unit&&names.has(t.name)&&pairs.has(JSON.stringify([categoryId,t.id]))).map(t=>({templateId:t.id,templateName:t.name,units:t.unit??''}));
  out.push({key,value,kind:'parameter',evidence,choices,...(!choices.length?{reason:'无兼容的直接标量模板'}:{})});
 }
 const links=new Map<string,string>();
 for(const [k,v] of [['datasheetUrl',d.datasheetUrl],['imageUrl',d.imageUrl]] as const)if(v)links.set(new URL(v).href,k);
 for(const v of d.sourceUrls)if(!links.has(new URL(v).href))links.set(new URL(v).href,'source:'+links.size);
 for(const [value,key] of links)out.push({key,value,kind:'source',choices:[],evidence:d.fieldEvidence?.[key]??[]});
 return out;
}
export type InheritanceReview={key:string;include:boolean;templateId?:string;evidence?:Evidence[]};
// Every nonblank field/link must be explicitly accepted or omitted. No silent loss.
export function planPhotoInheritance(createId:string,ipn:string,categoryId:string,categoryKey:string,fields:PhotoInheritanceField[],reviews:InheritanceReview[],id:()=>string):NativeQueueItem[]{
 if(!createId||!ipn.trim()||!categoryId||!categoryKey||new Set(fields.map(f=>f.key)).size!==fields.length||reviews.length!==fields.length||new Set(reviews.map(r=>r.key)).size!==reviews.length)throw Error('incomplete inheritance review');
 const used=new Set<string>(),out:NativeQueueItem[]=[];
 for(const f of fields){
  const r=reviews.find(x=>x.key===f.key);if(!r||typeof r.include!=='boolean')throw Error('every field requires a decision');if(!r.include)continue;
  if(f.kind==='source'){out.push({id:id(),kind:'after-part-enrichment',createId,ipn,categoryId,categoryKey,payload:{kind:'source',url:f.value,comment:f.key==='datasheetUrl'?'Reviewed datasheet link':f.key==='imageUrl'?'Reviewed image link':'Reviewed source link'}});continue}
  const choice=f.choices.find(x=>x.templateId===r.templateId);if(!choice||used.has(choice.templateId))throw Error('explicit unique scalar mapping required');used.add(choice.templateId);
  const evidence=r.evidence??f.evidence,approved=approvedEnrichment(reviewEnrichment({},[f.key],[{key:f.key,value:f.value,evidence}]),[f.key]);
  out.push({id:id(),kind:'after-part-enrichment',createId,ipn,categoryId,categoryKey,fieldKey:f.key,payload:{kind:'parameter',...choice,value:approved[f.key],evidence:structuredClone(evidence)}});
 }
 return out;
}
