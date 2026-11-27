import {InvenTreeReadProvider} from './domain.js';
import {probeSchema} from './provider-schema.js';import type {ParameterSearchPort,SearchParameterTemplate,SearchParameterValue} from './inventory-contract.js';
export interface PartSummary {id:string;name:string;ipn:string|null;description:string;categoryId:string|null}
export interface StockDistribution {partId:string;locationId:string|null;quantity:string;stockItemIds:string[]}
export interface LocationSummary {id:string;name:string;parentId:string|null;structural:boolean}
export interface InventoryCapabilities {read:boolean;write:boolean;parameterTemplates:boolean;metadata:boolean;stockTransfer:boolean}
export interface InventoryReadPort {
 searchParts(query:string):Promise<PartSummary[]>;
 getStockByPart(id:string):Promise<StockDistribution[]>;
 getLocations():Promise<LocationSummary[]>;
 getCapabilities():Promise<InventoryCapabilities>;
}
const row=(x:unknown):Record<string,unknown>=>{if(!x||typeof x!=='object'||Array.isArray(x))throw Error('invalid provider row');return x as Record<string,unknown>};
const id=(x:unknown):string=>{if(typeof x==='number'&&Number.isSafeInteger(x)&&x>0)return String(x);if(typeof x==='string'&&x.trim())return x;throw Error('invalid provider ID')};
const optionalId=(x:unknown)=>x===null||x===undefined?null:id(x);
const str=(x:unknown):string=>{if(typeof x!=='string')throw Error('invalid provider string');return x};
function quantity(x:unknown):string {const s=typeof x==='number'&&Number.isSafeInteger(x)?String(x):x;if(typeof s!=='string'||!/^\d+(?:\.\d+)?$/.test(s))throw Error('invalid stock quantity');return s}
function add(a:string,b:string):string {const [ai,af='']=a.split('.'),[bi,bf='']=b.split('.');const n=Math.max(af.length,bf.length);const v=(BigInt(ai+af.padEnd(n,'0'))+BigInt(bi+bf.padEnd(n,'0'))).toString().padStart(n+1,'0');return n?v.slice(0,-n)+'.'+v.slice(-n):v}
export class InvenTreeReadAdapter implements InventoryReadPort,ParameterSearchPort{
 private transport:InvenTreeReadProvider;
 private searchTemplates:SearchParameterTemplate[]|null=null;
 constructor(private base:string,private token:string,private request:typeof fetch=fetch){this.transport=new InvenTreeReadProvider(base,token,request)}
 async probe():Promise<SearchParameterTemplate[]>{
  this.searchTemplates=null;const check=await probeSchema(this.base,this.token,[{key:'parameters',path:'/api/parameter/',method:'get'},{key:'templates',path:'/api/parameter/template/',method:'get'}],this.request);if(!check.operations.every(o=>o.declared))throw Error('parameter API not declared');
  const all=(await this.transport.list('api/parameter/template/',{model_type:'part.part'})).map(x=>{const r=row(x);if(r.model_type!=='part.part'||typeof r.enabled!=='boolean'||typeof r.units!=='string')throw Error('unexpected parameter template');return {id:id(r.pk),name:str(r.name),unit:r.units.trim()||null,enabled:r.enabled}});if(new Set(all.map(x=>x.id)).size!==all.length)throw Error('duplicate template');this.searchTemplates=all.filter(t=>t.enabled).map(({id,name,unit})=>({id,name,unit}));return structuredClone(this.searchTemplates);
 }
 async values(templateId:string):Promise<SearchParameterValue[]>{if(!this.searchTemplates?.some(t=>t.id===templateId))throw Error('parameter template not probed');const seen=new Set<string>(),parts=new Set<string>();return (await this.transport.list('api/parameter/',{model_type:'part.part',template:templateId})).map(x=>{const r=row(x),pk=id(r.pk),partId=id(r.model_id);if(r.model_type!=='part.part'||id(r.template)!==templateId||seen.has(pk)||parts.has(partId))throw Error('unexpected or duplicate parameter value');seen.add(pk);parts.add(partId);const value=str(r.data);return {partId,templateId,value:value.trim()||null}})}
 async searchParts(query:string):Promise<PartSummary[]>{const seen=new Set<string>();return (await this.transport.searchParts(query)).map(x=>{const r=row(x),pid=id(r.pk);if(seen.has(pid))throw Error('duplicate part');seen.add(pid);return {id:pid,name:str(r.name),ipn:r.IPN==null?null:str(r.IPN),description:str(r.description??''),categoryId:optionalId(r.category)}})}
 async getStockByPart(partId:string):Promise<StockDistribution[]>{
  const result=new Map<string|null,StockDistribution>();const seen=new Set<string>();
  for(const x of await this.transport.getStockByPart(partId)){const r=row(x),sid=id(r.pk),pid=id(r.part),loc=optionalId(r.location);if(pid!==partId||seen.has(sid))throw Error('unexpected or duplicate stock row');seen.add(sid);
   const item=result.get(loc)??{partId,locationId:loc,quantity:'0',stockItemIds:[]};item.quantity=add(item.quantity,quantity(r.quantity));item.stockItemIds.push(sid);result.set(loc,item);
  }return [...result.values()];
 }
 async getLocations():Promise<LocationSummary[]>{return (await this.transport.getLocations()).map(x=>{const r=row(x);if(typeof r.structural!=='boolean')throw Error('unverified structural flag');return {id:id(r.pk),name:str(r.name),parentId:optionalId(r.parent),structural:r.structural}})}
 async getCapabilities():Promise<InventoryCapabilities>{return {read:true,write:false,parameterTemplates:false,metadata:false,stockTransfer:false}}
}
