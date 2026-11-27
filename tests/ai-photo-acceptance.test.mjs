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

test('explicit legible scenario requires identity pair and exact field locator',async()=>{
 const strict={...raw,scenario:'legible',expected:[...raw.expected.map(e=>e.key==='parameter:cpu_core'?{...e,locator:'page 3'}:e),{key:'manufacturer',value:'Maker'}]};
 assert.equal((await runAIPhotoChallenge(strict,image,{recognize:async()=>result(draft)})).candidateChecksPassed,true);
 const wrong={...draft,fieldEvidence:{cpu_core:[{url:'https://example.test/datasheet',locator:'wrong'}]}};
 const failed=await runAIPhotoChallenge(strict,image,{recognize:async()=>result(wrong)});assert.equal(failed.candidateChecksPassed,false);assert.equal(failed.fields.find(f=>f.key==='parameter:cpu_core').status,'source-mismatch');
 let calls=0;const p={recognize:async()=>{calls++;return result(draft)}};await assert.rejects(runAIPhotoChallenge({...raw,scenario:'legible'},image,p));await assert.rejects(runAIPhotoChallenge({...strict,expected:strict.expected.filter(e=>e.key!=='manufacturer')},image,p));assert.equal(calls,0);
});
test('unreadable photo cannot pass with invented parameters, sources or identity',async()=>{
 const fixture={publicPhotoConfirmed:true,scenario:'unreadable',categoryKeys:['ic.mcu','resistor.smd'],expected:['manufacturer','mpn','supplier','sku','datasheetUrl','imageUrl'].map(key=>({key,value:null}))};
 const unknown={name:null,manufacturer:null,mpn:null,supplier:null,sku:null,category:null,parameters:{cpu_core:null},sourceUrls:[],datasheetUrl:null,imageUrl:null};
 assert.equal((await runAIPhotoChallenge(fixture,image,{recognize:async()=>result(unknown)})).candidateChecksPassed,true);
 for(const d of [{...unknown,mpn:'guessed'},{...unknown,parameters:{cpu_core:'guessed'}},{...unknown,sourceUrls:['https://example.test/guess']}])assert.equal((await runAIPhotoChallenge(fixture,image,{recognize:async()=>result(d)})).candidateChecksPassed,false);
 let calls=0;await assert.rejects(runAIPhotoChallenge({...fixture,expected:fixture.expected.slice(0,5)},image,{recognize:async()=>{calls++;return result(unknown)}}));assert.equal(calls,0);
});
