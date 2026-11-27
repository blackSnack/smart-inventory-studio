import test from 'node:test';
import assert from 'node:assert/strict';
import {auditApi232} from '../scripts/audit-inventree-api232.mjs';
const spec=(key,method,path,fields,query={})=>({key,method,path,fields:Object.fromEntries(fields.map(k=>[k,'declared'])),query});
const body=schema=>({content:{'application/json':{schema}}});
const ref=name=>({$ref:'#/components/schemas/'+name});
const schema={openapi:'3.0.3',info:{version:'232'},paths:{
 '/api/part/parameter/':{get:{parameters:[{in:'query',name:'part'}],responses:{200:body(ref('Page'))}},post:{requestBody:body(ref('Param'))}},
 '/api/stock/transfer/':{post:{requestBody:body(ref('Transfer'))}},
 '/api/stock/location/{id}/metadata/':{patch:{requestBody:body({type:'object',properties:{metadata:{}}})}}
},components:{schemas:{
 Page:{type:'object',properties:{results:{type:'array',items:ref('Param')}}},
 Param:{type:'object',properties:{pk:{type:'integer',readOnly:true},part:{type:'integer'},data:{type:'string'}},required:['pk','part','data']},
 Transfer:{type:'object',properties:{items:{type:'array',items:ref('Move')},location:{type:'integer'}},required:['items','location']},
 Move:{type:'object',properties:{pk:{type:'integer'},quantity:{type:'string',format:'decimal'}}}
}}};
test('API 232 offline schema resolves paginated rows and nested transfer fields; flags absent merge',()=>{
 const report=auditApi232(schema,[spec('parameters','GET','/api/part/parameter/',['pk','part','data'],{part:'declared'}),spec('stock-transfer','POST','/api/stock/transfer/',['items','items[].pk','items[].quantity','items[].merge','location'])]);
 assert.equal(report.declared,2);assert.equal(report.withGaps,1);
 assert.equal(report.checks[0].fields.pk.status,'declared');
 assert.equal(report.checks[1].fields['items[].quantity'].format,'decimal');
 assert.equal(report.checks[1].fields['items[].merge'].status,'missing');
 assert.equal(report.writeEnabled,false);assert.equal(report.runtimeVerified,false);
});
test('metadata unconstrained JSON is a declared field, not proof of shape; required fields exclude read-only',()=>{
 const report=auditApi232(schema,[spec('metadata-update','PATCH','/api/stock/location/{id}/metadata/',['metadata']),spec('parameter-create','POST','/api/part/parameter/',['part'])]);
 assert.equal(report.checks[0].fields.metadata.status,'declared');assert.equal(report.checks[0].fields.metadata.type,null);
 assert.deepEqual(report.checks[1].extraRequired,['data']);
});
test('wrong API version, missing endpoint, absent filters and write-only/read-only misuse are not passes',()=>{
 assert.throws(()=>auditApi232({...schema,info:{version:'570'}}),/232/);
 const r=auditApi232(schema,[spec('parameters','GET','/api/part/parameter/',['pk'],{model_type:'declared'}),spec('bad','POST','/api/part/parameter/',['pk','part','data']),spec('missing','GET','/api/parameter/',['pk'])]);
 assert.equal(r.withGaps,3);assert.equal(r.checks[1].fields.pk.status,'wrong-access');assert.equal(r.checks[2].declared,false);
});
