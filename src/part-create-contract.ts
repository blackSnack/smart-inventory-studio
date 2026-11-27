import type {Operation} from './operation-journal.js';
const obj=(x:unknown):Record<string,unknown>=>{if(!x||typeof x!=='object'||Array.isArray(x))throw Error('invalid Part record');return x as Record<string,unknown>};
export const partCreateId=(x:unknown):string=>{const s=typeof x==='number'&&Number.isSafeInteger(x)?String(x):x;if(typeof s!=='string'||!(/^[1-9][0-9]{0,15}$/).test(s)||!Number.isSafeInteger(Number(s)))throw Error('invalid Part/category ID');return s};
const text=(x:unknown,max:number,empty=false):string=>{if(typeof x!=='string'||x.length>max||(!empty&&!x.trim())||/[\u0000-\u001f]/.test(x))throw Error('invalid Part field');return x};
export function parsePartCreate(o:Operation){
 if(o.kind!=='create-part'||!o.id.trim())throw Error('unsupported Part operation');const p=o.payload;
 if(p.identityMode!=='partial'||p.newPartConfirmed!==true||p.expectedAbsent!==true||p.lookupComplete!==true)throw Error('explicit new partial identity approval required');
 const ipn=text(p.ipn,100);if(ipn!==ipn.trim())throw Error('invalid IPN');
 return {ipn,categoryId:partCreateId(p.categoryId),categoryName:text(p.categoryName,100),name:text(p.name,100),description:text(p.description,250,true),units:text(p.units,20)};
}
export type ParsedPartCreate=ReturnType<typeof parsePartCreate>;

export function partCreateBody(p:ParsedPartCreate){
 return {IPN:p.ipn,name:p.name,description:p.description,category:Number(p.categoryId),units:p.units,active:true,virtual:false,trackable:false,is_template:false,assembly:false,component:true,copy_category_parameters:false};
}
export function verifyCreatedPart(raw:unknown,p:ParsedPartCreate){
 const r=obj(raw);if(r.IPN!==p.ipn||r.name!==p.name||r.description!==p.description||r.units!==p.units||partCreateId(r.category)!==p.categoryId||r.active!==true||r.virtual!==false||r.trackable!==false||r.is_template!==false||r.assembly!==false||r.component!==true)throw Error('Part readback mismatch');return partCreateId(r.pk);
}
