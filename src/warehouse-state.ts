import {newCabinet,validateCabinet,type CabinetLayout} from './cabinet-layout.js';
import type {ApprovedPlan} from './operation-journal.js';
export interface StoredCabinet {layout:CabinetLayout;leaves:Record<string,string>}
export interface WarehouseState {schemaVersion:1;cabinets:StoredCabinet[];retired:string[]}
type StockedPart={stock:Record<string,number>};
export const warehouseIds=(w:WarehouseState)=>w.cabinets.flatMap(c=>Object.values(c.leaves));
export function validateWarehouse(w:WarehouseState){
 if(!w||w.schemaVersion!==1||!Array.isArray(w.cabinets)||!w.cabinets.length||!Array.isArray(w.retired))throw Error('invalid warehouse');
 const cabinets=new Set<string>(),refs=new Set<string>(),compartments=new Set<string>();
 for(const c of w.cabinets){validateCabinet(c.layout);if(cabinets.has(c.layout.id)||!c.leaves||typeof c.leaves!=='object')throw Error('duplicate or invalid cabinet');cabinets.add(c.layout.id);
  const own=new Set<string>();for(const cell of c.layout.cells){for(const r of cell.drawer.compartments){const id=Object.hasOwn(c.leaves,r.id)?c.leaves[r.id]:null;if(compartments.has(r.id)||typeof id!=='string'||!id||refs.has(id))throw Error('invalid leaf binding');compartments.add(r.id);own.add(r.id);refs.add(id)}
   if(cell.drawer.compartments.length===1?cell.locationId!==c.leaves[cell.drawer.compartments[0].id]:cell.locationId!==null)throw Error('invalid drawer reference');
  }
  if(Object.keys(c.leaves).some(k=>!own.has(k)))throw Error('extra leaf binding');
 }
 if(new Set(w.retired).size!==w.retired.length||w.retired.some(id=>!id||refs.has(id)))throw Error('invalid retired ID');
}
export function seedWarehouse(cabinets:{id:string;rows:number;cols:number}[]):WarehouseState{
 const w:WarehouseState={schemaVersion:1,retired:[],cabinets:cabinets.map(c=>{
 const layout=newCabinet(c.id,'电子元件柜 '+c.id,{layers:1,rows:c.rows,cols:c.cols},c.id);
 const leaves=Object.fromEntries(layout.cells.map((cell,i)=>[cell.drawer.compartments[0].id,c.id+'-'+String(i+1).padStart(2,'0')]));
 return {layout:{...layout,cells:layout.cells.map(cell=>({...cell,locationId:leaves[cell.drawer.compartments[0].id]}))},leaves};
 })};validateWarehouse(w);return w;
}
export function applyCabinetLayout(w:WarehouseState,draft:CabinetLayout,parts:StockedPart[]):WarehouseState{
 validateWarehouse(w);validateCabinet(draft);const old=w.cabinets.find(c=>c.layout.id===draft.id);
 if(old){
  if(draft.revision<old.layout.revision||draft.dimensions.layers<old.layout.dimensions.layers||draft.dimensions.rows<old.layout.dimensions.rows||draft.dimensions.cols<old.layout.dimensions.cols)throw Error('stale or shrinking layout');
  for(const cell of old.layout.cells){const next=draft.cells.find(c=>c.id===cell.id);if(!next||next.layer!==cell.layer||next.row!==cell.row||next.col!==cell.col)throw Error('existing drawer coordinates must be preserved')}
 }
 const used=new Set([...warehouseIds(w),...w.retired]),leaves:Record<string,string>=Object.create(null),kept=new Set<string>();
 const next=structuredClone(draft);
 for(const cell of next.cells){
  const before=old?.layout.cells.find(c=>c.id===cell.id);
  for(const r of cell.drawer.compartments){
   const existing=old&&Object.hasOwn(old.leaves,r.id)?old.leaves[r.id]:undefined;
   if(existing){const previous=before?.drawer.compartments.find(x=>x.id===r.id);if(!previous||['x','y','width','height'].some(k=>previous[k as keyof typeof previous]!==r[k as keyof typeof r]))throw Error('stable leaf geometry changed');leaves[r.id]=existing;kept.add(existing);continue}
   const base=cell.name+(cell.drawer.compartments.length>1?'-S'+(cell.drawer.compartments.indexOf(r)+1):'');let id=base,n=1;while(used.has(id))id=base+'-'+(++n);used.add(id);leaves[r.id]=id;
  }
  cell.locationId=cell.drawer.compartments.length===1?leaves[cell.drawer.compartments[0].id]:null;
 }
 const retired=Object.values(old?.leaves??{}).filter(id=>!kept.has(id));
 if(parts.some(p=>retired.some(id=>(p.stock[id]??0)>0)))throw Error('有库存的子格必须先完成库存转移');
 next.revision=(old?.layout.revision??-1)+1;
 const c={layout:next,leaves};const result:WarehouseState={schemaVersion:1,cabinets:old?w.cabinets.map(x=>x.layout.id===draft.id?c:x):[...w.cabinets,c],retired:[...w.retired,...retired]};
 validateWarehouse(result);return result;
}
export interface RelocationPart extends StockedPart {id:string;name:string}
export interface RelocationMove {partId:string;sourceId:string;targetId:string;quantity:number}
export function previewCabinetRelocation(w:WarehouseState,draft:CabinetLayout,parts:RelocationPart[]){
 const next=applyCabinetLayout(w,draft,[]),active=new Set(warehouseIds(next));const retiring=warehouseIds(w).filter(id=>!active.has(id));const old=w.cabinets.find(c=>c.layout.id===draft.id);const destination=next.cabinets.find(c=>c.layout.id===draft.id)!;
 const sources=parts.flatMap(p=>retiring.filter(id=>(p.stock[id]??0)>0).map(id=>{const cell=old?.layout.cells.find(c=>c.drawer.compartments.some(r=>old.leaves[r.id]===id));const replacement=destination.layout.cells.find(c=>c.id===cell?.id);return {partId:p.id,partName:p.name,sourceId:id,quantity:p.stock[id],preferred:replacement?.drawer.compartments.map(r=>destination.leaves[r.id])??[]}}));
 return {warehouse:next,sources,targets:[...active],retiring};
}
export function applyCabinetRelocation<T extends RelocationPart>(w:WarehouseState,draft:CabinetLayout,parts:T[],moves:RelocationMove[]){
 if(!Array.isArray(moves))throw Error('无效库存迁移');const preview=previewCabinetRelocation(w,draft,parts),next=structuredClone(parts),active=new Set(preview.targets),retired=new Set(preview.retiring);
 const key=(partId:string,sourceId:string)=>JSON.stringify([partId,sourceId]);const required=new Map(preview.sources.map(s=>[key(s.partId,s.sourceId),s.quantity])),totals=new Map<string,number>(),seen=new Set<string>();
 for(const m of moves){if(!m||typeof m.partId!=='string'||typeof m.sourceId!=='string'||typeof m.targetId!=='string'||!Number.isSafeInteger(m.quantity)||m.quantity<=0||!active.has(m.targetId)||!retired.has(m.sourceId))throw Error('无效迁移目标或数量');const k=key(m.partId,m.sourceId),edge=JSON.stringify([k,m.targetId]);if(seen.has(edge)||!required.has(k))throw Error('重复或未知迁移来源');seen.add(edge);const total=(totals.get(k)??0)+m.quantity;if(!Number.isSafeInteger(total)||total>required.get(k)!)throw Error('迁移数量超出原库存');totals.set(k,total)}
 for(const [k,q] of required)if(totals.get(k)!==q)throw Error('待移除库位的库存必须全部分配');
 for(const p of next)for(const id of retired)delete p.stock[id];
 const occupancy=new Map<string,string>();for(const p of next)for(const [id,q] of Object.entries(p.stock))if(q>0){if(!active.has(id)||occupancy.has(id)&&occupancy.get(id)!==p.id)throw Error('现有库存冲突');occupancy.set(id,p.id)}
 for(const m of moves){const p=next.find(p=>p.id===m.partId)!;if(occupancy.has(m.targetId)&&occupancy.get(m.targetId)!==m.partId)throw Error('目标库位存在不同元件，禁止混装');const q=(p.stock[m.targetId]??0)+m.quantity;if(!Number.isSafeInteger(q))throw Error('迁移数量溢出');p.stock[m.targetId]=q;occupancy.set(m.targetId,m.partId)}
 for(const p of next){const before=parts.find(x=>x.id===p.id)!;const sum=(s:Record<string,number>)=>Object.values(s).reduce((a,b)=>a+BigInt(b),0n);if(sum(before.stock)!==sum(p.stock))throw Error('库存数量不守恒')}
 return {warehouse:preview.warehouse,parts:next};
}
export function planCabinetSave(id:string,instanceId:string,revision:number,w:WarehouseState,draft:CabinetLayout,parts:RelocationPart[],confirmed:boolean,moves:RelocationMove[]=[]):ApprovedPlan{
 if(!confirmed||!id||!instanceId||!Number.isSafeInteger(revision)||revision<0)throw Error('布局确认不完整');
 applyCabinetRelocation(w,draft,parts,moves);
 return {id,instanceId,catalogHash:'warehouse-layout-v1',snapshotHash:String(revision),approvalId:id,operations:[{id:id+':0',kind:'save-demo-cabinet',payload:{draft:structuredClone(draft),expectedRevision:revision,moves:structuredClone(moves)}}]};
}
