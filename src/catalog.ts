export interface CatalogField { key:string; labelZh:string; labelEn:string; type:string; unit:string|null; nullable:boolean;semantics?:'rating'|'nominal'|'classification'|'conditioned';aliases?:string[] }
export interface CatalogCategory {key:string;labelZh?:string; parameters:string[]; identityPolicy:{version:number;fields:string[];genericPooling:boolean;supportedModes:string[];unknownNeverMatches:boolean};source:{provider:string;url:string}}
export interface Catalog {schemaVersion:number;catalogVersion:string;status:string;fieldDefinitions:Record<string,CatalogField>;categories:CatalogCategory[]}
const record=(x:unknown):x is Record<string,unknown>=>!!x&&typeof x==='object'&&!Array.isArray(x);
const nonblank=(x:unknown):x is string=>typeof x==='string'&&x.trim().length>0;
const strings=(x:unknown):x is string[]=>Array.isArray(x)&&x.every(nonblank);
export function validateCatalog(input:unknown):Catalog {
 if(!record(input)||input.schemaVersion!==1||!nonblank(input.catalogVersion)||!nonblank(input.status)||!record(input.fieldDefinitions)||!Object.keys(input.fieldDefinitions).length||!Array.isArray(input.categories)||!input.categories.length)throw Error('invalid catalog');
 const defs=input.fieldDefinitions;const keys=new Set<string>();
 for(const [key,f] of Object.entries(defs)){
  if(!record(f)||f.key!==key||!key.match(/^[a-z][a-z0-9_]*$/)||!nonblank(f.labelZh)||!nonblank(f.labelEn)||typeof f.type!=='string'||!['string','number','enum','boolean'].includes(f.type)||!(f.unit===null||nonblank(f.unit))||typeof f.nullable!=='boolean')throw Error('invalid field '+key);
  if(f.semantics!==undefined&&((typeof f.semantics!=='string'||!['rating','nominal','classification','conditioned'].includes(f.semantics))||f.semantics==='conditioned'&&f.type!=='string'))throw Error('invalid field semantics '+key);
  if(f.aliases!==undefined&&(!strings(f.aliases)||new Set(f.aliases).size!==f.aliases.length))throw Error('invalid field aliases '+key);
 }
 for(const c of input.categories){
  if(!record(c)||typeof c.key!=='string'||!/^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)*$/.test(c.key)||keys.has(c.key)||!strings(c.parameters)||!c.parameters.length||new Set(c.parameters).size!==c.parameters.length||!record(c.identityPolicy)||!record(c.source))throw Error('invalid category');
  const parameters=c.parameters;keys.add(c.key);if(parameters.some(k=>!Object.hasOwn(defs,k)))throw Error('unknown parameter');
  const p=c.identityPolicy;if(!Number.isSafeInteger(p.version)||Number(p.version)<1||!strings(p.fields)||new Set(p.fields).size!==p.fields.length||p.fields.some(k=>!parameters.includes(k))||typeof p.genericPooling!=='boolean'||p.unknownNeverMatches!==true||!strings(p.supportedModes)||!p.supportedModes.length||new Set(p.supportedModes).size!==p.supportedModes.length||p.supportedModes.some(m=>!['exact','generic','partial'].includes(m))||p.genericPooling&&(!p.fields.length||!p.supportedModes.includes('generic')))throw Error('invalid identity policy');
  if(!nonblank(c.source.provider)||!nonblank(c.source.url))throw Error('invalid provenance');
  const u=new URL(c.source.url);if(u.protocol!=='https:'||u.username||u.password)throw Error('invalid provenance');
 }
 return input as unknown as Catalog;
}
export function categoryPolicy(catalog:Catalog,key:string){const c=catalog.categories.find(c=>c.key===key);if(!c)throw Error('unmapped category');return {...c.identityPolicy,genericPooling:catalog.status==='approved_for_production'&&c.identityPolicy.genericPooling}}
