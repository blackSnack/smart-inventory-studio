import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {NativeEnrichmentAcceptance,nativeEnrichmentPreparationHash} from '../dist/native-enrichment-acceptance.js';
import {LocalNativeReceiptEvidence} from '../tools/native-receipt-evidence.mjs';
const source={kind:'source',partId:'42',ipn:'FIX-001',url:'https://example.test/datasheet',comment:'Reviewed datasheet'};
const param={kind:'parameter',partId:'42',ipn:'FIX-001',templateId:'5',templateName:'Resistance',units:'Ω',value:'10kΩ',evidence:[{url:'https://example.test/spec',locator:'table'}]};
const approve=async p=>({approvedPreparationSha256:await nativeEnrichmentPreparationHash(p),disposableInstanceConfirmed:true,writeAuthorized:true,visibilityConfirmed:true,exclusiveAccessConfirmed:true,identityConfirmed:true,sourceReviewed:true,fieldMappingConfirmed:true});
const existing={pk:9,model_type:'part.part',model_id:42,template:5,data:'',note:'keep'};
function fixture(initial=[]){
 const base='http://127.0.0.1:8123/',part={pk:42,IPN:'FIX-001',active:true},template={pk:5,model_type:'part.part',name:'Resistance',units:'Ω',enabled:true,checkbox:false,choices:'',selectionlist:null};
 const schema={openapi:'3.0.3',paths:{'/api/part/{id}/':{get:{}},'/api/attachment/':{get:{},post:{}},'/api/parameter/template/{id}/':{get:{}},'/api/parameter/':{get:{},post:{}},'/api/parameter/{id}/':{patch:{}}}};
 const attachments=[{pk:1,model_type:'part',model_id:42,link:null,comment:'Private file',attachment:'/media/private.pdf'}],values=structuredClone(initial),writes=[];let lost=false;
 const request=async(u,i)=>{
  const url=new URL(u),method=i.method??'GET',path=url.pathname;assert.equal(url.origin,'http://127.0.0.1:8123');assert.equal(i.redirect,'error');assert.equal(i.headers.Authorization,'Token fixture');
  if(path==='/api/')return Response.json({server:'InvenTree',version:'1.7.4',apiVersion:570});
  if(path==='/api/user/me/')return Response.json({pk:1});
  if(path==='/api/schema/')return Response.json(schema);
  if(path==='/api/part/42/')return Response.json(part);
  if(path==='/api/parameter/template/5/')return Response.json(template);
  if(method==='GET'){
   assert.equal(url.searchParams.get('model_id'),'42');
   if(path==='/api/attachment/'){assert.equal(url.searchParams.get('model_type'),'part');return Response.json(attachments)}
   assert.equal(path,'/api/parameter/');assert.equal(url.searchParams.get('model_type'),'part.part');assert.equal(url.searchParams.get('template'),'5');return Response.json(values);
  }
  const body=JSON.parse(i.body);writes.push([path,method,body]);let created;
  if(path==='/api/attachment/'){assert.equal(method,'POST');created={pk:2,...body,attachment:null};attachments.push(created)}
  else if(method==='POST'){assert.equal(path,'/api/parameter/');created={pk:9,...body,note:''};values.push(created)}
  else{assert.equal(method,'PATCH');assert.equal(path,'/api/parameter/9/');values[0]={...values[0],...body};created=values[0]}
  if(lost)throw Error('lost');return Response.json(created,{status:method==='POST'?201:200});
 };
 return {runner:NativeEnrichmentAcceptance.open(base,'fixture',request),part,template,attachments,values,writes,lose(){lost=true}};
}
function journal(t){const dir=mkdtempSync(join(tmpdir(),'studio-enrichment-fixture-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));return ()=>new LocalNativeReceiptEvidence(dir)}
test('native link adds only a reviewed HTTPS link; previous attachment and note preserved',async t=>{
 const f=fixture(),e=journal(t),p=await f.runner.prepare('fixture',source),a=await approve(p);
 assert.equal(f.writes.length,0);assert.equal(p.executionAllowed,false);
 assert.equal((await f.runner.execute(p,a,e())).status,'verified');assert.deepEqual(f.writes,[['/api/attachment/','POST',{model_type:'part',model_id:42,link:source.url,comment:source.comment}]]);
 assert.equal((await f.runner.observe(p,a,e())).status,'verified');assert.equal(f.attachments[0].attachment,'/media/private.pdf');
 await assert.rejects(f.runner.execute(p,a,e()));f.attachments[0].comment='changed';assert.equal((await f.runner.observe(p,a,e())).status,'blocked');
});
test('native parameter POST and empty PATCH preserve exact ID/note and never overwrite known values',async t=>{
 for(const initial of [[],[existing]]){
  const f=fixture(initial),e=journal(t),p=await f.runner.prepare('fixture',param),a=await approve(p);
  assert.equal((await f.runner.execute(p,a,e())).status,'verified');assert.deepEqual(f.writes,[initial.length?['/api/parameter/9/','PATCH',{data:'10kΩ'}]:['/api/parameter/','POST',{model_type:'part.part',model_id:42,template:5,data:'10kΩ'}]]);
  assert.equal(f.values[0].note,initial.length?'keep':'');assert.equal((await f.runner.observe(p,a,e())).status,'verified');await assert.rejects(f.runner.prepare('fixture',param));
 }
});
test('missing evidence, invalid URL, existing link, stale baseline, identity drift and approval mismatch stop before write',async t=>{
 const f=fixture(),e=journal(t),p=await f.runner.prepare('fixture',param),a=await approve(p);
 for(const input of [{...param,evidence:[]},{...source,url:'https://user:secret@example.test'},{...source,url:'http://example.test'}])await assert.rejects(f.runner.prepare('fixture',input));
 await assert.rejects(f.runner.execute(p,{...a,sourceReviewed:false},e()));await assert.rejects(f.runner.execute({...p,input:{...p.input,value:'other'}},a,e()));
 f.template.units='V';await assert.rejects(f.runner.execute(p,a,e()));f.template.units='Ω';
 f.values.push({...existing,data:'known'});await assert.rejects(f.runner.execute(p,a,e()));f.values.pop();
 f.part.IPN='other';await assert.rejects(f.runner.prepare('fixture',source));f.part.IPN='FIX-001';
 f.attachments.push({pk:2,model_type:'part',model_id:42,link:source.url,comment:'old',attachment:null});await assert.rejects(f.runner.prepare('fixture',source));assert.equal(f.writes.length,0);
});
test('response loss on either native operation remains unknown after reopen and is never replayed',async t=>{
 for(const input of [source,param]){
  const f=fixture(),e=journal(t),p=await f.runner.prepare('fixture',input),a=await approve(p);f.lose();
  assert.equal((await f.runner.execute(p,a,e())).status,'unknown');assert.equal((await f.runner.observe(p,a,e())).status,'unknown');await assert.rejects(f.runner.execute(p,a,e()));assert.equal(f.writes.length,1);
 }
});
