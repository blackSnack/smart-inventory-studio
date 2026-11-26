export interface Evidence {url:string;locator:string}
export interface Suggestion {key:string;value:string|null;evidence:Evidence[]}
export interface ReviewField extends Suggestion {before:string|null;status:'missing'|'same'|'conflict'|'unsupported'|'unknown'}
const valid=(e:Evidence)=>{try{const u=new URL(e.url);return u.protocol==='https:'&&!u.username&&!u.password&&!!e.locator.trim()}catch{return false}};
export function reviewEnrichment(current:Record<string,string|null>,allowed:string[],suggestions:Suggestion[]):ReviewField[]{
 if(new Set(suggestions.map(s=>s.key)).size!==suggestions.length)throw Error('duplicate suggestion');
 return suggestions.map(s=>{const before=current[s.key]??null;const status=!allowed.includes(s.key)?'unsupported':s.value===null||!s.value.trim()?'unknown':!s.evidence.length||!s.evidence.every(valid)?'unsupported':before===null||before.trim()===''?'missing':before===s.value?'same':'conflict';return {...s,before,status}});
}
export function approvedEnrichment(fields:ReviewField[],accepted:string[],allowCorrection:string[]=[]):Record<string,string>{
 if(new Set(accepted).size!==accepted.length)throw Error('duplicate approval');
 const out:Record<string,string>=Object.create(null);
 for(const key of accepted){const f=fields.find(x=>x.key===key);if(!f||f.value===null||!(f.status==='missing'||f.status==='conflict'&&allowCorrection.includes(key))||!f.evidence.length||!f.evidence.every(valid))throw Error('unapproved or unsupported field');out[key]=f.value}
 return out;
}
export async function batchReview<T,R>(items:T[],worker:(x:T)=>Promise<R>,concurrency=3):Promise<PromiseSettledResult<R>[]>{
 if(!Number.isSafeInteger(concurrency)||concurrency<1||concurrency>8||items.length>500)throw Error('invalid batch limits');
 let next=0;const results:PromiseSettledResult<R>[]=new Array(items.length);
 await Promise.all(Array.from({length:Math.min(concurrency,items.length)},async()=>{while(next<items.length){const i=next++;try{results[i]={status:'fulfilled',value:await worker(items[i])}}catch(reason){results[i]={status:'rejected',reason}}}}));return results;
}
