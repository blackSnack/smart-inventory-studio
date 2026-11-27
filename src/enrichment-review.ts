export interface Evidence {url:string;locator:string}
export interface Suggestion {key:string;value:string|null;evidence:Evidence[]}
export interface ReviewField extends Suggestion {before:string|null;status:'missing'|'same'|'conflict'|'unsupported'|'unknown'}
const valid=(e:Evidence)=>{try{if(!e||typeof e.url!=='string'||e.url.length>4000||typeof e.locator!=='string'||e.locator.length>1000)return false;const u=new URL(e.url);return u.protocol==='https:'&&!u.username&&!u.password&&!!e.locator.trim()}catch{return false}};
const valueValid=(x:unknown):x is string|null=>x===null||typeof x==='string'&&x.length<=4000;
const keyValid=(x:unknown):x is string=>typeof x==='string'&&!!x.trim()&&x.length<=128;
const classify=(before:string|null,s:Suggestion,allowed:boolean):ReviewField['status']=>!allowed?'unsupported':s.value===null||!s.value.trim()?'unknown':!s.evidence.length||!s.evidence.every(valid)?'unsupported':before===null||before.trim()===''?'missing':before===s.value?'same':'conflict';
export function reviewEnrichment(current:Record<string,string|null>,allowed:string[],suggestions:Suggestion[]):ReviewField[]{
 if(!current||typeof current!=='object'||Array.isArray(current)||!Array.isArray(allowed)||allowed.length>150||allowed.some(k=>!keyValid(k))||new Set(allowed).size!==allowed.length||!Array.isArray(suggestions)||suggestions.length>150||suggestions.some(s=>!s||!keyValid(s.key)||!valueValid(s.value)||!Array.isArray(s.evidence)||s.evidence.length>20))throw Error('invalid enrichment review');
 if(new Set(suggestions.map(s=>s.key)).size!==suggestions.length)throw Error('duplicate suggestion');
 return suggestions.map(s=>{const before=Object.hasOwn(current,s.key)?current[s.key]??null:null;if(!valueValid(before))throw Error('invalid current field');const status=classify(before,s,allowed.includes(s.key));return {...structuredClone(s),before,status}});
}
export function approvedEnrichment(fields:ReviewField[],accepted:string[],allowCorrection:string[]=[]):Record<string,string>{
 if(!Array.isArray(fields)||fields.length>150||fields.some(f=>!f||!keyValid(f.key)||!valueValid(f.before)||!valueValid(f.value)||!Array.isArray(f.evidence)||f.evidence.length>20)||new Set(fields.map(f=>f.key)).size!==fields.length)throw Error('invalid or duplicate review field');
 if(!Array.isArray(accepted)||!Array.isArray(allowCorrection)||accepted.some(k=>!keyValid(k))||allowCorrection.some(k=>!keyValid(k))||new Set(accepted).size!==accepted.length||new Set(allowCorrection).size!==allowCorrection.length)throw Error('invalid or duplicate approval');
 const out:Record<string,string>=Object.create(null);
 for(const key of accepted){const f=fields.find(x=>x.key===key);if(!f||f.value===null||f.status!==classify(f.before,f,true)||!(f.status==='missing'||f.status==='conflict'&&allowCorrection.includes(key)))throw Error('unapproved or unsupported field');out[key]=f.value}
 return out;
}
export async function batchReview<T,R>(items:T[],worker:(x:T)=>Promise<R>,concurrency=3):Promise<PromiseSettledResult<R>[]>{
 if(!Number.isSafeInteger(concurrency)||concurrency<1||concurrency>8||items.length>500)throw Error('invalid batch limits');
 let next=0;const results:PromiseSettledResult<R>[]=new Array(items.length);
 await Promise.all(Array.from({length:Math.min(concurrency,items.length)},async()=>{while(next<items.length){const i=next++;try{results[i]={status:'fulfilled',value:await worker(items[i])}}catch(reason){results[i]={status:'rejected',reason}}}}));return results;
}
