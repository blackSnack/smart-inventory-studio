import type {Catalog} from './catalog.js';
export interface RemoteTemplate {id:string;name:string;unit:string|null;type:string}
export interface CategoryMapping {categoryKey:string;remoteCategoryId:string;templates:Record<string,string>}
export type MappingEntry={key:string;status:'reuse'|'create'|'review';remoteId?:string;reason?:string};
export function planParameterMapping(catalog:Catalog,mapping:CategoryMapping,remote:RemoteTemplate[]):MappingEntry[]{
 const c=catalog.categories.find(x=>x.key===mapping.categoryKey);if(!c||!mapping.remoteCategoryId.trim())throw Error('invalid category mapping');
 if(new Set(remote.map(x=>x.id)).size!==remote.length)throw Error('duplicate remote template ID');
 if(Object.keys(mapping.templates).some(k=>!c.parameters.includes(k)))throw Error('unmapped template key');
 const used=new Set<string>();
 return c.parameters.map(key=>{
 const d=catalog.fieldDefinitions[key],explicit=mapping.templates[key];
 const compatible=(r:RemoteTemplate)=>r.unit===d.unit&&r.type===d.type;
 if(explicit){const r=remote.find(x=>x.id===explicit);if(!r||!compatible(r)||used.has(explicit))return {key,status:'review',reason:'invalid explicit binding'};used.add(explicit);return {key,status:'reuse',remoteId:explicit}}
 const names=remote.filter(r=>r.name===d.labelZh||r.name===d.labelEn);
 if(names.length===0)return {key,status:'create'};
 if(names.length!==1||!compatible(names[0])||used.has(names[0].id))return {key,status:'review',reason:'name or unit conflict'};
 // Name equality alone is a suggestion, not a confirmed binding.
 return {key,status:'review',remoteId:names[0].id,reason:'confirm semantic binding'};
 });
}
export function mapParameterValues(catalog:Catalog,mapping:CategoryMapping,remote:RemoteTemplate[],values:Record<string,string|null>){
 const plan=planParameterMapping(catalog,mapping,remote);if(Object.keys(values).some(k=>!plan.some(p=>p.key===k)))throw Error('unknown field');
 return plan.flatMap(p=>{const value=values[p.key];if(value===null||value===undefined||value.trim()==='')return [];if(p.status!=='reuse'||!p.remoteId)throw Error('parameter binding not approved: '+p.key);return [{templateId:p.remoteId,value}]});
}
