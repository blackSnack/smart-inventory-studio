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
 const {input,expected}=challenge(raw),result=await provider.enrich(input,signal);
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
