import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {BrowserNativeWorkflow,browserPreparationHash} from '../dist/browser-native-workflow.js';
const catalog=JSON.parse(readFileSync(new URL('../catalog/electronic-parts.json',import.meta.url)));
const base='http://127.0.0.1:8123/';
const approval=async p=>({preparationSha256:await browserPreparationHash(p),disposableConfirmed:true,visibilityConfirmed:true,exclusiveConfirmed:true,identityAndPhysicalConfirmed:true,sourceAndMappingConfirmed:true,writeAuthorized:true});
function memory(){
 const rows=new Map(),key=(s,i)=>s+'|'+i;
 return {async admit(r){const k=key(r.preparation.scope,r.preparation.id);if(rows.has(k)||[...rows.values()].some(x=>x.preparation.scope===r.preparation.scope&&['reviewed','sent','unknown'].includes(x.state)))throw Error('pending');rows.set(k,structuredClone(r))},async get(s,i){return structuredClone(rows.get(key(s,i)))},async list(s){return structuredClone([...rows.values()].filter(x=>x.preparation.scope===s))},async claim(s,i,b){const r=rows.get(key(s,i));if(r?.state!=='reviewed')return false;r.state='sent';r.ackBinding=b;return true},async acknowledge(s,i,b,ack){const r=rows.get(key(s,i));if(r.state!=='sent'||r.ackBinding!==b||r.ack!==undefined)throw Error('ack');r.ack=structuredClone(ack)},async finish(s,i,result){const r=rows.get(key(s,i));r.state=result.status;r.result=result},async abandonUnsent(s,i){const r=rows.get(key(s,i));if(r.state!=='reviewed')throw Error('already sent');r.state='blocked'}};
}
function fixture(){
 const stock=[{pk:9,part:42,location:2,quantity:'10',batch:'B',serial:null,status:10}],writes=[];
 const schema={openapi:'3.0.3',paths:{'/api/part/{id}/':{get:{}},'/api/stock/location/':{get:{}},'/api/stock/':{get:{},post:{}}}};
 let actor=1,lost=false;
 const request=async(u,i={})=>{const url=new URL(u),method=i.method??'GET';assert.equal(url.origin,'http://127.0.0.1:8123');assert.equal(new Headers(i.headers).get('Authorization'),'Token fixture');assert.equal(i.redirect,'error');
  if(url.pathname==='/api/')return Response.json({server:'InvenTree',version:'1.7.4',apiVersion:570});
  if(url.pathname==='/api/user/me/')return Response.json({pk:actor});
  if(url.pathname==='/api/schema/')return Response.json(schema);
  if(url.pathname==='/api/part/42/')return Response.json({pk:42,name:'Part',IPN:'P42',category:11,active:true,trackable:false,virtual:false});
  if(url.pathname==='/api/stock/location/')return Response.json([{pk:1,name:'root',parent:null,structural:true},{pk:2,name:'leaf',parent:1,structural:false}]);
  assert.equal(url.pathname,'/api/stock/');if(method==='GET')return Response.json(stock);
  const body=JSON.parse(i.body);writes.push(body);const created={pk:10,...body,batch:null,serial:null,status:10};stock.push(created);if(lost)throw Error('lost');return Response.json([created],{status:201});
 };
 return {request,stock,writes,changeActor(){actor=2},lose(){lost=true}};
}
const input={id:'receipt:1',kind:'receive-existing-part',payload:{partId:'42',locationId:'2',quantity:3}};
test('browser preparation binds actor, schema and exact approval; direct nonloopback write mode rejected',async()=>{
 const f=fixture(),runner=await BrowserNativeWorkflow.open(base,'fixture',catalog,f.request),store=memory(),p=await runner.prepare(input),a=await approval(p);
 assert.equal(p.executionAllowed,false);assert.equal(f.writes.length,0);
 await assert.rejects(BrowserNativeWorkflow.open('https://production.example.com','fixture',catalog,f.request));
 await assert.rejects(runner.execute(p,{...a,writeAuthorized:false},store));
 await assert.rejects(runner.execute({...p,input:{...input,payload:{...input.payload,quantity:9}}},a,store));
 f.changeActor();await assert.rejects(runner.execute(p,a,store));assert.equal(f.writes.length,0);
});
test('native browser receipt writes once, stores exact acknowledgement, blocks repeated operation',async()=>{
 const f=fixture(),runner=await BrowserNativeWorkflow.open(base,'fixture',catalog,f.request),store=memory(),p=await runner.prepare(input),a=await approval(p);
 assert.equal((await runner.execute(p,a,store)).status,'verified');assert.deepEqual(f.writes,[{part:42,location:2,quantity:3}]);
 assert.equal((await store.get(runner.scope,input.id)).state,'verified');await assert.rejects(runner.execute(p,a,store));assert.equal(f.writes.length,1);
});
test('loss remains unknown, reconnect observes without replay and unresolved operation blocks new admission',async()=>{
 const f=fixture(),runner=await BrowserNativeWorkflow.open(base,'fixture',catalog,f.request),store=memory(),p=await runner.prepare(input),a=await approval(p);f.lose();
 assert.equal((await runner.execute(p,a,store)).status,'unknown');
 const reopened=await BrowserNativeWorkflow.open(base,'fixture',catalog,f.request);
 assert.equal((await reopened.recover(input.id,store)).status,'unknown');const next=await reopened.prepare({...input,id:'other'});
 await assert.rejects(reopened.execute(next,await approval(next),store));assert.equal(f.writes.length,1);
});
