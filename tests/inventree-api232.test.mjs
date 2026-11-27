import test from 'node:test';
import assert from 'node:assert/strict';
import {InvenTreeReadAdapter} from '../dist/inventory-provider.js';
import {InvenTreeAssociationReader} from '../dist/inventree-association-read.js';

const template={pk:1,name:'Resistance',units:'Ohm',description:'',parts:1,checkbox:false,choices:''};
const paths=Object.fromEntries(['/api/part/category/','/api/part/category/parameters/','/api/part/parameter/template/','/api/part/parameter/'].map(p=>[p,{get:{}}]));
function request(input,init){
 const u=new URL(input);assert.equal(init.headers.Authorization,'Token synthetic');assert.equal(init.redirect,'error');
 let data;
 switch(u.pathname){
 case '/api/schema/':data={openapi:'3.0.3',paths};break;
 case '/api/part/parameter/template/':assert.equal(u.search,'');data=[template];break;
 case '/api/part/parameter/':assert.equal(u.searchParams.get('template'),'1');assert.equal(u.searchParams.has('model_type'),false);data=[{pk:3,part:9,template:1,data:'100'}];break;
 case '/api/part/category/':data=[{pk:2,name:'Resistors',parent:null}];break;
 case '/api/part/category/parameters/':data=[{pk:4,category:2,parameter_template:1,default_value:''}];break;
 default:throw Error('unexpected endpoint '+u.pathname);
 }
 return Promise.resolve(new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json'}}));
}
test('API 232 parameter search uses part-scoped template and value fields',async()=>{
 const adapter=new InvenTreeReadAdapter('https://fixture.invalid/','synthetic',request);
 assert.deepEqual(await adapter.probe(),[{id:'1',name:'Resistance',unit:'Ohm'}]);
 assert.deepEqual(await adapter.values('1'),[{partId:'9',templateId:'1',value:'100'}]);
});
test('API 232 category bindings use parameter_template and explicit scalar review',async()=>{
 const reader=await InvenTreeAssociationReader.open('https://fixture.invalid/','synthetic',request);
 const s=await reader.readCandidate('fixture',[{templateId:'1',name:'Resistance',unit:'Ohm',type:'number',confirmed:true}]);
 assert.equal(s.templates[0].type,'number');assert.equal(s.templates[0].enabled,true);
 assert.deepEqual(s.relations,[{id:'4',categoryId:'2',templateId:'1'}]);assert.equal(s.complete,false);
});
test('incomplete schema fails closed without probing data endpoints',async()=>{
 const req=async input=>{assert.equal(new URL(input).pathname,'/api/schema/');return new Response(JSON.stringify({openapi:'3.0.3',paths:{'/api/part/parameter/':{get:{}}}}))};
 await assert.rejects(new InvenTreeReadAdapter('https://fixture.invalid/','synthetic',req).probe(),/parameter API not declared/);
});

import {InvenTreeCatalogReadAdapter} from '../dist/inventree-catalog-read.js';
import {InvenTreeMetadataReadAdapter} from '../dist/inventree-metadata-read.js';
test('legacy part detail and category template labels preserve raw values; write baseline stays blocked',async()=>{
 const extra=['/api/part/{id}/','/api/company/part/manufacturer/','/api/company/part/','/api/attachment/'];
 const schema={openapi:'3.0.3',paths:{...paths,...Object.fromEntries(extra.map(p=>[p,{get:{}}]))}};
 const req=async(input,init)=>{
  const u=new URL(input);
  switch(u.pathname){
  case '/api/schema/':return Response.json(schema);
  case '/api/part/9/':return Response.json({pk:9,name:'Fixture',IPN:'R9',description:'',category:2});
  case '/api/part/parameter/':assert.equal(u.search,'?part=9');return Response.json([{pk:3,part:9,template:1,data:'100'}]);
  case '/api/part/category/parameters/':return Response.json([{pk:4,category:2,parameter_template:1,parameter_template_detail:template,default_value:''}]);
  case '/api/company/part/manufacturer/':case '/api/company/part/':case '/api/attachment/':return Response.json([]);
  default:return request(input,init);
  }
 };
 const a=await InvenTreeCatalogReadAdapter.open('https://fixture.invalid/','synthetic',req);
 assert.deepEqual((await a.getPart('9')).parameters,[{templateId:'1',value:'100',template:{name:'Resistance',unit:'Ohm'}}]);
 assert.deepEqual(await a.getParameterTemplates('2'),[{id:'1',name:'Resistance',unit:'Ohm',type:'unknown'}]);
 await assert.rejects(a.getParameterRecords('9'),/write baseline not yet supported/);
});
test('legacy location metadata requires declared location-specific route and known location',async()=>{
 const req=async input=>{
  const u=new URL(input);
  switch(u.pathname){
  case '/api/schema/':return Response.json({openapi:'3.0.3',paths:{'/api/stock/location/':{get:{}},'/api/stock/location/{id}/metadata/':{get:{}}}});
  case '/api/stock/location/':return Response.json([{pk:2,name:'Cabinet',parent:null,structural:true}]);
  case '/api/stock/location/2/metadata/':return Response.json({metadata:{fixture:true}});
  default:throw Error('unexpected endpoint');
  }
 };
 const a=await InvenTreeMetadataReadAdapter.open({base:'https://fixture.invalid/',token:'synthetic',locationModel:'stocklocation'},req);
 assert.deepEqual(await a.getLocationMetadata('2'),{fixture:true});
 await assert.rejects(a.getLocationMetadata('3'),/unknown location/);
});
