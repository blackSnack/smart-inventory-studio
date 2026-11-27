export interface CatalogField { key:string; labelZh:string; labelEn:string; type:string; unit:string|null; nullable:boolean;semantics?:'rating'|'nominal'|'classification'|'conditioned';aliases?:string[] }
export interface CatalogCategory {key:string;labelZh?:string; parameters:string[]; identityPolicy:{version:number;fields:string[];genericPooling:boolean;supportedModes:string[];unknownNeverMatches:boolean};source:{provider:string;url:string}}
export interface Catalog {schemaVersion:number;catalogVersion:string;status:string;fieldDefinitions:Record<string,CatalogField>;categories:CatalogCategory[]}
const record=(x:unknown):x is Record<string,unknown>=>!!x&&typeof x==='object'&&!Array.isArray(x);
const strings=(x:unknown):x is string[]=>Array.isArray(x)&&x.every(s=>typeof s==='string'&&s.trim().length>0);
export function validateCatalog(input:unknown):Catalog {
 if(!record(input)||input.schemaVersion!==1||typeof input.catalogVersion!=='string'||typeof input.status!=='string'||!record(input.fieldDefinitions)||!Array.isArray(input.categories))throw Error('invalid catalog');
 const defs=input.fieldDefinitions;const keys=new Set<string>();
 for(const [key,f] of Object.entries(defs)){
  if(!record(f)||f.key!==key||!key.match(/^[a-z][a-z0-9_]*$/)||typeof f.labelZh!=='string'||typeof f.labelEn!=='string'||!['string','number','enum','boolean'].includes(String(f.type))||!(f.unit===null||typeof f.unit==='string')||typeof f.nullable!=='boolean')throw Error('invalid field '+key);
  if(f.semantics!==undefined&&(!['rating','nominal','classification','conditioned'].includes(String(f.semantics))||f.semantics==='conditioned'&&f.type!=='string'))throw Error('invalid field semantics '+key);
  if(f.aliases!==undefined&&(!strings(f.aliases)||new Set(f.aliases).size!==f.aliases.length))throw Error('invalid field aliases '+key);
 }
 for(const c of input.categories){
  if(!record(c)||typeof c.key!=='string'||!c.key.trim()||keys.has(c.key)||!strings(c.parameters)||new Set(c.parameters).size!==c.parameters.length||!record(c.identityPolicy)||!record(c.source))throw Error('invalid category');
  const parameters=c.parameters;keys.add(c.key);if(parameters.some(k=>!Object.hasOwn(defs,k)))throw Error('unknown parameter');
  const p=c.identityPolicy;if(!Number.isSafeInteger(p.version)||Number(p.version)<1||!strings(p.fields)||new Set(p.fields).size!==p.fields.length||p.fields.some(k=>!parameters.includes(k))||typeof p.genericPooling!=='boolean'||p.unknownNeverMatches!==true||!strings(p.supportedModes)||p.supportedModes.some(m=>!['exact','generic','partial'].includes(m))||p.genericPooling&&(!p.fields.length||!p.supportedModes.includes('generic')))throw Error('invalid identity policy');
  if(typeof c.source.provider!=='string'||typeof c.source.url!=='string'||new URL(c.source.url).protocol!=='https:')throw Error('invalid provenance');
 }
 return input as unknown as Catalog;
}
export function categoryPolicy(catalog:Catalog,key:string){const c=catalog.categories.find(c=>c.key===key);if(!c)throw Error('unmapped category');return {...c.identityPolicy,genericPooling:catalog.status==='approved_for_production'&&c.identityPolicy.genericPooling}}
