import type {Catalog} from './catalog.js';
export interface RemoteTemplate {id:string;name:string;unit:string|null;type:string}
export interface CategoryMapping {categoryKey:string;remoteCategoryId:string;templates:Record<string,string>}
export type MappingEntry={key:string;status:'reuse'|'create'|'review';remoteId?:string;reason?:string};
export function planParameterMapping(catalog:Catalog,mapping:CategoryMapping,remote:RemoteTemplate[]):MappingEntry[]{
 const c=catalog.categories.find(x=>x.key===mapping.categoryKey);if(!c||!mapping.remoteCategoryId.trim())throw Error('invalid category mapping');
 if(remote.some(r=>typeof r.id!=='string'||!r.id.trim()||typeof r.name!=='string'||!r.name.trim())||new Set(remote.map(x=>x.id)).size!==remote.length)throw Error('invalid or duplicate remote template ID');
 if(Object.keys(mapping.templates).some(k=>!c.parameters.includes(k)))throw Error('unmapped template key');
 const bindings=Object.values(mapping.templates);
 if(bindings.some(id=>typeof id!=='string'||!id.trim()))throw Error('invalid explicit binding');
 if(new Set(bindings).size!==bindings.length)throw Error('duplicate explicit template binding');
 // Reserve all approved IDs before considering any name/alias suggestion, independent of field order.
 const reserved=new Set(bindings);
 const candidates=new Map(c.parameters.map(key=>{const d=catalog.fieldDefinitions[key];const labels=new Set([d.labelZh,d.labelEn,...(d.aliases??[])]);return [key,remote.filter(r=>labels.has(r.name))] as const}));
 return c.parameters.map(key=>{
 const d=catalog.fieldDefinitions[key],explicit=Object.hasOwn(mapping.templates,key)?mapping.templates[key]:undefined;
 const compatible=(r:RemoteTemplate)=>r.unit===d.unit&&r.type===d.type;
 if(explicit!==undefined){const r=remote.find(x=>x.id===explicit);if(!r||!compatible(r))return {key,status:'review',reason:'invalid explicit binding'};return {key,status:'reuse',remoteId:explicit}}
 const names=candidates.get(key)!;
 if(names.length===0)return {key,status:'create'};
 if(names.length!==1||!compatible(names[0])||reserved.has(names[0].id)||c.parameters.some(other=>other!==key&&candidates.get(other)!.some(r=>r.id===names[0].id)))return {key,status:'review',reason:'name, alias or unit conflict'};
 // Name or alias equality alone is a suggestion, not a confirmed semantic binding.
 return {key,status:'review',remoteId:names[0].id,reason:'confirm semantic binding'};
 });
}
export function mapParameterValues(catalog:Catalog,mapping:CategoryMapping,remote:RemoteTemplate[],values:Record<string,string|null>){
 const plan=planParameterMapping(catalog,mapping,remote);if(Object.keys(values).some(k=>!plan.some(p=>p.key===k)))throw Error('unknown field');
 return plan.flatMap(p=>{const value=values[p.key];if(value===null||value===undefined||value.trim()==='')return [];if(p.status!=='reuse'||!p.remoteId)throw Error('parameter binding not approved: '+p.key);return [{templateId:p.remoteId,value}]});
}
