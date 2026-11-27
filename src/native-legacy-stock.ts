import {InvenTreeReadProvider} from './domain.js';
import {snapshotKey} from './approved-snapshot.js';
import {receiptId} from './receipt-stock-baseline.js';
import type {LocationSummary} from './inventory-provider.js';
// 0.16.7 StockItem quantity has max_digits=15, decimal_places=5; JSON uses number/double.
// Refuse values outside the exact representable contract. Never round stock values to fit.
export function legacyStockDecimal(raw:unknown):string{
 const s=typeof raw==='number'&&Number.isFinite(raw)?String(raw):raw;
 if(typeof s!=='string'||!/^\d{1,10}(?:\.\d{1,5})?$/.test(s))throw Error('unsupported API 232 stock precision');
 const [i,f='']=s.split('.'),integer=i.replace(/^0+(?=\d)/,''),fraction=f.replace(/0+$/,'');return fraction?integer+'.'+fraction:integer;
}
const obj=(x:unknown):Record<string,unknown>=>{if(!x||typeof x!=='object'||Array.isArray(x))throw Error('invalid API 232 stock row');return x as Record<string,unknown>};
const fields=['pk','part','location','quantity','batch','serial','status','supplier_part','purchase_order','sales_order','owner','customer','parent','belongs_to','consumed_by','packaging','expiry_date','allocated','is_building','child_items','installed_items','build'];
function rawRow(raw:unknown,location:string){
 const r=obj(raw);if(fields.some(k=>!Object.hasOwn(r,k))||receiptId(r.location)!==location||typeof r.is_building!=='boolean'||r.build!==null)throw Error('incomplete or unsupported API 232 stock lifecycle');
 receiptId(r.pk);receiptId(r.part);const status=receiptId(r.status);
 for(const k of ['sales_order','belongs_to','customer','consumed_by'])if(r[k]!==null)receiptId(r[k]);
 const out=Object.fromEntries(fields.map(k=>[k,r[k]]));
 for(const k of ['quantity','allocated','child_items','installed_items'])out[k]=legacyStockDecimal(r[k]);
 // Tagged 0.16.7 StockItem.IN_STOCK_FILTER and StockStatusGroups.AVAILABLE_CODES.
 const inStock=out.quantity!=='0'&&r.sales_order===null&&r.belongs_to===null&&r.customer===null&&r.consumed_by===null&&!r.is_building&&['10','50','55','85'].includes(status);
 return {row:out,inStock};
}
function scoped(raw:unknown[],location:string){
 const rows=raw.map(x=>rawRow(x,location));const ids=rows.map(x=>receiptId(x.row.pk));
 if(new Set(ids).size!==ids.length)throw Error('duplicate legacy StockItem');return rows.sort((a,b)=>receiptId(a.row.pk).localeCompare(receiptId(b.row.pk)));
}
// Preserve all unfiltered stock rows. Cross-check the positive and negative lifecycle
// sets against the server filter and the exact tagged model predicate, not a default true.
export async function readNativeStockByLocation(read:InvenTreeReadProvider,location:string,legacy=false):Promise<unknown[]>{
 const params={location:receiptId(location),cascade:'false'};
 if(!legacy)return read.list('api/stock/',params);
 const all=scoped(await read.list('api/stock/',params),location);
 const available=scoped(await read.list('api/stock/',{...params,in_stock:'true'}),location);
 const unavailable=scoped(await read.list('api/stock/',{...params,in_stock:'false'}),location);
 const again=scoped(await read.list('api/stock/',params),location);
 if(snapshotKey(all)!==snapshotKey(again)||snapshotKey(available)!==snapshotKey(all.filter(x=>x.inStock))||snapshotKey(unavailable)!==snapshotKey(all.filter(x=>!x.inStock)))throw Error('API 232 lifecycle filter or stock baseline inconsistent');
 return all.map(x=>({...x.row,in_stock:x.inStock}));
}
export async function verifyLegacyLocationAncestors(read:InvenTreeReadProvider,tree:LocationSummary[],ids:string[]){
 const rows=(await read.getLocations()).map(obj),byId=new Map(rows.map(r=>[receiptId(r.pk),r]));
 if(byId.size!==rows.length||rows.length!==tree.length)throw Error('legacy location tree changed');
 for(const id of ids){let current:string|null=id;const seen=new Set<string>();while(current!==null){
  if(seen.has(current))throw Error('cyclic legacy ancestry');seen.add(current);
  const a=tree.find(x=>x.id===current),r=byId.get(current);
  if(!a||!r||r.name!==a.name||r.structural!==a.structural||r.external!==false||(r.parent===null?null:receiptId(r.parent))!==a.parentId)throw Error('legacy external or changed location');
  current=a.parentId;
 }}
}
