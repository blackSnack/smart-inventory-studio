import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {reviewCatalogFreeze} from '../dist/catalog-freeze-review.js';
const bytes=readFileSync(new URL('../catalog/electronic-parts.json',import.meta.url)),catalog=JSON.parse(bytes),hash=createHash('sha256').update(bytes).digest('hex');
const rows=catalog.categories.flatMap(c=>c.parameters.map(key=>{
 const f=catalog.fieldDefinitions[key];
 return {categoryKey:c.key,fieldKey:key,reviewed:true,type:f.type,unit:f.unit,nullable:f.nullable,semantics:f.semantics??'classification',sourceLabel:'Fixture label',rawEvidence:'Fixture evidence',locator:'Table 1',sourceUrl:'https://example.test/fixture',observedDate:'2026-01-01',conditions:f.semantics==='conditioned'?'Fixture conditions':''};
}));
const fixture={catalogVersion:catalog.catalogVersion,catalogSha256:hash,visibilityConfirmed:true,coverage:{catalogVersion:catalog.catalogVersion,catalogSha256:hash,categories:[{categoryRef:'cat-1',partCount:2,catalogKey:'resistor.smd'}]},fieldReviews:rows,exclusions:[]};
const check=x=>reviewCatalogFreeze(catalog,hash,x);
test('all category/field pairs require explicit reviews; ready does not grant freeze or production approval',()=>{
 const r=check(fixture);assert.equal(r.status,'proposal-ready');assert.equal(r.productionApproval,false);assert.equal(r.requiresG2Approval,true);assert.equal(r.fieldReviewCount,rows.length);
 assert.ok(!JSON.stringify(r).includes('Fixture evidence'));assert.ok(!JSON.stringify(r).includes('example.test'));
 const incomplete=check({...fixture,fieldReviews:rows.slice(1),visibilityConfirmed:false});
 assert.equal(incomplete.status,'incomplete');assert.equal(incomplete.missingFields.length,1);assert.ok(incomplete.blockers.includes('local-visibility-not-confirmed'));
});
test('reviewed exclusion is not a mapping; unknown catalog keys never qualify as exclusions',()=>{
 const coverage={...fixture.coverage,categories:[...fixture.coverage.categories,{categoryRef:'cat-2',partCount:1,catalogKey:null}]};
 assert.equal(check({...fixture,coverage}).status,'incomplete');
 const exclusions=[{categoryRef:'cat-2',reviewed:true,reason:'Requires local template extension'}];
 const r=check({...fixture,coverage,exclusions});assert.equal(r.status,'proposal-ready');assert.equal(r.coverageStatus,'incomplete');assert.equal(r.reviewedExclusions,1);
 const unknown={...coverage,categories:[coverage.categories[0],{...coverage.categories[1],catalogKey:'unknown.type'}]};
 assert.throws(()=>check({...fixture,coverage:unknown,exclusions}));
});
test('stale hashes, malformed/duplicate reviews, measured-as-rated and missing source conditions fail closed',()=>{
 assert.throws(()=>check({...fixture,catalogSha256:'0'.repeat(64)}));
 const replace=(first)=>({...fixture,fieldReviews:[first,...rows.slice(1)]});
 for(const r of [{...rows[0],unit:'bad'},{...rows[0],sourceUrl:'http://example.test'},{...rows[0],sourceUrl:'https://u:p@example.test'},{...rows[0],observedDate:'2026-02-30'},{...rows[0],semantics:'measured'},{...rows[0],locator:' '},{...rows[0],reviewed:false}])assert.throws(()=>check(replace(r)));
 assert.throws(()=>check({...fixture,fieldReviews:[...rows,rows[0]]}));
 const conditioned=rows.findIndex(x=>x.semantics==='conditioned');assert.ok(conditioned>=0);
 const bad=structuredClone(fixture);bad.fieldReviews[conditioned].conditions='';assert.throws(()=>check(bad));
 assert.equal(check({...fixture,coverage:{...fixture.coverage,categories:[]}}).status,'incomplete');
});
