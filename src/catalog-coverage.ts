import {validateCatalog} from './catalog.js';
const record=(x:unknown):x is Record<string,unknown>=>!!x&&typeof x==='object'&&!Array.isArray(x);
const keys=(x:Record<string,unknown>,expected:string[])=>Object.keys(x).length===expected.length&&expected.every(k=>Object.hasOwn(x,k));
const add=(a:number,b:number)=>{const n=a+b;if(!Number.isSafeInteger(n))throw Error('part count overflow');return n};
// Local-only coverage of explicit category mappings. No original names, IDs, SKUs or stock quantities.
export function catalogCoverage(rawCatalog:unknown,catalogSha256:string,input:unknown){
 const catalog=validateCatalog(rawCatalog);
 if(!/^[a-f0-9]{64}$/.test(catalogSha256)||!record(input)||!keys(input,['catalogVersion','catalogSha256','categories'])||input.catalogVersion!==catalog.catalogVersion||input.catalogSha256!==catalogSha256||!Array.isArray(input.categories)||input.categories.length>10000)throw Error('invalid or stale coverage baseline');
 const refs=new Set<string>(),known=new Set(catalog.categories.map(c=>c.key));
 let totalParts=0,mappedParts=0;
 const categories=input.categories.map(raw=>{
  if(!record(raw)||!keys(raw,['categoryRef','partCount','catalogKey'])||typeof raw.categoryRef!=='string'||!/^cat-[0-9]{1,9}$/.test(raw.categoryRef)||refs.has(raw.categoryRef)||typeof raw.partCount!=='number'||!Number.isSafeInteger(raw.partCount)||raw.partCount<0||!(raw.catalogKey===null||typeof raw.catalogKey==='string'&&/^[a-z][a-z0-9_.]{0,127}$/.test(raw.catalogKey)))throw Error('invalid anonymous category aggregate');
  refs.add(raw.categoryRef);
  const status=raw.catalogKey===null?'unmapped':known.has(raw.catalogKey)?'mapped':'unknown_catalog_key';
  totalParts=add(totalParts,raw.partCount);if(status==='mapped')mappedParts=add(mappedParts,raw.partCount);
  return {categoryRef:raw.categoryRef,partCount:raw.partCount,catalogKey:raw.catalogKey,status};
 });
 const mappedCategories=categories.filter(c=>c.status==='mapped').length;
 const status=totalParts===0?'empty_baseline':mappedCategories===categories.length?'fully_mapped':'incomplete';
 return {catalogVersion:catalog.catalogVersion,catalogSha256,catalogStatus:catalog.status,status,totalCategories:categories.length,mappedCategories,unmappedCategories:categories.length-mappedCategories,totalParts,mappedParts,unmappedParts:totalParts-mappedParts,partCoveragePercent:totalParts===0?null:Math.floor(mappedParts/totalParts*10000)/100,categories,requiresFieldReview:true,productionApproval:false};
}
