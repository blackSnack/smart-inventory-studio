import {assertAIActive} from './ai-http.js';
import type {EnrichmentProvider,EnrichmentRequest} from './ai-enrichment-provider.js';
import {reviewEnrichment} from './enrichment-review.js';
const obj=(x:unknown):Record<string,unknown>=>{if(!x||typeof x!=='object'||Array.isArray(x))throw Error('invalid challenge');return x as Record<string,unknown>};
const nonblank=(x:unknown,max:number):string=>{if(typeof x!=='string'||!x.trim()||x.length>max)throw Error('invalid challenge text');return x};
function sourceURL(x:unknown){const u=new URL(nonblank(x,4000));if(u.protocol!=='https:'||u.username||u.password)throw Error('invalid expected source');return u.href}
function challenge(raw:unknown){
 const r=obj(raw);if(r.publicComponentConfirmed!==true)throw Error('public component confirmation required');
 const name=nonblank(r.name,200),category=nonblank(r.category,128),manufacturer=nonblank(r.manufacturer,200),mpn=nonblank(r.mpn,200);
 if(!Array.isArray(r.expected)||!r.expected.length||r.expected.length>30)throw Error('expected field challenge required');
 const expected=r.expected.map(x=>{const e=obj(x),key=nonblank(e.key,128);if(!/^[a-z][a-z0-9_]*$/.test(key)&&key!=='datasheetUrl'&&key!=='imageUrl')throw Error('invalid challenge key');return {key,value:nonblank(e.value,4000),sourceUrl:sourceURL(e.sourceUrl)}});
 if(new Set(expected.map(x=>x.key)).size!==expected.length)throw Error('duplicate expected field');
 const allowedKeys=expected.map(x=>x.key);
 const input:EnrichmentRequest={partId:'public-acceptance-fixture',name,category,manufacturer,mpn,known:Object.fromEntries(allowedKeys.map(k=>[k,null])),allowedKeys};
 return {input,expected};
}
// Expected values and source URLs remain local. The provider receives only a public component identity and requested keys.
export async function runAIEnrichmentChallenge(raw:unknown,provider:EnrichmentProvider,signal?:AbortSignal){
 assertAIActive(signal);const {input,expected}=challenge(raw),result=await provider.enrich(input,signal);
 if(signal?.aborted)throw Error('challenge cancelled');
 const reviewed=reviewEnrichment(input.known,input.allowedKeys,result.suggestions);
 const fields=expected.map(e=>{
  const f=reviewed.find(r=>r.key===e.key);
  const status=!f||f.status==='unknown'?'missing':f.status!=='missing'?'unsupported':f.value!==e.value?'value-mismatch':!f.evidence.some(x=>sourceURL(x.url)===e.sourceUrl)?'source-mismatch':'candidate-match';
  return {key:e.key,status};
 });
 const unexpected=reviewed.filter(f=>!input.allowedKeys.includes(f.key)).length;
 return {fields,unexpectedFields:unexpected,candidateChecksPassed:unexpected===0&&fields.every(f=>f.status==='candidate-match'),retrievalVerified:false as const,manualSourceAndGatewayLogReviewRequired:true as const};
}

// The operator publishes a fresh unpredictable token on an existing public test page.
// Send its URL, NEVER the expected token or locator.
export async function runAIFreshSourceChallenge(raw:unknown,provider:EnrichmentProvider,signal?:AbortSignal){
 assertAIActive(signal);const r=obj(raw);
 if(r.publicComponentConfirmed!==true||r.freshPublicSourceConfirmed!==true)throw Error('explicit fresh public source confirmation required');
 const name=nonblank(r.name,200),category=nonblank(r.category,128),manufacturer=nonblank(r.manufacturer,200),mpn=nonblank(r.mpn,200),url=sourceURL(r.sourceUrl),token=nonblank(r.expectedToken,128),locator=nonblank(r.expectedLocator,1000);
 if(!/^[A-Za-z0-9_-]{20,128}$/.test(token)||[name,category,manufacturer,mpn,url,locator].some(x=>x.includes(token)))throw Error('fresh answer must not appear in request context');
 const key='retrieval_probe',input:EnrichmentRequest={partId:'public-fresh-source-challenge',name,category,manufacturer,mpn,known:{[key]:null},allowedKeys:[key],sourceUrls:[url]};
 const result=await provider.enrich(input,signal);assertAIActive(signal);
 const reviewed=reviewEnrichment(input.known,input.allowedKeys,result.suggestions),f=reviewed.find(x=>x.key===key);
 const status=!f||f.status==='unknown'?'missing':f.status!=='missing'?'unsupported':f.value!==token?'value-mismatch':!f.evidence.some(x=>sourceURL(x.url)===url&&x.locator===locator)?'source-mismatch':'candidate-match';
 const unexpected=reviewed.filter(x=>x.key!==key).length;
 return {fields:[{key,status}],unexpectedFields:unexpected,candidateChecksPassed:status==='candidate-match'&&unexpected===0,retrievalVerified:false as const,manualSourceAndGatewayLogReviewRequired:true as const};
}
