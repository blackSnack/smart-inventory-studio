import {InvenTreeReadProvider} from './domain.js';
import {InvenTreeReadAdapter} from './inventory-provider.js';
import {probeSchema} from './provider-schema.js';
export interface LocationStockRow {id:string;partId:string;locationId:string;quantity:string}
export interface LocationStockReadback {locationId:string;items:LocationStockRow[];hasPositiveQuantity:boolean}
const id=(v:unknown):string=>{const s=typeof v==='number'&&Number.isSafeInteger(v)?String(v):v;if(typeof s!=='string'||!(/^[1-9][0-9]{0,17}$/).test(s))throw Error('invalid stock ID');return s};
const decimal=(v:unknown):string=>{const s=typeof v==='number'&&Number.isSafeInteger(v)?String(v):v;if(typeof s!=='string'||s.length>128||!/^\d+(?:\.\d+)?$/.test(s))throw Error('invalid stock quantity');return s};
export class InvenTreeLocationStockReader{
 private constructor(private transport:InvenTreeReadProvider,private locations:InvenTreeReadAdapter){}
 static async open(base:string,token:string,request:typeof fetch){
  const check=await probeSchema(base,token,[{key:'locations',path:'/api/stock/location/',method:'get'},{key:'stock',path:'/api/stock/',method:'get'}],request);
  if(check.operations.some(o=>!o.declared))throw Error('location stock API not declared');
  return new InvenTreeLocationStockReader(new InvenTreeReadProvider(base,token,request),new InvenTreeReadAdapter(base,token,request));
 }
 async getLocationStock(locationId:string):Promise<LocationStockReadback>{
  if(id(locationId)!==locationId)throw Error('invalid location ID');
  const locations=await this.locations.getLocations(),location=locations.find(l=>l.id===locationId);
  if(!location||location.structural||locations.some(l=>l.parentId===locationId))throw Error('not a storage leaf');
  const seen=new Set<string>();
  const items=(await this.transport.list('api/stock/',{location:locationId,cascade:'false'})).map(raw=>{
   if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('invalid stock row');
   const r=raw as Record<string,unknown>,stockId=id(r.pk),partId=id(r.part);
   if(id(r.location)!==locationId||seen.has(stockId))throw Error('unexpected or duplicate stock row');
   seen.add(stockId);return {id:stockId,partId,locationId,quantity:decimal(r.quantity)};
  });
  return {locationId,items,hasPositiveQuantity:items.some(i=>/[1-9]/.test(i.quantity))};
 }
}
