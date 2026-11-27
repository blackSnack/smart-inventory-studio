import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {buildLocalCategoryBaseline,collectLocalCategoryBaseline} from '../dist/local-category-baseline.js';
const bytes=readFileSync(new URL('../catalog/electronic-parts.json',import.meta.url)),catalog=JSON.parse(bytes),hash=createHash('sha256').update(bytes).digest('hex');
const cats=[{pk:11,name:'Private root',parent:null,structural:true},{pk:12,name:'Private leaf',parent:11,structural:false},{pk:13,name:'Empty leaf',parent:11,structural:false}];
const parts=[{pk:51,category:12,name:'Private Part',stock:900},{pk:52,category:11},{pk:53,category:null},{pk:54,category:12}];
const snapshot={categories:cats,parts};
test('stable direct membership counts each Part once; include empty leaf, direct parent and uncategorized',()=>{
 const r=buildLocalCategoryBaseline(catalog,hash,snapshot,{categories:[...cats].reverse(),parts:[...parts].reverse()});
 assert.equal(r.visiblePartCount,4);assert.deepEqual(r.aggregate.categories.map(c=>c.partCount),[1,2,0,1]);
 assert.ok(r.aggregate.categories.every(c=>c.catalogKey===null));
 assert.equal(r.uncategorizedRef,'cat-4');
 assert.equal(r.privateCategoryReview[0].hasChildren,true);
 assert.equal(r.requiresOperatorVisibilityConfirmation,true);assert.equal(r.productionApproval,false);
 assert.ok(!JSON.stringify(r.aggregate).includes('Private'));
 assert.ok(!JSON.stringify(r).includes('Private Part'));
});
test('reject missing parent/category, duplicate IDs, missing explicit null and moving memberships',()=>{
 for(const bad of [
  {...snapshot,categories:[cats[1]]},
  {...snapshot,categories:[...cats,cats[0]]},
  {...snapshot,categories:[{...cats[0],parent:12},...cats.slice(1)]},
  {...snapshot,parts:[...parts,parts[0]]},
  {...snapshot,parts:[{pk:51}]},
  {...snapshot,parts:[{pk:51,category:99}]},
  {...snapshot,parts:[{...parts[0],category:13},...parts.slice(1)]}
 ])assert.throws(()=>buildLocalCategoryBaseline(catalog,hash,snapshot,bad));
});
test('read-only collection uses declared paths and two complete passes, rejects drift and missing declarations',async()=>{
 const paths={'/api/part/':{get:{}},'/api/part/category/':{get:{}}};
 const calls=[];
 const request=async(u,i)=>{
  const url=new URL(u);calls.push(url.pathname);assert.equal(url.origin,'https://inventory.test');assert.ok(i.method===undefined||i.method==='GET');assert.equal(i.redirect,'error');
  if(url.pathname==='/api/schema/')return Response.json({openapi:'3.0.0',paths});
  const data=url.pathname==='/api/part/category/'?cats:url.pathname==='/api/part/'?parts:null;
  assert.ok(data);return Response.json({count:data.length,next:null,results:data});
 };
 const r=await collectLocalCategoryBaseline({base:'https://inventory.test',token:'fixture'},catalog,hash,request);
 assert.equal(r.visiblePartCount,4);
 assert.deepEqual(calls,['/api/schema/','/api/part/category/','/api/part/','/api/part/category/','/api/part/']);
 await assert.rejects(collectLocalCategoryBaseline({base:'https://inventory.test',token:'fixture'},catalog,hash,async()=>Response.json({openapi:'3.0.0',paths:{}})));
});
