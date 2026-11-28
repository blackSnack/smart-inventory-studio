import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateCatalog} from '../dist/catalog.js';
import {parseLabelEvidence,hasStrongPhotoIdentity} from '../dist/photo-intake.js';
import {prepareDemoDraft} from '../dist/demo-part-draft.js';
const catalog=validateCatalog(JSON.parse(readFileSync(new URL('../catalog/electronic-parts.json',import.meta.url))));
const multiple={kind:'multiple',readability:'partial',rawText:'Two independent package labels',parameters:{},packages:[
 {readability:'clear',rawText:'YAGEO RC0603FR-0710KL 10kΩ 0603 10 PCS 贴片电阻',name:'YAGEO resistor',manufacturer:'YAGEO',mpn:'RC0603FR-0710KL',supplier:null,sku:null,category:'resistor.smd',parameters:{resistance:'10kΩ',package:'0603'}},
 {readability:'partial',rawText:'NOBRAND-001 0603 20 PCS',name:'NOBRAND-001',manufacturer:null,mpn:'NOBRAND-001',supplier:null,sku:null,category:'resistor.smd',parameters:{package:'0603'}}
]};
test('multiple package labels remain separate candidates and image-wide decoded identifiers are discarded',()=>{
 const decoded=[{format:'qr_code',raw:'C123456'},{format:'code_128',raw:'ORDER-ONLY'}];
 const r=parseLabelEvidence(multiple,catalog,decoded);
 assert.equal(r.kind,'multiple');assert.equal(r.quantity,null);assert.equal(r.draft.mpn,null);assert.deepEqual(r.codes,[]);assert.equal(r.packages.length,2);
 const [a,b]=r.packages;assert.equal(a.id,'package-1');assert.equal(a.draft.mpn,'RC0603FR-0710KL');assert.equal(a.draft.manufacturer,'YAGEO');assert.equal(a.quantity,10);
 assert.equal(b.id,'package-2');assert.equal(b.draft.mpn,'NOBRAND-001');assert.equal(b.draft.manufacturer,null);assert.equal(b.quantity,20);
 assert.deepEqual(a.codes,[]);assert.deepEqual(b.codes,[]);assert.equal(b.draft.category,null);assert.equal(b.candidateCategory,'resistor.smd');
});
test('unbranded partial identity remains independent and is never promoted to exact identity',()=>{
 const r=parseLabelEvidence(multiple,catalog),candidate=r.packages[1];
 assert.equal(hasStrongPhotoIdentity(candidate.draft),false);
 const draft={...candidate.draft,category:'resistor.smd'};
 const prepared=prepareDemoDraft(draft,catalog,'partial','synthetic-unbranded-part',[]);
 assert.equal(prepared.part.partial,true);assert.equal(prepared.part.details.identity.mode,'partial');assert.equal(prepared.part.details.identity.mpn,'NOBRAND-001');assert.equal(prepared.resolution.decision,'new');assert.equal(prepared.blocked,false);
 assert.throws(()=>prepareDemoDraft(draft,catalog,'exact','synthetic-unbranded-part',[]),/精确身份/);
});
test('multiple package count is bounded and empty separation never fabricates one package',()=>{
 assert.throws(()=>parseLabelEvidence({...multiple,packages:Array.from({length:9},()=>multiple.packages[0])},catalog),/package candidates/);
 const r=parseLabelEvidence({...multiple,packages:[]},catalog);assert.deepEqual(r.packages,[]);assert.equal(r.draft.mpn,null);assert.equal(r.quantity,null);
});
