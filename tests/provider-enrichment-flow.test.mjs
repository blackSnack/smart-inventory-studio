import {test} from 'node:test';import assert from 'node:assert/strict';
import {InvenTreeCatalogReadAdapter} from '../dist/inventree-catalog-read.js';
import {InvenTreeAssociationReader} from '../dist/inventree-association-read.js';
import {InvenTreeReadAdapter} from '../dist/inventory-provider.js';
import {InventorySession} from '../dist/inventory-contract.js';
import {IsolatedOperationRouter} from '../dist/isolated-operation-router.js';
import {planProviderEnrichment} from '../dist/provider-enrichment-plan.js';
import {createJournal,executeNext,reconcile} from '../dist/operation-journal.js';
const cfg={base:'https://inventory.test',token:'fixture',fixtureOnly:true},header={id:'batch',instanceId:'fixture',catalogHash:'c',snapshotHash:'s',approvalId:'approval'};
const catalog={categories:[{key:'test',parameters:['voltage','power']}],fieldDefinitions:{voltage:{labelZh:'Voltage',labelEn:'Voltage',type:'number',unit:'V'},power:{labelZh:'Power',labelEn:'Power',type:'number',unit:'W'}}};
const template=(pk,name,units)=>({pk,name,units,model_type:'part.part',enabled:true,checkbox:false,choices:'',selectionlist:null});
const mapping={categoryKey:'test',remoteCategoryId:'2',templates:{voltage:'3',power:'4'}};
const schema={openapi:'3.0.3',paths:{'/api/part/{id}/':{get:{}},'/api/part/category/':{get:{}},'/api/part/category/parameters/':{get:{}},'/api/parameter/template/':{get:{}},'/api/parameter/template/{id}/':{get:{}},'/api/parameter/':{get:{},post:{}},'/api/parameter/{id}/':{patch:{}},'/api/company/part/manufacturer/':{get:{}},'/api/company/part/':{get:{}},'/api/attachment/':{get:{},post:{}}}};
function fixture(){
 const categories=[{pk:1,name:'Root',parent:null},{pk:2,name:'Leaf',parent:1}],templates=[template(3,'Voltage','V'),template(4,'Power','W')],relations=[{pk:5,category:2,template:3},{pk:6,category:2,template:4}];
 const parts=[42,43].map(pk=>({pk,name:'Fixture '+pk,IPN:'FIX-'+pk,description:'Public fixture',category:2,active:true})),parameters=[{pk:7,model_type:'part.part',model_id:42,template:3,data:'',note:'keep'},{pk:8,model_type:'part.part',model_id:42,template:4,data:'0.1W',note:'old'},{pk:9,model_type:'part.part',model_id:43,template:4,data:'0.2W',note:'old'}],links=[{pk:20,model_type:'part',model_id:42,link:null,comment:'Private file',attachment:'/media/fixture.pdf'}],writes=[];let lost=false;
 const request=async(u,i)=>{const url=new URL(u),method=i.method??'GET',path=url.pathname,query=url.searchParams;assert.equal(url.origin,'https://inventory.test');assert.equal(i.redirect,'error');assert.equal(i.headers.Authorization,'Token fixture');
  if(method==='GET'){
   if(path==='/api/schema/')return Response.json(schema);if(path==='/api/part/category/')return Response.json(categories);if(path==='/api/part/category/parameters/')return Response.json(relations);
   if(path==='/api/parameter/template/'){assert.equal(query.get('model_type'),'part.part');return Response.json(templates)}
   if(path.startsWith('/api/parameter/template/'))return Response.json(templates.find(t=>path==='/api/parameter/template/'+t.pk+'/'));
   if(path.startsWith('/api/part/')&&/^\/api\/part\/\d+\/$/.test(path))return Response.json(parts.find(p=>path==='/api/part/'+p.pk+'/'));
   if(path==='/api/parameter/'){assert.equal(query.get('model_type'),'part.part');assert.ok(query.get('model_id'));return Response.json(parameters.filter(p=>String(p.model_id)===query.get('model_id')&&(!query.has('template')||String(p.template)===query.get('template'))))}
   if(path==='/api/company/part/manufacturer/'){assert.equal(query.get('manufacturer_detail'),'true');const part=Number(query.get('part'));return Response.json([{pk:part+100,part,manufacturer:1,manufacturer_detail:{pk:1,name:'Fixture Maker'},MPN:'M-'+part}])}
   if(path==='/api/company/part/')return Response.json([]);
   if(path==='/api/attachment/'){assert.equal(query.get('model_type'),'part');assert.ok(query.get('model_id'));return Response.json(links.filter(l=>String(l.model_id)===query.get('model_id')))}
   throw Error('unexpected GET '+path)
  }
  const body=JSON.parse(i.body);writes.push({path,method,body});
  if(method==='PATCH'&&path==='/api/parameter/7/'){assert.deepEqual(body,{data:'25V'});Object.assign(parameters[0],body);return Response.json(parameters[0])}
  if(method==='POST'&&path==='/api/parameter/'){const created={pk:30,...body,note:''};parameters.push(created);if(lost)throw Error('response lost after mutation');return Response.json(created,{status:201})}
  if(method==='POST'&&path==='/api/attachment/'){const created={pk:40+writes.length,...body,attachment:null};links.push(created);return Response.json(created,{status:201})}
  throw Error('unexpected write '+path);
 };return {request,parameters,links,writes,lose:()=>{lost=true}};
}
async function prepare(f){
 const association=await InvenTreeAssociationReader.open(cfg.base,cfg.token,f.request),candidate=await association.readCandidate('fixture',[{templateId:'3',name:'Voltage',unit:'V',type:'number',confirmed:true},{templateId:'4',name:'Power',unit:'W',type:'number',confirmed:true}]);assert.equal(candidate.complete,false);
 const catalogRead=await InvenTreeCatalogReadAdapter.open(cfg.base,cfg.token,f.request),rows=[];
 for(const id of ['42','43']){const p=await catalogRead.readEnrichmentCandidate(id);assert.equal(p.baselineComplete,false);const url='https://example.test/data-'+id,evidence=[{url,locator:'page 3'}];rows.push({...p,mapping,identityConfirmed:true,baselineComplete:true,knownSources:{datasheetUrl:null,imageUrl:null},suggestions:[{key:'voltage',value:'25V',evidence},{key:'power',value:'9W',evidence},{key:'datasheetUrl',value:url,evidence}],accepted:['voltage','datasheetUrl']})}
 const plan=planProviderEnrichment(header,catalog,{...candidate,complete:true},rows),router=await IsolatedOperationRouter.open(cfg,['set-part-parameter','set-part-source'],f.request),read=new InvenTreeReadAdapter(cfg.base,cfg.token,f.request);
 let write=true;const session=new InventorySession({instanceId:'fixture',read,operations:router,capabilities:async()=>({...router.fixtureCapabilities(),write})});
 let j=createJournal(plan);const store={read:async()=>structuredClone(j),compareAndSet:async(id,rev,next)=>{if(id!==j.plan.id||rev!==j.revision)return false;j=structuredClone(next);return true}};
 return {plan,session,store,tx:await session.operationTransport(plan),revoke:()=>{write=false}};
}
test('end-to-end read, reviewed batch plan, routed journal and exact per-record write readback',async()=>{const f=fixture(),p=await prepare(f);assert.deepEqual(p.plan.operations.map(o=>o.kind),['set-part-parameter','set-part-source','set-part-parameter','set-part-source']);assert.equal(f.writes.length,0);
 for(let i=0;i<4;i++)assert.equal((await executeNext(p.store,p.tx,'batch','fixture')).steps[i].state,'verified');
 assert.deepEqual(f.writes.map(w=>[w.method,w.path]),[['PATCH','/api/parameter/7/'],['POST','/api/attachment/'],['POST','/api/parameter/'],['POST','/api/attachment/']]);assert.equal(f.parameters[0].note,'keep');assert.deepEqual(f.parameters.filter(r=>r.template===4).map(r=>r.data),['0.1W','0.2W']);assert.equal(f.links[0].attachment,'/media/fixture.pdf');assert.equal(f.parameters.find(r=>r.model_id===43&&r.template===3).data,'25V');p.revoke();const rx=await p.session.observationTransport(p.plan);assert.equal((await rx.observe(p.plan.operations[3])).status,'verified');await assert.rejects(rx.send(p.plan.operations[3]));assert.equal(f.writes.length,4);
});
test('lost second-row write response preserves verified prefix, stops suffix, and never replays after restart',async()=>{const f=fixture(),p=await prepare(f);await executeNext(p.store,p.tx,'batch','fixture');await executeNext(p.store,p.tx,'batch','fixture');f.lose();const j=await executeNext(p.store,p.tx,'batch','fixture');assert.deepEqual(j.steps.map(s=>s.state),['verified','verified','unknown','planned']);assert.equal(f.parameters.find(r=>r.model_id===43&&r.template===3).data,'25V');assert.equal(f.writes.length,3);assert.equal((await reconcile(p.store,p.tx,'batch','fixture')).steps[2].state,'unknown');const reopened=await IsolatedOperationRouter.open(cfg,['set-part-parameter','set-part-source'],f.request);assert.equal((await reconcile(p.store,reopened,'batch','fixture')).steps[2].state,'unknown');await assert.rejects(executeNext(p.store,reopened,'batch','fixture'));assert.equal(f.writes.length,3);assert.equal(f.links.some(l=>l.model_id===43),false);
});
