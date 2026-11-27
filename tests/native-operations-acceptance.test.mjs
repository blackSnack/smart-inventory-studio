import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {NativeOperationsAcceptance,nativeOperationsPreparationHash} from '../dist/native-operations-acceptance.js';
import {LocalNativeOperationEvidence} from '../tools/native-operation-evidence.mjs';
import {IsolatedStockTransferTransport} from '../dist/isolated-stock-transfer.js';
import {newCabinet} from '../dist/cabinet-layout.js';
import {previewLegacyMigration,planLegacyMigration} from '../dist/legacy-location-migration.js';
const bytes=readFileSync(new URL('../catalog/electronic-parts.json',import.meta.url)),catalog=JSON.parse(bytes),hash=createHash('sha256').update(bytes).digest('hex');
const base='http://127.0.0.1:8123/';
const approval=async p=>({approvedPreparationSha256:await nativeOperationsPreparationHash(p),disposableInstanceConfirmed:true,writeAuthorized:true,visibilityConfirmed:true,exclusiveAccessConfirmed:true,operationReviewed:true,physicalAndReferenceReviewConfirmed:true});
const stock={pk:9,part:42,location:2,quantity:'10.2500',batch:'B1',serial:null,status:10,supplier_part:5,purchase_order:6,sales_order:null,owner:null,customer:null,parent:null,belongs_to:null,consumed_by:null,packaging:'bag',expiry_date:null,allocated:'0',in_stock:true,is_building:false,child_items:0,installed_items:0};
const dest={...stock,pk:10,location:3,quantity:'1.00',batch:'B2'};
const ops={
 category:{id:'category',kind:'create-category',payload:{expectedAbsent:true,name:'MCU',description:'Fixture',parentId:'1',structural:false}},
 template:{id:'template',kind:'create-parameter-template',payload:{expectedAbsent:true,name:'CPU Core',units:'',description:'Fixture',modelType:'part.part',fieldType:'string'}},
 associate:{id:'associate',kind:'associate-category-template',payload:{categoryId:'2',templateId:'3',categoryKey:'resistor.smd',fieldKey:'resistance',reviews:[{templateId:'3',name:'Resistance',unit:'Ω',type:'number',confirmed:true}]}},
 location:{id:'location',kind:'create-location',payload:{expectedAbsent:true,physicalConfirmed:true,parentId:'1',parentName:'Cabinet',name:'C',description:'Fixture drawer',structural:false}},
 whole:{id:'whole',kind:'transfer-stock',payload:{physicalConfirmed:true,sourceId:'2',targetId:'3',stockItemId:'9',partId:'42',quantity:'10.25'}},
 split:{id:'split',kind:'transfer-stock',payload:{physicalConfirmed:true,sourceId:'2',targetId:'3',stockItemId:'9',partId:'42',quantity:'4.125',splitConfirmed:true}}
};
function fixture(){
 const categories=[{pk:1,name:'Root',description:'',parent:null,structural:true},{pk:2,name:'Resistors',description:'',parent:1,structural:false},{pk:5,name:'Other',description:'',parent:1,structural:false}];
 const templates=[{pk:3,name:'Resistance',description:'',units:'Ω',model_type:'part.part',enabled:true,checkbox:false,choices:'',selectionlist:null}];
 const relations=[{pk:4,category:5,template:3,default_value:'12'}];
 const locations=[{pk:1,name:'Cabinet',parent:null,structural:true},{pk:2,name:'A',parent:1,structural:false},{pk:3,name:'B',parent:1,structural:false}];
 const stocks=structuredClone([stock,dest]),writes=[];let metadata={other:4},lost=false,actor=1;
 const schema={openapi:'3.0.3',paths:{'/api/part/category/':{get:{},post:{}},'/api/parameter/template/':{get:{},post:{}},'/api/part/category/parameters/':{get:{},post:{}},'/api/stock/location/':{get:{},post:{}},'/api/stock/location/{id}/':{get:{},patch:{}},'/api/metadata/{model}/{id}/':{get:{},patch:{}},'/api/stock/':{get:{}},'/api/stock/transfer/':{post:{}}}};
 const request=async(u,i={})=>{
  const url=new URL(u),method=i.method??'GET',path=url.pathname;assert.equal(url.origin,'http://127.0.0.1:8123');assert.equal(i.redirect,'error');assert.equal(new Headers(i.headers).get('Authorization'),'Token fixture');
  if(path==='/api/')return Response.json({server:'InvenTree',version:'1.7.4',apiVersion:570});
  if(path==='/api/user/me/')return Response.json({pk:actor});
  if(path==='/api/schema/')return Response.json(schema);
  if(method==='GET'){
   if(path==='/api/part/category/')return Response.json(categories);
   if(path==='/api/parameter/template/')return Response.json(templates);
   if(path==='/api/part/category/parameters/')return Response.json(relations);
   if(path==='/api/stock/location/')return Response.json(locations);
   if(path==='/api/metadata/stocklocation/1/')return Response.json({metadata});
   if(path==='/api/stock/')return Response.json(stocks.filter(r=>String(r.location)===url.searchParams.get('location')));
   if(/^\/api\/stock\/location\/\d+\/$/.test(path))return Response.json(locations.find(r=>r.pk===Number(path.split('/').at(-2))));
   throw Error('unexpected GET '+path);
  }
  const body=JSON.parse(i.body);writes.push({path,method,body});let result;
  if(path==='/api/part/category/'){result={pk:11,...body};categories.push(result)}
  else if(path==='/api/parameter/template/'){result={pk:12,...body};templates.push(result)}
  else if(path==='/api/part/category/parameters/'){result={pk:13,...body};relations.push(result)}
  else if(path==='/api/stock/location/'){result={pk:14,...body};locations.push(result)}
  else if(path==='/api/stock/location/2/'&&method==='PATCH'){locations[1].name=body.name;result=locations[1]}
  else if(path==='/api/metadata/stocklocation/1/'&&method==='PATCH'){metadata=body.metadata;result={metadata}}
  else if(path==='/api/stock/transfer/'){
   assert.equal(body.items[0].merge,false);const item=stocks.find(r=>r.pk===body.items[0].pk);
   if(body.items[0].quantity==='4.125'){stocks.push({...item,pk:15,parent:item.pk,location:body.location,quantity:'4.1250'});item.quantity='6.1250';item.child_items=1}
   else item.location=body.location;
   result=body;
  }else throw Error('unexpected write '+path);
  if(lost)throw Error('lost acknowledgement');
  return Response.json(result,{status:method==='POST'?201:200});
 };
 return {runner:NativeOperationsAcceptance.open(base,'fixture',catalog,hash,request),categories,templates,relations,locations,stocks,writes,get metadata(){return metadata},schema,lose(){lost=true},changeActor(){actor=2}};
}
function journal(t){const dir=mkdtempSync(join(tmpdir(),'studio-native-ops-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));return ()=>new LocalNativeOperationEvidence(dir)}
async function run(f,op,e){
 const p=await f.runner.prepare('fixture',op),a=await approval(p),before=f.writes.length;
 assert.equal(p.executionAllowed,false);assert.equal(f.writes.length,before);
 assert.equal((await f.runner.execute(p,a,e())).status,'verified');
 assert.equal(f.writes.length,before+1);
 assert.equal((await f.runner.observe(p,a,e())).status,'verified');
 await assert.rejects(f.runner.execute(p,a,e()));
 assert.equal(f.writes.length,before+1);
 return {p,a};
}
test('category, scalar template, direct association and storage creation share one guarded native entry',async t=>{
 const f=fixture(),e=journal(t);
 await run(f,ops.category,e);await run(f,ops.template,e);await run(f,ops.associate,e);await run(f,ops.location,e);
 assert.deepEqual(f.writes.map(w=>w.path),['/api/part/category/','/api/parameter/template/','/api/part/category/parameters/','/api/stock/location/']);
 assert.equal(f.relations[0].default_value,'12');assert.deepEqual(f.writes[2].body,{category:2,template:3,default_value:''});
 assert.equal(f.locations.at(-1).external,false);
});
test('legacy rename and metadata preserve stock, references, unrelated namespaces; revisioned update also verified',async t=>{
 const f=fixture(),e=journal(t),layout=newCabinet('cab','cab',{layers:1,rows:1,cols:1},'NEW');
 const input={rootId:'1',layout,bindings:[{compartmentId:layout.cells[0].drawer.compartments[0].id,locationId:'2'}],locations:f.locations.map(x=>({id:String(x.pk),name:x.name,parentId:x.parent===null?null:String(x.parent),structural:x.structural})),metadata:f.metadata};
 const preview=previewLegacyMigration(input),plan=planLegacyMigration({id:'migrate',instanceId:'fixture',catalogHash:hash,snapshotHash:'snapshot',approvalId:'approval',physicalConfirmed:true},input,preview),before=structuredClone(f.stocks);
 await run(f,plan.operations[0],e);await run(f,plan.operations[1],e);
 assert.deepEqual(f.stocks,before);assert.equal(f.metadata.other,4);assert.deepEqual(f.metadata,preview.nextMetadata);
 const next=structuredClone(f.metadata);next.smart_inventory.cabinet.revision++;next.smart_inventory.cabinet.layout.revision++;next.smart_inventory.cabinet.layout.name='Updated cabinet';
 const managed={id:'managed',kind:'update-location-metadata',payload:{...plan.operations[1].payload,expectedMetadata:structuredClone(f.metadata),metadata:next}};
 const {p,a}=await run(f,managed,e);f.stocks[0].supplier_part=99;assert.equal((await f.runner.observe(p,a,e())).status,'blocked');
});
test('whole and partial transfer hydrate native baselines, preserve exact decimal quantities and lineage',async t=>{
 for(const op of [ops.whole,ops.split]){
  const f=fixture(),e=journal(t),{p,a}=await run(f,op,e);
  assert.equal(p.operation.payload.expectedSource.length,1);assert.equal(p.operation.payload.expectedTarget.length,1);
  assert.deepEqual(f.writes[0].body,{items:[{pk:9,quantity:op.payload.quantity,merge:false}],location:3});
  if(op===ops.split){assert.equal(f.stocks[0].quantity,'6.1250');assert.equal(f.stocks[2].parent,9);assert.equal(f.stocks[2].batch,'B1')}
  else assert.equal(f.stocks[0].location,3);
  f.stocks[0].supplier_part=99;assert.equal((await f.runner.observe(p,a,e())).status,'blocked');
 }
});
test('unsafe origins, unsupported operation, changed reads/schema/actor, known conflicts and unapproved transfer stop before write',async t=>{
 const f=fixture(),e=journal(t),p=await f.runner.prepare('fixture',ops.category),a=await approval(p);
 assert.throws(()=>NativeOperationsAcceptance.open('https://production.example.com:8123','fixture',catalog,hash));
 await assert.rejects(f.runner.prepare('fixture',{id:'x',kind:'delete-location',payload:{}}));
 await assert.rejects(f.runner.execute(p,{...a,writeAuthorized:false},e()));
 await assert.rejects(f.runner.execute({...p,wire:{...p.wire,body:{name:'different'}}},a,e()));
 f.categories[0].description='changed';await assert.rejects(f.runner.execute(p,a,e()));f.categories[0].description='';
 f.changeActor();await assert.rejects(f.runner.execute(p,a,e()));
 f.categories.push({pk:99,name:'mcu',description:'',parent:1,structural:false});await assert.rejects(f.runner.prepare('fixture',ops.category));
 await assert.rejects(f.runner.prepare('fixture',{...ops.split,payload:{...ops.split.payload,splitConfirmed:false}}));
 await assert.rejects(f.runner.prepare('fixture',{...ops.whole,payload:{...ops.whole.payload,quantity:'11'}}));
 assert.equal(f.writes.length,0);
 await assert.rejects(IsolatedStockTransferTransport.open({base,token:'fixture',fixtureOnly:true},async()=>{throw Error('must not fetch')}));
 await assert.rejects(IsolatedStockTransferTransport.openLocalAcceptance({base,token:'fixture',instanceId:'fixture',request:async()=>{throw Error('must not fetch')}},{}));
});
test('lost response on every remaining write is unknown after reopening; no replay',async t=>{
 for(const op of [ops.category,ops.template,ops.associate,ops.location,ops.whole,ops.split]){
  const f=fixture(),e=journal(t),p=await f.runner.prepare('fixture',op),a=await approval(p);f.lose();
  assert.equal((await f.runner.execute(p,a,e())).status,'unknown');
  assert.equal((await f.runner.observe(p,a,e())).status,'unknown');
  await assert.rejects(f.runner.execute(p,a,e()));assert.equal(f.writes.length,1);
 }
 const f=fixture(),e=journal(t),rename={id:'rename-loss',kind:'rename-location',payload:{locationId:'2',expectedParentId:'1',expectedName:'A',name:'A2'}};
 const p=await f.runner.prepare('fixture',rename),a=await approval(p);f.lose();
 assert.equal((await f.runner.execute(p,a,e())).status,'unknown');assert.equal((await f.runner.observe(p,a,e())).status,'unknown');
 assert.equal(f.writes.length,1);
});
test('stable operation ID reservation cannot be replaced by a fresh hash',async t=>{
 const e=journal(t),key='a'.repeat(64),a='b'.repeat(64),b='c'.repeat(64);
 assert.equal(await e().claim(key,a),true);assert.equal(await e().claim(key,b),false);
 await assert.rejects(e().record(key,b,{}));await assert.rejects(e().read(key,b));
 await e().record(key,a,{id:'42'});assert.deepEqual(await e().read(key,a),{ack:{id:'42'}});
});
