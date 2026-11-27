import {test} from 'node:test';import assert from 'node:assert/strict';
import {contractReads,contractWrites,inspectInvenTreeContract,collectInvenTreeEvidence} from '../dist/inventree-contract-evidence.js';
const obj=properties=>({type:'object',properties});
const json=schema=>({content:{'application/json':{schema}}});
function fixtureSchema(){
 const paths={},components={schemas:{TransferItem:obj({pk:{type:'integer'},quantity:{type:'string'},merge:{type:'boolean'}})}};
 for(const r of contractReads){const shape=obj(Object.fromEntries(r.fields.map(k=>[k,{type:'string'}]))),result=r.list?obj({count:{type:'integer'},next:{type:'string'},results:{type:'array',items:shape}}):shape;
 paths[r.path]={...paths[r.path],get:{parameters:(r.filters??[]).map(name=>({name,in:'query'})),responses:{200:json(result)}}}}
 for(const w of contractWrites){const props=Object.fromEntries(w.fields.filter(k=>!k.includes('[]')).map(k=>[k,{type:'string'}]));if(w.key==='stock-transfer')props.items={type:'array',items:{$ref:'#/components/schemas/TransferItem'}};paths[w.path]={...paths[w.path],[w.method.toLowerCase()]:{requestBody:json(obj(props))}}}
 return {openapi:'3.0.3',paths,components};
}
test('matrix detects exact method, missing/readonly fields, nested transfer properties, unknown refs, and extra required values',()=>{const s=fixtureSchema();let x=inspectInvenTreeContract(s);assert.ok(x.reads.every(r=>r.declared&&Object.values(r.responseFields).every(f=>f==='declared')));assert.ok(x.writes.every(w=>w.declared&&!w.writeVerified&&Object.values(w.requestFields).every(f=>f==='declared')));
 delete s.paths['/api/stock/'].get.parameters[0];s.paths['/api/stock/'].get.parameters=s.paths['/api/stock/'].get.parameters.filter(Boolean);s.components.schemas.TransferItem.properties.merge.readOnly=true;
 delete s.paths['/api/part/'].post.requestBody.content['application/json'].schema.properties.IPN;
 s.paths['/api/part/'].post.requestBody.content['application/json'].schema.required=['new_required'];
 s.paths['/api/parameter/'].post.requestBody={$ref:'https://external.test/schema'};
 delete s.paths['/api/metadata/{model}/{id}/'].patch;
 x=inspectInvenTreeContract(s);assert.equal(x.reads.find(r=>r.key==='stock-list').queryFilters.part,'missing');assert.equal(x.writes.find(w=>w.key==='stock-transfer').requestFields['items[].merge'],'wrong-access');assert.equal(x.writes.find(w=>w.key==='part-create').requestFields.IPN,'missing');assert.equal(x.writes.find(w=>w.key==='part-create').extraRequiredFields,1);assert.equal(x.writes.find(w=>w.key==='parameter-create').requestFields.data,'unknown');assert.equal(x.writes.find(w=>w.key==='metadata-update').declared,false);assert.throws(()=>inspectInvenTreeContract({paths:{}}))});
