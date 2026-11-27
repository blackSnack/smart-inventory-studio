import {InvenTreeReadProvider} from './domain.js';
import {probeSchema} from './provider-schema.js';
import {validateCatalog} from './catalog.js';
import {catalogCoverage} from './catalog-coverage.js';

const row=(x:unknown):Record<string,unknown>=>{
 if(!x||typeof x!=='object'||Array.isArray(x))throw Error('invalid baseline row');
 return x as Record<string,unknown>;
};
const id=(x:unknown):string=>{
 const s=typeof x==='number'&&Number.isSafeInteger(x)?String(x):x;
 if(typeof s!=='string'||!(/^[1-9][0-9]{0,17}$/).test(s))throw Error('invalid baseline ID');
 return s;
};
const nullableId=(x:unknown)=>x===null?null:id(x);
function unique<T extends {id:string}>(rows:T[]){
 if(new Set(rows.map(r=>r.id)).size!==rows.length)throw Error('duplicate baseline ID');
 return rows.sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
}
function project(categories:unknown[],parts:unknown[]){
 const cats=unique(categories.map(x=>{
  const r=row(x);
  if(typeof r.name!=='string'||!r.name.trim()||typeof r.structural!=='boolean'||!Object.hasOwn(r,'parent'))throw Error('invalid category evidence');
  return {id:id(r.pk),name:r.name,parentId:nullableId(r.parent),structural:r.structural};
 }));
 const memberships=unique(parts.map(x=>{
  const r=row(x);if(!Object.hasOwn(r,'category'))throw Error('missing Part category evidence');
  return {id:id(r.pk),categoryId:nullableId(r.category)};
 }));
 const index=new Map(cats.map(c=>[c.id,c])),checked=new Set<string>();
 for(const c of cats){
  let current:typeof c|undefined=c;const chain=new Set<string>();
  while(current&&!checked.has(current.id)){
   if(chain.has(current.id))throw Error('cyclic category baseline');
   chain.add(current.id);
   if(current.parentId===null)break;
   current=index.get(current.parentId);
   if(!current)throw Error('missing category parent');
  }
  for(const key of chain)checked.add(key);
 }
 for(const p of memberships)if(p.categoryId!==null&&!index.has(p.categoryId))throw Error('missing Part category');
 return {cats,memberships};
}
export function buildLocalCategoryBaseline(rawCatalog:unknown,catalogSha256:string,first:{categories:unknown[];parts:unknown[]},second:{categories:unknown[];parts:unknown[]}){
 const catalog=validateCatalog(rawCatalog);
 const a=project(first.categories,first.parts),b=project(second.categories,second.parts);
 if(JSON.stringify(a)!==JSON.stringify(b))throw Error('category membership changed during collection');
 const counts=new Map<string|null,number>();
 for(const p of a.memberships)counts.set(p.categoryId,(counts.get(p.categoryId)??0)+1);
 const parents=new Set(a.cats.map(c=>c.parentId));
 // Direct Part membership only: never roll descendants into ancestors.
 const localReview=a.cats.filter(c=>!parents.has(c.id)||counts.has(c.id)).map(c=>({
  categoryId:c.id,name:c.name,parentId:c.parentId,structural:c.structural,hasChildren:parents.has(c.id),partCount:counts.get(c.id)??0
 }));
 const review:(typeof localReview[number]&{categoryRef:string})[]=localReview.map((c,i)=>({...c,categoryRef:'cat-'+(i+1)}));
 const anonymous=review.map(c=>({categoryRef:c.categoryRef,partCount:c.partCount,catalogKey:null}));
 const uncategorized=counts.get(null)??0;
 if(uncategorized)anonymous.push({categoryRef:'cat-'+(anonymous.length+1),partCount:uncategorized,catalogKey:null});
 const aggregate={catalogVersion:catalog.catalogVersion,catalogSha256,categories:anonymous};
 const report=catalogCoverage(catalog,catalogSha256,aggregate);
 if(report.totalParts!==a.memberships.length)throw Error('category count mismatch');
 return {status:'stable-visible-candidate' as const,visiblePartCount:a.memberships.length,privateCategoryReview:review,uncategorizedRef:uncategorized?anonymous[anonymous.length-1].categoryRef:null,aggregate,requiresOperatorVisibilityConfirmation:true as const,productionApproval:false as const};
}
// Only the two fixed GET collections and their schema declarations are used.
export async function collectLocalCategoryBaseline(config:{base:string;token:string},rawCatalog:unknown,catalogSha256:string,request:typeof fetch=fetch){
 validateCatalog(rawCatalog);
 if(!/^[a-f0-9]{64}$/.test(catalogSha256))throw Error('invalid catalog hash');
 const paths=['/api/part/category/','/api/part/'];
 const probe=await probeSchema(config.base,config.token,paths.map(path=>({key:path,path,method:'get'})),request);
 if(probe.operations.some(op=>!op.declared))throw Error('category baseline API not declared');
 const read=new InvenTreeReadProvider(config.base,config.token,request);
 const snapshot=async()=>({categories:await read.list('api/part/category/'),parts:await read.list('api/part/')});
 const first=await snapshot(),second=await snapshot();
 return buildLocalCategoryBaseline(rawCatalog,catalogSha256,first,second);
}
