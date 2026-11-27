import {InvenTreeReadProvider} from './domain.js';
import {probeSchema} from './provider-schema.js';
import type {PhotoDraft} from './ai-provider.js';
import {hasStrongPhotoIdentity} from './photo-intake.js';
type Association={partId:string;company:string;code:string};
export type PhotoInventoryMatch={decision:'insufficient'|'reuse'|'candidate'|'conflict'|'new';ids:string[]};
const nonblank=(x:unknown):x is string=>typeof x==='string'&&!!x.trim();
const id=(x:unknown):string=>{const v=typeof x==='number'&&Number.isSafeInteger(x)?String(x):x;if(typeof v!=='string'||!/^[1-9][0-9]{0,17}$/.test(v))throw Error('invalid identity index id');return v};
const row=(x:unknown)=>{if(!x||typeof x!=='object'||Array.isArray(x))throw Error('invalid identity index row');return x as Record<string,unknown>};
const norm=(v:string)=>v.normalize('NFKC').trim().toLowerCase();
const same=(a:string,b:string)=>norm(a)===norm(b);
export function resolvePhotoAssociations(d:PhotoDraft,makers:Association[],suppliers:Association[]):PhotoInventoryMatch{
 if(!hasStrongPhotoIdentity(d))return {decision:'insufficient',ids:[]};
 const m=d.manufacturer&&d.mpn?makers.filter(a=>same(a.company,d.manufacturer!)&&same(a.code,d.mpn!)).map(a=>a.partId):[];
 const s=d.supplier&&d.sku?suppliers.filter(a=>same(a.company,d.supplier!)&&same(a.code,d.sku!)).map(a=>a.partId):[];
 const ids=[...new Set([...m,...s])];
 if(ids.length>1)return {decision:'conflict',ids};
 if(ids.length===1){const partial=!!(d.manufacturer&&d.mpn&&d.supplier&&d.sku)&&(!m.length||!s.length);return {decision:partial?'candidate':'reuse',ids}}
 return {decision:'new',ids:[]};
}
function associations(rows:unknown[],companyKey:'manufacturer'|'supplier',codeKey:'MPN'|'SKU'):Association[]{
 const seen=new Set<string>();return rows.flatMap(x=>{const r=row(x),pk=id(r.pk);if(seen.has(pk))throw Error('duplicate identity index');seen.add(pk);const d=row(r[companyKey+'_detail']);if(id(d.pk)!==id(r[companyKey])||!nonblank(d.name))throw Error('unverified company identity');const partId=id(r.part),code=r[codeKey];if(typeof code!=='string')throw Error('invalid identity code');return code.trim()?[{partId,company:d.name,code}]:[]});
}
// Read the complete association indexes, not a fuzzy text search. If an endpoint,
// page or record is unavailable, propagate failure; do not return 'new'.
export async function matchPhotoInventory(base:string,token:string,request:typeof fetch,d:PhotoDraft):Promise<PhotoInventoryMatch>{
 if(!hasStrongPhotoIdentity(d))return {decision:'insufficient',ids:[]};
 const paths=['/api/company/part/manufacturer/','/api/company/part/'];const check=await probeSchema(base,token,paths.map(path=>({key:path,path,method:'get'})),request);if(check.operations.some(o=>!o.declared))throw Error('identity index unsupported');
 const read=new InvenTreeReadProvider(base,token,request);
 const [m,s]=await Promise.all([read.list('api/company/part/manufacturer/',{manufacturer_detail:'true'}),read.list('api/company/part/',{supplier_detail:'true'})]);
 return resolvePhotoAssociations(d,associations(m,'manufacturer','MPN'),associations(s,'supplier','SKU'));
}
