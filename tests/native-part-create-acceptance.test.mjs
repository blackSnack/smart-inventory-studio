import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {NativePartCreateAcceptance,nativePartPreparationHash} from '../dist/native-part-create-acceptance.js';
import {LocalNativeReceiptEvidence} from '../tools/native-receipt-evidence.mjs';
const input={ipn:'FIX-001',categoryId:'7',categoryName:'Resistors',name:'Fixture resistor',description:'Partial',units:'pcs'};
const approve=async p=>({approvedPreparationSha256:await nativePartPreparationHash(p),disposableInstanceConfirmed:true,writeAuthorized:true,visibilityConfirmed:true,exclusiveAccessConfirmed:true,identityConfirmed:true,newPartConfirmed:true});
const base='http://127.0.0.1:8123/';
function fixture(legacy=false){
 const info={server:'InvenTree',version:legacy?'0.16.7':'1.7.4',apiVersion:legacy?232:570},schema={openapi:'3.0.3',paths:{'/api/part/category/{id}/':{get:{}},'/api/part/':{get:{},post:{}},'/api/part/{id}/':{get:{}},'/api/stock/':{get:{}},[legacy?'/api/part/parameter/':'/api/parameter/']:{get:{}}}};
 const category={pk:7,name:'Resistors',structural:false},parts=[],stock=[],parameters=[],writes=[];let lost=false;
 const request=async(u,i)=>{
  const url=new URL(u),method=i.method??'GET';assert.equal(url.origin,'http://127.0.0.1:8123');assert.equal(i.redirect,'error');assert.equal(i.headers.Authorization,'Token fixture');
  if(url.pathname==='/api/')return Response.json(info);
  if(url.pathname==='/api/user/me/')return Response.json({pk:1});
  if(url.pathname==='/api/schema/')return Response.json(schema);
  if(url.pathname==='/api/part/category/7/')return Response.json(category);
  if(url.pathname==='/api/part/42/')return Response.json(parts[0]);
  if(url.pathname==='/api/stock/'){assert.equal(url.searchParams.get('part'),'42');assert.equal(url.searchParams.get('include_variants'),'false');return Response.json(stock)}
  if(url.pathname===(legacy?'/api/part/parameter/':'/api/parameter/')){if(legacy){assert.equal(url.search,'?part=42')}else{assert.equal(url.searchParams.get('model_type'),'part.part');assert.equal(url.searchParams.get('model_id'),'42');}return Response.json(parameters)}
  assert.equal(url.pathname,'/api/part/');
  if(method==='GET'){assert.equal(url.searchParams.get('IPN'),'FIX-001');return Response.json(parts)}
  assert.equal(method,'POST');const body=JSON.parse(i.body);writes.push(body);const {copy_category_parameters,...rest}=body,part={pk:42,...rest};parts.push(part);if(copy_category_parameters!==false)parameters.push({pk:1});if(lost)throw Error('lost');return Response.json(part,{status:201});
 };
 return {runner:NativePartCreateAcceptance.open(base,'fixture',request),parts,stock,parameters,writes,category,info,schema,lose(){lost=true}};
}
function journal(t){const dir=mkdtempSync(join(tmpdir(),'studio-part-fixture-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));return ()=>new LocalNativeReceiptEvidence(dir)}
test('local native Part create explicitly disables category defaults, checks exact acknowledgement, list/detail and zero stock/parameters',async t=>{
 const f=fixture(),e=journal(t),p=await f.runner.prepare('fixture',input),approval=await approve(p);
 assert.equal(p.executionAllowed,false);assert.equal(f.writes.length,0);
 assert.equal((await f.runner.execute(p,approval,e())).status,'verified');
 assert.deepEqual(f.writes,[{IPN:'FIX-001',name:'Fixture resistor',description:'Partial',category:7,units:'pcs',active:true,virtual:false,trackable:false,is_template:false,assembly:false,component:true,copy_category_parameters:false}]);
 assert.equal((await f.runner.observe(p,approval,e())).status,'verified');
 await assert.rejects(f.runner.execute(p,approval,e()));assert.equal(f.writes.length,1);
 f.parameters.push({pk:1});assert.equal((await f.runner.observe(p,approval,e())).status,'blocked');
});
test('non-loopback, stale approval, changed category, existing IPN and unapproved identity block writes',async t=>{
 const f=fixture(),e=journal(t),p=await f.runner.prepare('fixture',input),approval=await approve(p);
 assert.throws(()=>NativePartCreateAcceptance.open('https://production.example.com:8123','fixture'));
 await assert.rejects(f.runner.execute(p,{...approval,newPartConfirmed:false},e()));
 await assert.rejects(f.runner.execute({...p,input:{...p.input,name:'changed'}},approval,e()));
 f.category.structural=true;await assert.rejects(f.runner.execute(p,approval,e()));f.category.structural=false;
 f.parts.push({pk:41,IPN:'FIX-001'});await assert.rejects(f.runner.execute(p,approval,e()));assert.equal(f.writes.length,0);
});
test('lost acknowledgement never inferred from matching IPN, no replay after reopen',async t=>{
 const f=fixture(),e=journal(t),p=await f.runner.prepare('fixture',input),approval=await approve(p);f.lose();
 assert.equal((await f.runner.execute(p,approval,e())).status,'unknown');
 assert.equal((await f.runner.observe(p,approval,e())).status,'unknown');
 await assert.rejects(f.runner.execute(p,approval,e()));assert.equal(f.writes.length,1);
});

test('232 Part create uses legacy parameter scope and explicit minimum_stock, with version-bound approval',async t=>{
 const f=fixture(true),e=journal(t),p=await f.runner.prepare('fixture',input),a=await approve(p);
 assert.equal(p.apiVersion,232);assert.equal(f.writes.length,0);
 f.info.version='1.7.4';f.info.apiVersion=570;f.schema.paths['/api/parameter/']={get:{}};
 await assert.rejects(f.runner.execute(p,a,e()),/API version changed/);assert.equal(f.writes.length,0);
 f.info.version='0.16.7';f.info.apiVersion=232;delete f.schema.paths['/api/parameter/'];
 assert.equal((await f.runner.execute(p,a,e())).status,'verified');
 assert.equal(f.writes[0].minimum_stock,0);assert.equal(f.writes[0].copy_category_parameters,false);
 f.parts[0].minimum_stock=2;assert.equal((await f.runner.observe(p,a,e())).status,'blocked');
});
