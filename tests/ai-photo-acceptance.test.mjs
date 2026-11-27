import {test} from 'node:test';
import assert from 'node:assert/strict';
import {runAIPhotoChallenge} from '../dist/ai-photo-acceptance.js';
import {OpenAICompatibleProvider} from '../dist/ai-provider.js';
const image='data:image/png;base64,AAAA';
const raw={publicPhotoConfirmed:true,categoryKeys:['ic.mcu','resistor.smd'],expected:[{key:'mpn',value:'FIX-123'},{key:'category',value:'ic.mcu'},{key:'parameter:cpu_core',value:'Cortex-M3',sourceUrl:'https://example.test/datasheet'},{key:'supplier',value:null}]};
const draft={name:'MCU',manufacturer:'Maker',mpn:'FIX-123',supplier:null,sku:null,category:'ic.mcu',parameters:{cpu_core:'Cortex-M3'},sourceUrls:['https://example.test/datasheet'],datasheetUrl:null,imageUrl:null,fieldEvidence:{cpu_core:[{url:'https://example.test/datasheet',locator:'page 3'}]}};
const result=d=>({draft:d,requiresReview:true,retrievalVerified:false});
test('photo challenge uses real provider, hides expected values, and reports only candidates',async()=>{
 const provider=new OpenAICompatibleProvider('https://gateway.test/v1','fixture','agent',async(_,init)=>{
  const body=JSON.parse(init.body);
  assert.equal(body.messages[1].content[1].image_url.url,image);
  for(const secret of ['FIX-123','Cortex-M3','example.test'])assert.ok(!init.body.includes(secret));
  return Response.json({choices:[{message:{content:JSON.stringify(draft)}}]});
 });
 const report=await runAIPhotoChallenge(raw,image,provider);
 assert.equal(report.candidateChecksPassed,true);
 assert.equal(report.retrievalVerified,false);
 assert.equal(report.physicalDeviceVerified,false);
 assert.equal(report.manualSourceAndGatewayLogReviewRequired,true);
 assert.ok(report.fields.every(f=>f.status==='candidate-match'));
 assert.ok(!JSON.stringify(report).includes('FIX-123'));
});
test('wrong identity, unsupported value, missing field and invented source fail',async()=>{
 for(const [d,key,status] of [
  [{...draft,mpn:'FIX-124'},'mpn','value-mismatch'],
  [{...draft,supplier:'invented'},'supplier','unexpected-value'],
  [{...draft,parameters:{}},'parameter:cpu_core','missing'],
  [{...draft,fieldEvidence:{}},'parameter:cpu_core','source-mismatch'],
  [{...draft,fieldEvidence:{cpu_core:[{url:'https://other.test/source',locator:'p3'}]}},'parameter:cpu_core','source-mismatch']
 ]){
  const r=await runAIPhotoChallenge(raw,image,{recognize:async()=>result(d)});
  assert.equal(r.candidateChecksPassed,false);
  assert.equal(r.fields.find(f=>f.key===key).status,status);
 }
});
test('invalid fixture and cancellation stop before dispatch; late response cannot pass',async()=>{
 let calls=0;const p={recognize:async()=>{calls++;return result(draft)}};
 for(const x of [{...raw,publicPhotoConfirmed:false},{...raw,categoryKeys:['a','a']},{...raw,expected:[]},{...raw,expected:[raw.expected[0],raw.expected[0]]},{...raw,expected:[{key:'parameter:cpu_core',value:'Cortex-M3'}]},{...raw,expected:[{key:'parameter:cpu_core',value:'x',sourceUrl:'https://u:p@example.test'}]}])await assert.rejects(runAIPhotoChallenge(x,image,p));
 const ac=new AbortController();ac.abort();await assert.rejects(runAIPhotoChallenge(raw,image,p,ac.signal),/cancelled/);
 assert.equal(calls,0);
 const late=new AbortController();
 await assert.rejects(runAIPhotoChallenge(raw,image,{recognize:async()=>{late.abort();return result(draft)}},late.signal),/cancelled/);
});
