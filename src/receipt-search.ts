import type {DraftPart} from './demo-part-draft.js';
import {demoIdentity} from './demo-part-draft.js';
const norm=(s:string)=>s.toLowerCase().replaceAll('μ','µ').replaceAll('ω','Ω');
export function searchReceiptParts<T extends DraftPart>(parts:T[],query:string,names:Record<string,string>={}):T[]{
 const tokens=norm(query.trim()).split(/\s+/).filter(Boolean);
 return parts.filter(p=>{const i=demoIdentity(p);const hay=norm([p.id,p.name,p.spec,i?.manufacturer,i?.mpn,i?.supplier,i?.sku,i?.category,...Object.values(i?.fields??{}),...Object.keys(p.stock),...Object.keys(p.stock).map(id=>Object.hasOwn(names,id)?names[id]:id)].filter(v=>v!=null).join(' '));return tokens.every(t=>hay.includes(t))});
}
export function eligibleReceiptLocations(parts:DraftPart[],locations:string[],partId:string){
 const occupied=new Map<string,Set<string>>();for(const p of parts)for(const [l,q] of Object.entries(p.stock))if(q>0){const ids=occupied.get(l)??new Set<string>();ids.add(p.id);occupied.set(l,ids)}
 return locations.filter(l=>![...(occupied.get(l)??[])].some(id=>id!==partId)).map(l=>({id:l,existing:occupied.get(l)?.has(partId)??false})).sort((a,b)=>Number(b.existing)-Number(a.existing)||a.id.localeCompare(b.id,undefined,{numeric:true}));
}
