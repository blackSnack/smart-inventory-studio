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
  const own=new Set<string>();for(const cell of c.layout.cells){for(const r of cell.drawer.compartments){const id=c.leaves[r.id];if(compartments.has(r.id)||!id||refs.has(id))throw Error('invalid leaf binding');compartments.add(r.id);own.add(r.id);refs.add(id)}
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
   const existing=old?.leaves[r.id];
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
export function planCabinetSave(id:string,instanceId:string,revision:number,w:WarehouseState,draft:CabinetLayout,parts:StockedPart[],confirmed:boolean):ApprovedPlan{
 if(!confirmed||!id||!instanceId||!Number.isSafeInteger(revision)||revision<0)throw Error('布局确认不完整');
 applyCabinetLayout(w,draft,parts);
 return {id,instanceId,catalogHash:'warehouse-layout-v1',snapshotHash:String(revision),approvalId:id,operations:[{id:id+':0',kind:'save-demo-cabinet',payload:{draft:structuredClone(draft),expectedRevision:revision}}]};
}
