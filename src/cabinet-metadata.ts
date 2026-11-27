import {validateCabinet,type CabinetLayout} from './cabinet-layout.js';
export interface LeafBinding {compartmentId:string;locationId:string}
export interface CabinetMetadata {schemaVersion:1;revision:number;layout:CabinetLayout;leafBindings:LeafBinding[]}
export interface RemoteLocation {id:string;parentId:string|null;structural:boolean}
const obj=(x:unknown):x is Record<string,unknown>=>!!x&&typeof x==='object'&&!Array.isArray(x);
export function validateCabinetMetadata(m:CabinetMetadata,locations:RemoteLocation[],rootId:string){
 if(m.schemaVersion!==1||m.revision!==m.layout.revision||!Array.isArray(m.leafBindings))throw Error('invalid metadata revision');
 validateCabinet(m.layout);const byId=new Map(locations.map(l=>[l.id,l]));if(byId.size!==locations.length||byId.get(rootId)?.structural!==true)throw Error('invalid cabinet root or location tree');
 const all=m.layout.cells.flatMap(c=>c.drawer.compartments.map(s=>s.id));if(new Set(all).size!==all.length)throw Error('duplicate compartment ID');
 const compartmentIds=new Set(all),ids=new Set<string>(),refs=new Set<string>();
 for(const b of m.leafBindings){const l=byId.get(b.locationId);if(!compartmentIds.has(b.compartmentId)||ids.has(b.compartmentId)||refs.has(b.locationId)||!l||l.structural||locations.some(x=>x.parentId===l.id))throw Error('invalid leaf binding');
 let p=l.parentId;const seen=new Set([l.id]);while(p&&p!==rootId){if(seen.has(p))throw Error('cyclic location tree');seen.add(p);p=byId.get(p)?.parentId??null}if(p!==rootId)throw Error('binding outside cabinet root');ids.add(b.compartmentId);refs.add(b.locationId)}
 // A non-null cell-level reference is the whole-drawer leaf, not another
 // independent mapping. Unbound cells and partially bound layouts remain valid.
 const bindingByCompartment=new Map(m.leafBindings.map(b=>[b.compartmentId,b.locationId]));
 for(const cell of m.layout.cells){if(cell.locationId!==null&&(cell.drawer.compartments.length!==1||bindingByCompartment.get(cell.drawer.compartments[0].id)!==cell.locationId))throw Error('cell reference conflicts with compartment binding')}
}
export function readCabinetMetadata(raw:Record<string,unknown>,locations:RemoteLocation[],rootId:string):CabinetMetadata|null{
 const ns=raw.smart_inventory;if(ns===undefined)return null;if(!obj(ns))throw Error('invalid metadata namespace');if(ns.cabinet===undefined)return null;
 const m=ns.cabinet as CabinetMetadata;validateCabinetMetadata(m,locations,rootId);return structuredClone(m);
}
export function planCabinetMetadata(raw:Record<string,unknown>,next:CabinetMetadata,expectedRevision:number|null,locations:RemoteLocation[],rootId:string){
 const previous=readCabinetMetadata(raw,locations,rootId);if((previous?.revision??null)!==expectedRevision||next.revision!==(expectedRevision===null?0:expectedRevision+1))throw Error('stale cabinet metadata');validateCabinetMetadata(next,locations,rootId);
 return {...raw,smart_inventory:{...((raw.smart_inventory??{}) as Record<string,unknown>),cabinet:structuredClone(next)}};
}
