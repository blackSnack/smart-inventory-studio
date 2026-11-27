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
