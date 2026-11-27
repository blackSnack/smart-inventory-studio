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
 private legacyParameters=false;
 constructor(private base:string,private token:string,private request:typeof fetch=fetch){this.transport=new InvenTreeReadProvider(base,token,request)}
 async probe():Promise<SearchParameterTemplate[]>{
  this.searchTemplates=null;const check=await probeSchema(this.base,this.token,[{key:'parameters',path:'/api/parameter/',method:'get'},{key:'templates',path:'/api/parameter/template/',method:'get'},{key:'legacy-parameters',path:'/api/part/parameter/',method:'get'},{key:'legacy-templates',path:'/api/part/parameter/template/',method:'get'}],this.request);
  const declared=(key:string)=>check.operations.some(o=>o.key===key&&o.declared);
  const modern=declared('parameters')&&declared('templates'),legacy=declared('legacy-parameters')&&declared('legacy-templates');
  if(!modern&&!legacy)throw Error('parameter API not declared');this.legacyParameters=!modern&&legacy;
  const all=(await this.transport.list(this.legacyParameters?'api/part/parameter/template/':'api/parameter/template/',this.legacyParameters?{}:{for_model:'part.part'})).map(x=>{const r=row(x);if((!this.legacyParameters&&((r.model_type!=='part.part'&&r.model_type!==null)||typeof r.enabled!=='boolean'))||typeof r.units!=='string')throw Error('unexpected parameter template');return {id:id(r.pk),name:str(r.name),unit:r.units.trim()||null,enabled:this.legacyParameters||r.enabled===true}});if(new Set(all.map(x=>x.id)).size!==all.length)throw Error('duplicate template');this.searchTemplates=all.filter(t=>t.enabled).map(({id,name,unit})=>({id,name,unit}));return structuredClone(this.searchTemplates);
 }
 async values(templateId:string):Promise<SearchParameterValue[]>{if(!this.searchTemplates?.some(t=>t.id===templateId))throw Error('parameter template not probed');const seen=new Set<string>(),parts=new Set<string>();return (await this.transport.list(this.legacyParameters?'api/part/parameter/':'api/parameter/',this.legacyParameters?{template:templateId}:{model_type:'part.part',template:templateId})).map(x=>{const r=row(x),pk=id(r.pk),partId=id(this.legacyParameters?r.part:r.model_id);if((!this.legacyParameters&&r.model_type!=='part.part')||id(r.template)!==templateId||seen.has(pk)||parts.has(partId))throw Error('unexpected or duplicate parameter value');seen.add(pk);parts.add(partId);const value=str(r.data);return {partId,templateId,value:value.trim()||null}})}
 async searchParts(query:string):Promise<PartSummary[]>{const seen=new Set<string>();return (await this.transport.searchParts(query)).map(x=>{const r=row(x),pid=id(r.pk);if(seen.has(pid))throw Error('duplicate part');seen.add(pid);return {id:pid,name:str(r.name),ipn:r.IPN==null?null:str(r.IPN),description:str(r.description??''),categoryId:optionalId(r.category)}})}
 async getStockByPart(partId:string):Promise<StockDistribution[]>{
  const result=new Map<string|null,StockDistribution>();const seen=new Set<string>();
  for(const x of await this.transport.getStockByPart(partId)){const r=row(x),sid=id(r.pk),pid=id(r.part);if(!Object.hasOwn(r,'location'))throw Error('missing stock location evidence');const loc=optionalId(r.location);if(pid!==partId||seen.has(sid))throw Error('unexpected or duplicate stock row');seen.add(sid);
   const item=result.get(loc)??{partId,locationId:loc,quantity:'0',stockItemIds:[]};item.quantity=add(item.quantity,quantity(r.quantity));item.stockItemIds.push(sid);result.set(loc,item);
  }return [...result.values()];
 }
 async getLocations():Promise<LocationSummary[]>{
  const locations=(await this.transport.getLocations()).map(x=>{const r=row(x);if(typeof r.structural!=='boolean'||!Object.hasOwn(r,'parent'))throw Error('unverified location structure');return {id:id(r.pk),name:str(r.name),parentId:optionalId(r.parent),structural:r.structural}});
  const byId=new Map(locations.map(l=>[l.id,l]));if(byId.size!==locations.length)throw Error('duplicate location ID');
  const checked=new Set<string>();
  for(const l of locations){let current:LocationSummary|undefined=l;const chain=new Set<string>();while(current&&!checked.has(current.id)){if(chain.has(current.id))throw Error('cyclic location tree');chain.add(current.id);if(current.parentId===null)break;current=byId.get(current.parentId);if(!current)throw Error('missing parent location')}for(const k of chain)checked.add(k)}
  return locations;
 }
 async getCapabilities():Promise<InventoryCapabilities>{return {read:true,write:false,parameterTemplates:false,metadata:false,stockTransfer:false}}
}
