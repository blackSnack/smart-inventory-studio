import {assertAIActive} from './ai-http.js';import {parseDraft,type AIProvider} from './ai-provider.js';
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

const photoKeys=['name','manufacturer','mpn','supplier','sku','category','datasheetUrl','imageUrl'] as const;
type PhotoKey=typeof photoKeys[number];
type ExpectedPhoto={key:string;value:string|null;sourceUrl?:string;locator?:string};
function photoFixture(raw:unknown){
 const r=obj(raw);if(r.publicPhotoConfirmed!==true||!['legible','unreadable'].includes(String(r.scenario)))throw Error('explicit public photo and scenario required');
 if(!Array.isArray(r.categoryKeys)||!r.categoryKeys.length||r.categoryKeys.length>500)throw Error('category keys required');
 const categories=r.categoryKeys.map(x=>nonblank(x,128));if(new Set(categories).size!==categories.length)throw Error('duplicate categories');
 if(!Array.isArray(r.expected)||!r.expected.length||r.expected.length>150)throw Error('expected photo fields required');
 const expected:ExpectedPhoto[]=r.expected.map(x=>{const e=obj(x),key=nonblank(e.key,128),value=e.value===null?null:nonblank(e.value,4000),parameter=key.startsWith('parameters.');
  if(!photoKeys.includes(key as PhotoKey)&&(!parameter||!(/^[a-z][a-z0-9_]*$/).test(key.slice(11))))throw Error('invalid photo challenge field');
  if(key==='category'&&value!==null&&!categories.includes(value))throw Error('invalid expected category');
  const sourceUrl=e.sourceUrl===undefined?undefined:sourceURL(e.sourceUrl),locator=e.locator===undefined?undefined:nonblank(e.locator,1000);
  if((sourceUrl||locator)&&(!value||!sourceUrl||!locator||!parameter&&key!=='datasheetUrl'&&key!=='imageUrl'))throw Error('invalid expected photo evidence');
  return {key,value,sourceUrl,locator};
 });
 if(new Set(expected.map(e=>e.key)).size!==expected.length)throw Error('duplicate expected photo field');
 const exact=(key:string)=>expected.some(e=>e.key===key&&e.value!==null),unknown=(key:string)=>expected.some(e=>e.key===key&&e.value===null);
 if(r.scenario==='legible'&&!(exact('manufacturer')&&exact('mpn')||exact('supplier')&&exact('sku')))throw Error('legible sample needs exact identity');
 if(r.scenario==='unreadable'&&(!['manufacturer','mpn','supplier','sku','datasheetUrl','imageUrl'].every(unknown)||expected.some(e=>e.value!==null)))throw Error('unreadable sample must expect unknown identity and sources');
 return {categories,expected,scenario:r.scenario as 'legible'|'unreadable'};
}
// Image and approved categories only; expected identity, parameters and source locators stay local.
export async function runAIPhotoChallenge(raw:unknown,imageDataUrl:string,provider:AIProvider,signal?:AbortSignal){
 assertAIActive(signal);const {categories,expected,scenario}=photoFixture(raw);
 const result=await provider.recognize(imageDataUrl,categories,signal);assertAIActive(signal);
 const draft=parseDraft(result.draft,categories);
 const fields=expected.map(e=>{
  const parameter=e.key.startsWith('parameters.'),key=parameter?e.key.slice(11):e.key;
  const value=parameter?(Object.hasOwn(draft.parameters,key)?draft.parameters[key]:null):draft[key as PhotoKey];
  const evidence=draft.fieldEvidence?.[key]??[];
  const status=value!==e.value?(value===null?'missing':e.value===null?'unexpected-value':'value-mismatch'):e.sourceUrl&&!evidence.some(v=>sourceURL(v.url)===e.sourceUrl&&v.locator===e.locator)?'evidence-mismatch':'candidate-match';
  return {key:e.key,status};
 });
 const unexpectedFields=scenario==='unreadable'?[...Object.values(draft.parameters),...draft.sourceUrls].filter(v=>v!==null&&v.trim()!=='').length:0;
 return {scenario,fields,unexpectedFields,candidateChecksPassed:unexpectedFields===0&&fields.every(f=>f.status==='candidate-match'),retrievalVerified:false as const,manualSourceAndGatewayLogReviewRequired:true as const};
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
