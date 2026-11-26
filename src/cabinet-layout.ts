import {planExpansion,type Cell} from './domain.js';
import {validateDrawer,type Drawer} from './storage-layout.js';
export interface Dimensions {layers:number;rows:number;cols:number}
export interface CabinetCell extends Cell {locationId:string|null;drawer:Drawer}
export interface CabinetLayout {schemaVersion:1;id:string;name:string;revision:number;dimensions:Dimensions;cells:CabinetCell[]}
export interface ExistingLocation {id:string;name:string;parentId:string|null;structural:boolean}
export interface Binding {cellId:string;locationId:string}
const nonempty=(s:string)=>typeof s==='string'&&s.trim().length>0;
const coordinate=(c:Pick<Cell,'layer'|'row'|'col'>)=>c.layer+'/'+c.row+'/'+c.col;
function nameFor(prefix:string,c:Pick<Cell,'layer'|'row'|'col'>){return prefix+'-L'+(c.layer+1)+'-R'+(c.row+1)+'-C'+(c.col+1)}
function makeCell(id:string,c:Omit<Cell,'id'>,name:string):CabinetCell {
 const cellId=id+':'+coordinate(c);
 return {...c,id:cellId,name,locationId:null,drawer:{id:cellId,width:12,height:12,revision:0,compartments:[{id:cellId+':whole',x:0,y:0,width:12,height:12}]}};
}
export function validateCabinet(c:CabinetLayout):void{
 if(c.schemaVersion!==1||!nonempty(c.id)||!nonempty(c.name)||!Number.isSafeInteger(c.revision)||c.revision<0)throw Error('invalid cabinet');
 planExpansion(c.cells,c.dimensions);
 const refs=new Set<string>();
 for(const x of c.cells){if(!nonempty(x.id)||!nonempty(x.name)||x.drawer.id!==x.id)throw Error('invalid cell identity');validateDrawer(x.drawer);
  if(x.locationId!==null){if(!nonempty(x.locationId)||refs.has(x.locationId))throw Error('duplicate location binding');refs.add(x.locationId)}
 }
}
export function newCabinet(id:string,name:string,dims:Dimensions,prefix:string):CabinetLayout{
 if(!nonempty(prefix))throw Error('missing naming prefix');
 const cells=planExpansion([],dims).create.map(c=>makeCell(id,c,nameFor(prefix,c)));
 const next:CabinetLayout={schemaVersion:1,id,name,revision:0,dimensions:{...dims},cells};validateCabinet(next);return next;
}
export function expandCabinet(layout:CabinetLayout,dims:Dimensions,prefix:string):CabinetLayout{
 validateCabinet(layout);if(!nonempty(prefix)||dims.layers<layout.dimensions.layers||dims.rows<layout.dimensions.rows||dims.cols<layout.dimensions.cols)throw Error('cannot shrink cabinet');
 const p=planExpansion(layout.cells,dims),names=new Set(layout.cells.map(c=>c.name));
 const created=p.create.map(c=>{const base=nameFor(prefix,c);let name=base,n=1;while(names.has(name))name=base+'-'+(++n);names.add(name);return makeCell(layout.id,c,name)});
 const next={...layout,revision:layout.revision+1,dimensions:{...dims},cells:[...layout.cells,...created]};validateCabinet(next);return next;
}
export function bindLocations(layout:CabinetLayout,bindings:Binding[],existing:ExistingLocation[]):CabinetLayout{
 validateCabinet(layout);const ids=new Set<string>(),refs=new Set(layout.cells.flatMap(c=>c.locationId?[c.locationId]:[])),mapping=new Map<string,string>();
 for(const b of bindings){const cell=layout.cells.find(c=>c.id===b.cellId),matches=existing.filter(l=>l.id===b.locationId);
  if(!cell||cell.locationId!==null||ids.has(b.cellId)||refs.has(b.locationId)||matches.length!==1||matches[0].structural||existing.some(l=>l.parentId===b.locationId))throw Error('invalid or duplicate leaf binding');
  ids.add(b.cellId);refs.add(b.locationId);mapping.set(b.cellId,b.locationId);
 }
 const next={...layout,revision:layout.revision+1,cells:layout.cells.map(c=>({...c,locationId:mapping.get(c.id)??c.locationId}))};validateCabinet(next);return next;
}
export function planRenames(layout:CabinetLayout,existing:ExistingLocation[]){
 validateCabinet(layout);const current=new Map(existing.map(l=>[l.id,l]));if(current.size!==existing.length)throw Error('duplicate existing location ID');
 const changes=layout.cells.flatMap(c=>{if(c.locationId===null)return [];const old=current.get(c.locationId);if(!old)throw Error('bound location missing');return old.name===c.name?[]:[{locationId:old.id,parentId:old.parentId,from:old.name,to:c.name}]});
 // Conservative: overlapping sibling names, including swaps, require a separate reviewed migration.
 for(const change of changes)if(existing.some(l=>l.id!==change.locationId&&l.parentId===change.parentId&&l.name===change.to))throw Error('target name already exists');
 return changes;
}
export function replaceDrawer(layout:CabinetLayout,cellId:string,drawer:Drawer):CabinetLayout{
 validateCabinet(layout);const cell=layout.cells.find(c=>c.id===cellId);
 if(!cell||drawer.id!==cellId||drawer.revision!==cell.drawer.revision+1)throw Error('stale drawer');
 const next={...layout,revision:layout.revision+1,cells:layout.cells.map(c=>c.id===cellId?{...c,drawer}:c)};validateCabinet(next);return next;
}
export function layoutSummary(layout:CabinetLayout){
 validateCabinet(layout);return {physical:layout.dimensions.layers*layout.dimensions.rows*layout.dimensions.cols,defined:layout.cells.length,bound:layout.cells.filter(c=>c.locationId!==null).length,unbound:layout.cells.filter(c=>c.locationId===null).length,compartments:layout.cells.reduce((s,c)=>s+c.drawer.compartments.length,0)};
}
