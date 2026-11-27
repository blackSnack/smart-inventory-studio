import type {AIProvider,PhotoDraft} from './ai-provider.js';
import {assertAIActive} from './ai-http.js';

const record=(x:unknown):Record<string,unknown>=>{
 if(!x||typeof x!=='object'||Array.isArray(x))throw Error('invalid photo challenge');
 return x as Record<string,unknown>;
};
const text=(x:unknown,max:number):string=>{
 if(typeof x!=='string'||!x.trim()||x.length>max)throw Error('invalid photo challenge text');
 return x;
};
function source(x:unknown):string{
 const u=new URL(text(x,4000));
 if(u.protocol!=='https:'||u.username||u.password)throw Error('invalid expected source');
 return u.href;
}
const scalarKeys=['name','manufacturer','mpn','supplier','sku','category','datasheetUrl','imageUrl'] as const;
type ScalarKey=typeof scalarKeys[number];
function scalar(key:string):key is ScalarKey{return scalarKeys.some(k=>k===key)}
function validate(raw:unknown){
 const r=record(raw);
 if(r.publicPhotoConfirmed!==true)throw Error('public sanitized photo confirmation required');
 const scenario=r.scenario??'selected-fields';if(!['selected-fields','legible','unreadable'].includes(String(scenario)))throw Error('invalid photo scenario');
 if(!Array.isArray(r.categoryKeys)||!r.categoryKeys.length||r.categoryKeys.length>150)throw Error('invalid category choices');
 const categoryKeys=r.categoryKeys.map(k=>text(k,128));
 if(new Set(categoryKeys).size!==categoryKeys.length)throw Error('duplicate category');
 if(!Array.isArray(r.expected)||!r.expected.length||r.expected.length>40)throw Error('expected fields required');
 const expected=r.expected.map(x=>{
  const e=record(x),key=text(e.key,138);
  if(!scalar(key)&&!/^parameter:[a-z][a-z0-9_]*$/.test(key))throw Error('invalid expected key');
  const value=e.value===null?null:text(e.value,4000);
  if(key==='category'&&value!==null&&!categoryKeys.includes(value))throw Error('unknown expected category');
  if((key==='datasheetUrl'||key==='imageUrl')&&value!==null)source(value);
  const sourceUrl=e.sourceUrl===undefined?undefined:source(e.sourceUrl),locator=e.locator===undefined?undefined:text(e.locator,1000);
  if(locator!==undefined&&sourceUrl===undefined)throw Error('locator requires source');
  const evidenceKey=key.startsWith('parameter:')?key.slice(10):key==='datasheetUrl'||key==='imageUrl'?key:undefined;
  if(sourceUrl!==undefined&&(value===null||!evidenceKey))throw Error('invalid field source expectation');
  if(value!==null&&evidenceKey&&!sourceUrl)throw Error('source expectation required for sourced fields');
  if(scenario==='legible'&&value!==null&&evidenceKey&&!locator)throw Error('legible sourced field requires exact locator');
  return {key,value,sourceUrl,evidenceKey,locator};
 });
 if(new Set(expected.map(e=>e.key)).size!==expected.length)throw Error('duplicate expected field');
 const exact=(key:string)=>expected.some(e=>e.key===key&&e.value!==null),unknown=(key:string)=>expected.some(e=>e.key===key&&e.value===null);
 if(scenario==='legible'&&!(exact('manufacturer')&&exact('mpn')||exact('supplier')&&exact('sku')))throw Error('legible sample needs exact identity');
 if(scenario==='unreadable'&&(!['manufacturer','mpn','supplier','sku','datasheetUrl','imageUrl'].every(unknown)||expected.some(e=>e.value!==null)))throw Error('unreadable sample must expect unknown identity and sources');
 return {categoryKeys,expected,scenario};
}
function field(draft:PhotoDraft,key:string):string|null|undefined{
 if(scalar(key))return draft[key];
 const k=key.slice(10);
 return Object.hasOwn(draft.parameters,k)?draft.parameters[k]:undefined;
}
// Only the explicitly approved photo and category choices leave the local process.
export async function runAIPhotoChallenge(raw:unknown,imageDataUrl:string,provider:AIProvider,signal?:AbortSignal){
 const {categoryKeys,expected,scenario}=validate(raw);
 assertAIActive(signal);
 const result=await provider.recognize(imageDataUrl,categoryKeys,signal);
 assertAIActive(signal);
 const fields=expected.map(e=>{
  const actual=field(result.draft,e.key);
  let status:string;
  if(e.value===null)status=actual===null||actual===undefined?'candidate-match':'unexpected-value';
  else if(actual===null||actual===undefined||!actual.trim())status='missing';
  else if(actual!==e.value)status='value-mismatch';
  else if(e.sourceUrl&&!result.draft.fieldEvidence?.[e.evidenceKey!]?.some(v=>source(v.url)===e.sourceUrl&&(e.locator===undefined||e.locator===v.locator)))status='source-mismatch';
  else status='candidate-match';
  return {key:e.key,status};
 });
 const unexpectedFields=scenario==='unreadable'?[...Object.values(result.draft.parameters),...result.draft.sourceUrls].filter(v=>v!==null&&v.trim()!=='').length:0;
 return {fields,unexpectedFields,scenario,candidateChecksPassed:unexpectedFields===0&&fields.every(f=>f.status==='candidate-match'),retrievalVerified:false as const,manualSourceAndGatewayLogReviewRequired:true as const,physicalDeviceVerified:false as const};
}
