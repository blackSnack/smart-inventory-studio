import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {NativeReceiptAcceptance} from '../dist/native-receipt-acceptance.js';
import {LocalNativeReceiptEvidence} from '../tools/native-receipt-evidence.mjs';
const approval={disposableInstanceConfirmed:true,writeAuthorized:true,visibilityConfirmed:true,exclusiveAccessConfirmed:true,identityConfirmed:true,physicalSpaceConfirmed:true};
const input={partId:'42',quantity:3,allocations:[{locationId:'2',quantity:3}]};
const base='http://127.0.0.1:8123/';
function fixture(){
 const info={server:'InvenTree',version:'1.7.4',apiVersion:570},schema={openapi:'3.0.3',paths:{'/api/part/{id}/':{get:{}},'/api/stock/location/':{get:{}},'/api/stock/':{get:{},post:{}}}};
 const stock=[{pk:9,part:42,location:2,quantity:'10',batch:'B',serial:null,status:10}],writes=[];let lost=false;
 const request=async(u,i)=>{
  const url=new URL(u),method=i.method??'GET';assert.equal(url.origin,'http://127.0.0.1:8123');assert.equal(i.redirect,'error');assert.equal(i.headers.Authorization,'Token fixture');
  if(url.pathname==='/api/')return Response.json(info);
  if(url.pathname==='/api/user/me/')return Response.json({pk:1});
  if(url.pathname==='/api/schema/')return Response.json(schema);
  if(url.pathname==='/api/part/42/')return Response.json({pk:42,name:'Part',IPN:'P42',category:11,active:true,trackable:false,virtual:false});
  if(url.pathname==='/api/stock/location/')return Response.json([{pk:1,name:'root',parent:null,structural:true},{pk:2,name:'leaf',parent:1,structural:false}]);
  assert.equal(url.pathname,'/api/stock/');
  if(method==='GET'){assert.equal(url.searchParams.get('location'),'2');return Response.json(stock)}
  assert.equal(method,'POST');const body=JSON.parse(i.body);writes.push(body);const created={pk:10,...body,batch:null,serial:null,status:10};stock.push(created);if(lost)throw Error('lost');return Response.json([created],{status:201});
 };
 return {runner:NativeReceiptAcceptance.open(base,'fixture',request),stock,writes,info,schema,lose(){lost=true}};
}
function journal(t){const dir=mkdtempSync(join(tmpdir(),'studio-native-fixture-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));return ()=>new LocalNativeReceiptEvidence(dir)}
test('local acceptance requires explicit loopback port and approvals; preparation is read-only',async t=>{
 const f=fixture(),e=journal(t),p=await f.runner.prepare('fixture',input);assert.equal(p.executionAllowed,false);assert.equal(f.writes.length,0);
 for(const url of ['https://production.example.com:8123','http://localhost:8123','http://127.0.0.1','http://127.0.0.1:8123/prefix'])assert.throws(()=>NativeReceiptAcceptance.open(url,'fixture'));
 await assert.rejects(f.runner.execute(p,{...approval,writeAuthorized:false},e()));
 f.info.version='1.7.3';await assert.rejects(f.runner.execute(p,approval,e()));assert.equal(f.writes.length,0);
});
test('native isolated receipt evidence survives reopening and detects changed stock',async t=>{
 const f=fixture(),e=journal(t),p=await f.runner.prepare('fixture',input);
 const r=await f.runner.execute(p,approval,e());assert.equal(r.status,'verified');assert.equal(r.productionWriteAllowed,false);assert.equal(r.serverAuditRequired,true);
 assert.deepEqual(f.writes,[{part:42,location:2,quantity:3}]);assert.equal((await f.runner.observe(p,approval,e())).status,'verified');
 await assert.rejects(f.runner.execute(p,approval,e()));assert.equal(f.writes.length,1);f.stock[0].quantity='11';assert.equal((await f.runner.observe(p,approval,e())).status,'blocked');
});
test('lost acknowledgement remains unknown after reopen; no replay, and stale baseline blocks before write',async t=>{
 const f=fixture(),e=journal(t),p=await f.runner.prepare('fixture',input);f.lose();assert.equal((await f.runner.execute(p,approval,e())).status,'unknown');
 assert.equal((await f.runner.observe(p,approval,e())).status,'unknown');await assert.rejects(f.runner.execute(p,approval,e()));assert.equal(f.writes.length,1);
 const g=fixture(),q=await g.runner.prepare('fixture',input);g.stock[0].quantity='12';await assert.rejects(g.runner.execute(q,approval,e()));assert.equal(g.writes.length,0);
});
test('write-once evidence refuses concurrent same binding and preserves missing acknowledgement',async t=>{
 const open=journal(t),key='a'.repeat(64),a=open(),b=open();assert.equal(await a.claim(key),true);assert.equal(await b.claim(key),false);assert.deepEqual(await b.read(key),{});
 await a.acknowledge(key,'42');assert.deepEqual(await b.read(key),{stockId:'42'});await assert.rejects(b.acknowledge(key,'43'));
});
