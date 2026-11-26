import {match,normalizeSI,type Identity,type Policy,type Match} from './domain.js';
import type {Catalog} from './catalog.js';
const units=['Ω','F','H','V','W','A'] as const;
type Unit=typeof units[number];
// Canonicalization rules are versioned separately from stable Part IDs.
export const SPEC_NORMALIZATION_VERSION=1;
function decimal(s:string){const [a,b='']=s.split('.');const i=(a||'0').replace(/^0+(?=\d)/,'');const f=b.replace(/0+$/,'');return i+(f?'.'+f:'')}
export function canonicalTolerance(raw:string){
 const v=raw.trim().replaceAll('−','-');
 const symmetric=v.match(/^(?:±|\+\/-)?\s*(\d+(?:\.\d+)?)\s*%$/);
 if(symmetric)return '±'+decimal(symmetric[1])+'%';
 const forward=v.match(/^\+\s*(\d+(?:\.\d+)?)\s*%?\s*\/\s*-\s*(\d+(?:\.\d+)?)\s*%$/);
 const reverse=v.match(/^-\s*(\d+(?:\.\d+)?)\s*%?\s*\/\s*\+\s*(\d+(?:\.\d+)?)\s*%$/);
 if(forward||reverse){const plus=decimal(forward?forward[1]:reverse![2]),minus=decimal(forward?forward[2]:reverse![1]);return plus===minus?'±'+plus+'%':'+'+plus+'%/-'+minus+'%'}
 return v;
}
// Convert only explicitly identified metric/imperial passive package aliases.
// Bare 1608 and vendor-specific package names are retained, never guessed.
const passiveMetric:Record<string,string>={'0603':'0201','1005':'0402','1608':'0603','2012':'0805','3216':'1206','3225':'1210','4532':'1812','5750':'2220'};
export function canonicalPackage(category:string,raw:string){
 const value=raw.trim();if(!['resistor.smd','capacitor.ceramic'].includes(category))return value;
 const m=value.match(/^(?:metric\s*(\d{4})|(\d{4})\s*(?:metric|\(metric\)))$/i);
 if(m){const code=m[1]??m[2];return passiveMetric[code]??'metric '+code}
 const i=value.match(/^(?:imperial\s*(\d{4})|(\d{4})\s*(?:imperial|\(imperial\)))$/i);
 return i?(i[1]??i[2]):value;
}
export function specificationFingerprint(identity:Identity,policy:Policy):string|null{
 if(!identity.category||!policy.fields.length||!Number.isSafeInteger(policy.version)||policy.version<1)return null;
 const fields=[...new Set(policy.fields)].sort();
 if(fields.some(k=>identity.fields[k]==null||!identity.fields[k]!.trim()))return null;
 // A fingerprint is a comparison key only; it never replaces Part ID or authorizes pooling.
 return JSON.stringify([SPEC_NORMALIZATION_VERSION,identity.category,policy.version,fields.map(k=>[k,identity.fields[k]])]);
}

export function canonicalFields(category:string,fields:Record<string,string|null>,catalog:Catalog):Record<string,string|null>{
 const c=catalog.categories.find(x=>x.key===category);if(!c)throw Error('unknown category');
 const result:Record<string,string|null>=Object.create(null);
 for(const k of c.parameters){const value=fields[k]?.trim();if(!value){result[k]=null;continue}
 const d=catalog.fieldDefinitions[k];
 if(d.type==='number'&&units.includes(d.unit as Unit)){result[k]=normalizeSI(value,d.unit as Unit)}
 else if(k==='tolerance')result[k]=canonicalTolerance(value);
 else if(k==='package')result[k]=canonicalPackage(category,value);
 else result[k]=value;
 }
 for(const [k,v] of Object.entries(fields))if(v?.trim()&&!c.parameters.includes(k))throw Error('unmapped parameter '+k);
 return result;
}
export interface CandidateResolution {decision:'reuse'|'new'|'review'|'blocked';partId?:string;matches:{id:string;result:Match}[]}
function strong(a:Identity,b:Identity){const same=(x?:string,y?:string)=>!!x?.trim()&&x.trim()===y?.trim();return same(a.manufacturer,b.manufacturer)&&same(a.mpn,b.mpn)||same(a.supplier,b.supplier)&&same(a.sku,b.sku)}
export function resolveCandidates(incoming:Identity,candidates:Identity[],policy:Policy,identityVerified:boolean,lookupComplete:boolean):CandidateResolution{
 if(new Set(candidates.map(x=>x.id)).size!==candidates.length)throw Error('duplicate candidate ID');
 const matches=candidates.map(c=>({id:c.id,result:(strong(incoming,c)&&incoming.category!==c.category?'conflict':match(incoming,c,policy)) as Match}));
 const exact=matches.filter(m=>m.result==='same');
 if(matches.some(m=>m.result==='conflict')||exact.length>1)return {decision:'blocked',matches};
 if(!lookupComplete||!identityVerified)return {decision:'review',matches};
 if(exact.length===1)return {decision:'reuse',partId:exact[0].id,matches};
 if(matches.some(m=>m.result==='candidate'))return {decision:'review',matches};
 return {decision:'new',matches};
}
