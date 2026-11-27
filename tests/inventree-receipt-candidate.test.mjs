import {test} from 'node:test';
import assert from 'node:assert/strict';
import {InvenTreeReceiptCandidateReader} from '../dist/inventree-receipt-candidate.js';
import {planExistingPartReceipt} from '../dist/receiving-plan.js';
import {IsolatedStockReceiptTransport,bindIsolatedReceiptBaseline} from '../dist/isolated-stock-receipt.js';
import {createJournal,executeNext,reconcile} from '../dist/operation-journal.js';
const paths={'/api/part/{id}/':{get:{}},'/api/stock/location/':{get:{}},'/api/stock/':{get:{},post:{}}};
const input={partId:'42',quantity:5,allocations:[{locationId:'2',quantity:2},{locationId:'3',quantity:3}]};
const config={base:'https://inventory.test/prefix',token:'fixture',fixtureOnly:true,instanceId:'fixture'};
function fixture(){
 const part={pk:42,name:'Part A',IPN:'P42',category:11,active:true,trackable:false,virtual:false};
 const locations=[{pk:1,name:'root',parent:null,structural:true},{pk:2,name:'leaf1',parent:1,structural:false},{pk:3,name:'leaf2',parent:1,structural:false}];
 let stock=[{pk:9,part:42,location:2,quantity:'10.0',batch:'B',serial:null,status:10}];
 const calls=[],writes=[];let lost=false;
 const request=async(u,i)=>{
  const url=new URL(u),method=i.method??'GET',path=url.pathname;calls.push({path,method});assert.equal(url.origin,'https://inventory.test');assert.equal(i.redirect,'error');assert.equal(i.headers.Authorization,'Token fixture');
  if(path==='/prefix/api/schema/')return Response.json({openapi:'3.0.3',paths});
  if(path==='/prefix/api/part/42/')return Response.json(part);
  if(path==='/prefix/api/stock/location/')return Response.json(locations);
  assert.equal(path,'/prefix/api/stock/');
  if(method==='GET'){assert.equal(url.searchParams.get('cascade'),'false');return Response.json(stock.filter(s=>String(s.location)===url.searchParams.get('location')))}
  assert.equal(method,'POST');const body=JSON.parse(i.body);writes.push(body);const created={pk:10+writes.length,...body,batch:null,serial:null,status:10};stock.push(created);if(lost)throw Error('lost acknowledgement');return Response.json([created],{status:201});
 };
 return {part,locations,calls,writes,request,get stock(){return stock},lose(){lost=true},open:()=>InvenTreeReceiptCandidateReader.open(config.base,config.token,request)};
}
test('candidate has exact identity, per-leaf raw baselines and no executable authority',async()=>{
 const f=fixture(),reader=await f.open(),r=await reader.readCandidate('fixture',input);
 assert.equal(r.executionAllowed,false);assert.equal(r.baselineComplete,false);assert.equal(r.part.ipn,'P42');
 assert.deepEqual(r.byLocation['2'],[{id:'9',partId:'42',locationId:'2',quantity:'10',batch:'B',serial:null,status:'10'}]);assert.deepEqual(r.byLocation['3'],[]);
 assert.deepEqual(r.locations.map(l=>l.occupants),[['42'],[]]);assert.equal(r.paths['2'].length,2);
 assert.ok(f.calls.every(c=>c.method==='GET'));assert.equal(r.operations,undefined);assert.equal(r.approvalId,undefined);
 await reader.recheck(r);f.stock[0].quantity='11';await assert.rejects(reader.recheck(r),/candidate changed/);
});
test('invalid selection, wrong identity, structural leaf, zero-quantity other Part, duplicate IDs and missing evidence fail closed',async()=>{
 for(const bad of [{...input,quantity:4},{...input,allocations:[{locationId:'2',quantity:2},{locationId:'2',quantity:3}]},{...input,partId:'../42'}]){
  const f=fixture(),r=await f.open();await assert.rejects(r.readCandidate('fixture',bad));assert.equal(f.calls.length,1);
 }
 for(const change of [f=>f.part.pk=99,f=>f.part.trackable=true,f=>f.locations[1].structural=true,f=>f.stock.push({pk:99,part:55,location:3,quantity:'0',batch:null,serial:null,status:10}),f=>f.stock.push({...f.stock[0],location:3}),f=>delete f.stock[0].batch]){
  const f=fixture();change(f);const r=await f.open();await assert.rejects(r.readCandidate('fixture',input));assert.equal(f.writes.length,0);
 }
});
test('change during two passes rejects candidate',async()=>{
 const f=fixture();let reads=0;const r=await InvenTreeReceiptCandidateReader.open(config.base,config.token,async(u,i)=>{if(new URL(u).pathname.endsWith('/part/42/')&&++reads===2)f.part.IPN='changed';return f.request(u,i)});
 await assert.rejects(r.readCandidate('fixture',input),/baseline changed/);
});
test('explicit fixture approval binds real read candidate to existing journal; confirmed prefix and lost suffix never replay',async()=>{
 const f=fixture(),r=await (await f.open()).readCandidate('fixture',input);
 const plan=bindIsolatedReceiptBaseline(planExistingPartReceipt({planId:'p',instanceId:'fixture',catalogHash:'c',snapshotHash:'s',approvalId:'a',...r.input,identityConfirmed:true,physicalSpaceConfirmed:true},r.locations),r.byLocation);
 let journal=createJournal(plan);
 const store={read:async()=>structuredClone(journal),compareAndSet:async(id,rev,next)=>{if(id!==journal.plan.id||rev!==journal.revision)return false;journal=structuredClone(next);return true}};
 const transport=await IsolatedStockReceiptTransport.open(config,f.request);
 assert.equal((await executeNext(store,transport,'p','fixture')).steps[0].state,'verified');f.lose();
 assert.equal((await executeNext(store,transport,'p','fixture')).steps[1].state,'unknown');
 assert.equal((await reconcile(store,transport,'p','fixture')).steps[1].state,'unknown');
 await assert.rejects(executeNext(store,transport,'p','fixture'));assert.equal(f.writes.length,2);
 assert.deepEqual(f.writes,[{part:42,location:2,quantity:2},{part:42,location:3,quantity:3}]);assert.equal(f.stock[0].batch,'B');
});