const cfg={base:'https://inventory.test/prefix',token:'secret-fixture',samples:{part:'42',location:'9',category:'2',template:'3',parameter:'4'}};
function fixture({deny=false,unsafe=false,wrongVersion=false,duplicate=false,missing=false,invalid=false}={}){
 const calls=[],schema=fixtureSchema();
 const request=async(u,i)=>{const a=new URL(u),path=a.pathname.replace('/prefix','');calls.push([i.method,a.href]);assert.equal(a.origin,'https://inventory.test');assert.ok(a.pathname.startsWith('/prefix/api/'));assert.equal(i.headers.Authorization,'Token secret-fixture');assert.equal(i.redirect,'error');assert.equal(i.body,undefined);
 if(path==='/api/')return Response.json({server:'InvenTree',version:wrongVersion?'1.7.3':'1.7.4',apiVersion:570,id:'private-instance',instance:'secret label'});
 if(path==='/api/user/me/')return deny?Response.json({detail:'secret response'},{status:403}):Response.json({pk:88,username:'private user'});
 if(path==='/api/schema/')return Response.json(schema);
 if(i.method==='OPTIONS'){const w=contractWrites.find(w=>w.path===path||w.path.replace('{model}','stocklocation').replace('{id}',path.split('/').filter(Boolean).at(-1))===path);const fields=Object.fromEntries((w?.fields??[]).map(k=>[k,{read_only:false,default:'private default'}]));return Response.json({actions:{POST:fields,PUT:fields},name:'private label'},{headers:{Allow:'GET, POST, PUT, PATCH, OPTIONS'}})}
 assert.equal(i.method,'GET');const r=contractReads.find(r=>r.path===path||r.path.replace('{model}','stocklocation').replace('{id}',path.split('/').filter(Boolean).at(-1))===path);assert.ok(r,path);
 const v=Object.fromEntries(r.fields.map(k=>[k,'private row']));v.pk=Number(path.split('/').filter(Boolean).at(-1))||1;
 for(const k of ['active','virtual','trackable','is_template','assembly','component','enabled','checkbox','structural','external','exclude_from_stock','in_stock','is_building'])if(Object.hasOwn(v,k))v[k]=false;
 for(const k of ['part','template','model_id','status','manufacturer','supplier'])if(Object.hasOwn(v,k))v[k]=1;
 for(const k of ['parent','location','category','selectionlist','supplier_part','purchase_order','sales_order','owner','customer','belongs_to','consumed_by'])if(Object.hasOwn(v,k))v[k]=null;
 for(const k of ['quantity','allocated','child_items','installed_items'])if(Object.hasOwn(v,k))v[k]='0';
 for(const k of ['manufacturer','supplier','template'])if(Object.hasOwn(v,k+'_detail'))v[k+'_detail']={pk:v[k],name:'private row'};
 if(r.key==='location-metadata')v.metadata={private:'private row'};
 if(invalid&&r.key==='stock-list')v.quantity=0.1;
 if(a.searchParams.has('model_type'))v.model_type=a.searchParams.get('model_type');if(r.key==='template-list')v.model_type=null;if(a.searchParams.has('part'))v.part=42;if(a.searchParams.has('model_id'))v.model_id=42;
 if(r.key==='part-list'){if(a.searchParams.has('offset'))return Response.json({count:2,next:null,results:[{...v,pk:duplicate?1:2}]});return Response.json({count:2,next:unsafe?'https://evil.test/api/part/?limit=1&offset=1':'?limit=1&offset=1',results:[v]})}
 if(missing&&r.key==='location-list')delete v.structural;
 return Response.json(r.list?[v]:v);
 };return {request,calls};
}
test('explicit prefix, auth, schema hash, two-page scope, OPTIONS action hints, no writes or secret output',async()=>{const f=fixture(),r=await collectInvenTreeEvidence(cfg,f.request);assert.equal(r.version,'target-match');assert.equal(r.authenticatedRead,true);assert.match(r.schema.sha256,/^[a-f0-9]{64}$/);assert.equal(r.reads['part-list'].paging,'two-pages-sampled');assert.equal(r.reads['location-metadata'].status,'sample-shape-compatible');assert.equal(r.options['part-create'].actionAdvertised,true);assert.equal(r.options['location-rename'].patchUsesPutHint,true);assert.equal(r.actualWriteVerified,false);assert.equal(r.writeEnabled,false);assert.ok(f.calls.every(([m])=>['GET','OPTIONS'].includes(m)));for(const k of ['secret-fixture','private-instance','private user','private row','private default','inventory.test','/42/'])assert.ok(!JSON.stringify(r).includes(k),k)});
test('unsafe pagination, duplicate rows, missing fields, denied auth, version mismatch and absent sample ID remain unverified',async()=>{for(const opts of [{unsafe:true},{duplicate:true},{missing:true},{wrongVersion:true},{invalid:true}]){const f=fixture(opts),r=await collectInvenTreeEvidence(cfg,f.request);if(opts.unsafe)assert.equal(r.reads['part-list'].status,'unsafe-next');if(opts.duplicate)assert.equal(r.reads['part-list'].status,'invalid-second-page');if(opts.missing)assert.equal(r.reads['location-list'].status,'fields-missing');if(opts.invalid){assert.equal(r.reads['stock-list'].status,'wire-shape-mismatch');assert.deepEqual(r.reads['stock-list'].invalidFields,['quantity'])}if(opts.wrongVersion)assert.equal(r.version,'unverified-or-mismatch');assert.ok(f.calls.every(([,u])=>!u.includes('evil.test')));assert.equal(r.writeEnabled,false)}const denied=fixture({deny:true}),a=await collectInvenTreeEvidence(cfg,denied.request);assert.equal(a.authenticatedRead,false);assert.equal(Object.keys(a.reads).length,0);assert.equal(denied.calls.length,3);const f=fixture(),r=await collectInvenTreeEvidence({...cfg,samples:{}},f.request);assert.equal(r.reads['part-detail'].status,'sample-id-required');assert.equal(r.options['parameter-update'].status,'sample-id-required');await assert.rejects(collectInvenTreeEvidence({...cfg,samples:{part:'../user'}},f.request));await assert.rejects(collectInvenTreeEvidence({...cfg,base:'https://user:pass@inventory.test'},f.request))});
