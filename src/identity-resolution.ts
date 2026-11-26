import {match,normalizeSI,type Identity,type Policy,type Match} from './domain.js';
import type {Catalog} from './catalog.js';
const units=['Ω','F','H','V','W','A'] as const;
type Unit=typeof units[number];
export function canonicalFields(category:string,fields:Record<string,string|null>,catalog:Catalog):Record<string,string|null>{
 const c=catalog.categories.find(x=>x.key===category);if(!c)throw Error('unknown category');
 const result:Record<string,string|null>=Object.create(null);
 for(const k of c.parameters){const value=fields[k]?.trim();if(!value){result[k]=null;continue}
 const d=catalog.fieldDefinitions[k];
 if(d.type==='number'&&units.includes(d.unit as Unit)){result[k]=normalizeSI(value,d.unit as Unit)}
 else if(k==='tolerance'){const m=value.match(/^(?:±|\+\/-)?\s*(\d+(?:\.\d+)?)\s*%$/);result[k]=m?'±'+String(Number(m[1]))+'%':value}
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
