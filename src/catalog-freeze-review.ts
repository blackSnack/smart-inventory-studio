import {validateCatalog} from './catalog.js';
import {catalogCoverage} from './catalog-coverage.js';

const obj=(x:unknown):Record<string,unknown>=>{
 if(!x||typeof x!=='object'||Array.isArray(x))throw Error('invalid review record');
 return x as Record<string,unknown>;
};
const text=(x:unknown,max:number):string=>{
 if(typeof x!=='string'||!x.trim()||x.length>max)throw Error('invalid review text');return x;
};
function source(x:unknown){
 const u=new URL(text(x,4000));if(u.protocol!=='https:'||u.username||u.password)throw Error('invalid review source');return u.href;
}
function date(x:unknown){
 const d=text(x,10);if(!/^\d{4}-\d{2}-\d{2}$/.test(d)||!Number.isFinite(Date.parse(d))||new Date(d).toISOString().slice(0,10)!==d)throw Error('invalid source observation date');return d;
}
// A local pre-freeze proposal check, not an approval or a catalog mutation.
export function reviewCatalogFreeze(rawCatalog:unknown,hash:string,input:unknown){
 const catalog=validateCatalog(rawCatalog),r=obj(input);
 if(!/^[a-f0-9]{64}$/.test(hash)||r.catalogVersion!==catalog.catalogVersion||r.catalogSha256!==hash)throw Error('stale freeze review');
 const coverage=catalogCoverage(rawCatalog,hash,r.coverage);
 if(!Array.isArray(r.fieldReviews)||r.fieldReviews.length>100000||!Array.isArray(r.exclusions)||r.exclusions.length>10000)throw Error('invalid review lists');
 const fields=new Map(catalog.categories.flatMap(c=>c.parameters.map(k=>[c.key+'/'+k,catalog.fieldDefinitions[k]] as const)));
 const reviewed=new Set<string>();
 for(const v of r.fieldReviews){
  const e=obj(v),category=text(e.categoryKey,128),key=text(e.fieldKey,128),pair=category+'/'+key,f=fields.get(pair);
  if(!f||reviewed.has(pair)||e.reviewed!==true||e.unit!==f.unit||e.type!==f.type||e.nullable!==f.nullable)throw Error('invalid or stale field review');
  const semantics=text(e.semantics,40);
  if(!['rating','nominal','classification','conditioned','measured'].includes(semantics)||f.semantics!==undefined&&f.semantics!==semantics||semantics==='conditioned'&&f.type!=='string'||semantics==='measured')throw Error('incompatible catalog field semantics');
  // Measured observations are not catalog ratings; preserve them outside the standard definition.
  text(e.sourceLabel,500);text(e.rawEvidence,4000);text(e.locator,1000);date(e.observedDate);source(e.sourceUrl);
  if(typeof e.conditions!=='string'||e.conditions.length>2000||semantics==='conditioned'&&!e.conditions.trim())throw Error('missing condition review');
  reviewed.add(pair);
 }
 const unmapped=new Set(coverage.categories.filter(c=>c.status==='unmapped').map(c=>c.categoryRef)),exceptions=new Set<string>();
 for(const v of r.exclusions){
  const e=obj(v),ref=text(e.categoryRef,128);
  if(!unmapped.has(ref)||exceptions.has(ref)||e.reviewed!==true)throw Error('invalid coverage exclusion');
  text(e.reason,1000);exceptions.add(ref);
 }
 const missingFields=[...fields.keys()].filter(k=>!reviewed.has(k));
 const unresolvedCategories=coverage.categories.filter(c=>c.status!=='mapped'&&!exceptions.has(c.categoryRef)).map(c=>({categoryRef:c.categoryRef,status:c.status}));
 const blockers:string[]=[];
 if(r.visibilityConfirmed!==true)blockers.push('local-visibility-not-confirmed');
 if(coverage.totalParts===0)blockers.push('empty-part-baseline');
 if(missingFields.length)blockers.push('missing-field-review');
 if(unresolvedCategories.length)blockers.push('unresolved-category');
 if(catalog.status==='approved_for_production')blockers.push('already-approved-catalog');
 return {catalogVersion:catalog.catalogVersion,catalogSha256:hash,status:blockers.length?'incomplete':'proposal-ready',blockers,fieldReviewCount:reviewed.size,requiredFieldReviewCount:fields.size,missingFields,unresolvedCategories,reviewedExclusions:exceptions.size,coverageStatus:coverage.status,requiresIndependentSourceReview:true as const,requiresG2Approval:true as const,productionApproval:false as const};
}
