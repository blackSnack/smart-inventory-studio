import {test} from 'node:test';import assert from 'node:assert/strict';
import {InvenTreeMetadataReadAdapter} from '../dist/inventree-metadata-read.js';
import {InvenTreeReadAdapter} from '../dist/inventory-provider.js';
import {InventorySession} from '../dist/inventory-contract.js';
import {newCabinet} from '../dist/cabinet-layout.js';
const layout=newCabinet('cab','Fixture',{layers:1,rows:1,cols:1},'A');
const cabinet={schemaVersion:1,revision:0,layout,leafBindings:[{compartmentId:layout.cells[0].drawer.compartments[0].id,locationId:'2'}]};
const metadata={other:{preserve:true},smart_inventory:{cabinet}};
const schema={openapi:'3.0.3',paths:{'/api/stock/location/':{get:{}},'/api/metadata/{model}/{id}/':{get:{}}}};
const rows=[{pk:1,name:'Root',parent:null,structural:true},{pk:2,name:'Leaf',parent:1,structural:false}];
const config={base:'https://inventory.test/prefix',token:'fixture',locationModel:'stocklocation'};
function fixture({apiSchema=schema,locations=rows,body={metadata},status=200}={}){
 const calls=[];const request=async(u,i)=>{const url=new URL(u);calls.push(url.pathname);assert.equal(url.origin,'https://inventory.test');assert.equal(i.method??'GET','GET');assert.equal(i.headers.Authorization,'Token fixture');assert.equal(i.redirect,'error');assert.ok(i.signal);
 if(url.pathname==='/prefix/api/schema/')return Response.json(apiSchema);
 if(url.pathname==='/prefix/api/stock/location/')return Response.json(locations);
 if(url.pathname==='/prefix/api/metadata/stocklocation/1/'||url.pathname==='/prefix/api/metadata/stocklocation/2/')return Response.json(body,{status});
 throw Error('unexpected metadata endpoint')};return {calls,request,open:()=>InvenTreeMetadataReadAdapter.open(config,request)}
}
test('GET-only metadata port retains unrelated keys, validates layout against fresh location tree and permits no writes',async()=>{const f=fixture(),m=await f.open(),read=new InvenTreeReadAdapter(config.base,config.token,f.request);const s=new InventorySession({instanceId:'fixture',read,metadata:m,capabilities:async()=>({read:true,write:false,metadata:true,parameterTemplates:false,stockTransfer:false})});assert.deepEqual(await s.getLocationMetadata('1'),metadata);assert.deepEqual(await m.getCabinet('1'),cabinet);assert.equal((await s.getCapabilities()).write,false);assert.deepEqual(f.calls,['/prefix/api/schema/','/prefix/api/stock/location/','/prefix/api/metadata/stocklocation/1/','/prefix/api/stock/location/','/prefix/api/metadata/stocklocation/1/'])});
test('schema and exact location scope required; invalid IDs and unverified model never request metadata',async()=>{const f=fixture({apiSchema:{openapi:'3.0.3',paths:{}}});await assert.rejects(f.open(),/not declared/);const g=fixture(),m=await g.open();await assert.rejects(m.getLocationMetadata('../1'),/invalid location ID/);await assert.rejects(m.getLocationMetadata('99'),/unknown location ID/);await assert.rejects(m.getCabinet('2'),/structural/);assert.ok(g.calls.every(p=>!p.includes('/metadata/')));await assert.rejects(InvenTreeMetadataReadAdapter.open({...config,locationModel:'../part'},g.request),/explicit/);assert.equal(f.calls.length,1)});
test('empty unmanaged metadata is distinct from denied, malformed and stale cabinet data',async()=>{assert.equal(await (await fixture({body:{metadata:{}}}).open()).getCabinet('1'),null);for(const opts of [{status:403},{body:{}},{body:{metadata:null}},{body:{metadata:[]}},{locations:[rows[0]]},{body:{metadata:{smart_inventory:{cabinet:{...cabinet,revision:2}}}}}])await assert.rejects((await fixture(opts).open()).getCabinet('1'))});
