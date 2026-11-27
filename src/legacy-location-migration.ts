import {validateCabinet,type CabinetLayout,type ExistingLocation} from './cabinet-layout.js';
import {planCabinetMetadata,readCabinetMetadata,type CabinetMetadata,type LeafBinding} from './cabinet-metadata.js';
import type {ApprovedPlan,Operation} from './operation-journal.js';
import {verifyMigrationStock,type MigrationStockSnapshot} from './migration-stock-evidence.js';
export interface LegacyMigrationInput {rootId:string;layout:CabinetLayout;bindings:LeafBinding[];locations:ExistingLocation[];metadata:Record<string,unknown>}
export interface LegacyRename {locationId:string;parentId:string;from:string;to:string}
export interface LegacyMigrationPreview {rootId:string;renames:LegacyRename[];binding:CabinetMetadata;previousMetadata:Record<string,unknown>;nextMetadata:Record<string,unknown>}
const nonempty=(x:unknown):x is string=>typeof x==='string'&&!!x.trim();
function canonical(value:unknown):string{if(value===null)return 'null';if(typeof value==='string'||typeof value==='boolean'||typeof value==='number'&&Number.isFinite(value))return JSON.stringify(value);if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';if(value&&typeof value==='object'&&(Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null))return '{'+Object.entries(value).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,v])=>JSON.stringify(k)+':'+canonical(v)).join(',')+'}';throw Error('invalid migration evidence')}
const equal=(a:unknown,b:unknown)=>canonical(a)===canonical(b);
const normalized=(name:string)=>name.trim().toLowerCase();
export function previewLegacyMigration(input:LegacyMigrationInput):LegacyMigrationPreview{
 const {rootId,layout,bindings,locations,metadata}=input;validateCabinet(layout);
 if(!nonempty(rootId)||!Array.isArray(bindings)||!Array.isArray(locations)||!metadata||typeof metadata!=='object'||Array.isArray(metadata))throw Error('invalid migration input');
 const locs=new Map(locations.map(l=>[l.id,l]));if(locs.size!==locations.length||locations.some(l=>!nonempty(l.id)||!nonempty(l.name)||typeof l.structural!=='boolean'||l.parentId!==null&&!nonempty(l.parentId)))throw Error('invalid location snapshot');
 const root=locs.get(rootId);if(!root?.structural)throw Error('cabinet root must be structural');
 // Initial legacy binding only. Existing managed cabinets use the revisioned layout editor.
 if(readCabinetMetadata(metadata,locations,rootId)!==null)throw Error('cabinet already has managed metadata');
 const leaves=layout.cells.flatMap(c=>c.drawer.compartments.map((r,i)=>({cell:c,compartmentId:r.id,name:c.name+(c.drawer.compartments.length>1?'-S'+(i+1):'')})));
 if(!leaves.length||new Set(leaves.map(l=>l.compartmentId)).size!==leaves.length||bindings.length!==leaves.length||new Set(bindings.map(b=>b.compartmentId)).size!==bindings.length||new Set(bindings.map(b=>b.locationId)).size!==bindings.length)throw Error('each compartment needs one explicit existing leaf ID');
 const byCompartment=new Map(bindings.map(b=>[b.compartmentId,b.locationId]));const ordered:LeafBinding[]=[],renames:LegacyRename[]=[],targets=new Set<string>();
 for(const leaf of leaves){const locationId=byCompartment.get(leaf.compartmentId),old=locationId?locs.get(locationId):undefined;
  if(!old||old.structural||!old.parentId||locations.some(l=>l.parentId===old.id))throw Error('binding must be an existing storage leaf');
  let p:string|null=old.parentId;const seen=new Set([old.id]);while(p&&p!==rootId){if(seen.has(p))throw Error('cyclic location tree');seen.add(p);p=locs.get(p)?.parentId??null}if(p!==rootId)throw Error('binding outside cabinet root');
  if(leaf.cell.locationId!==null&&(leaf.cell.drawer.compartments.length!==1||leaf.cell.locationId!==old.id))throw Error('existing layout reference conflicts with explicit binding');
  if(!nonempty(leaf.name)||leaf.name.length>128||/[\u0000-\u001f]/.test(leaf.name))throw Error('invalid target name');
  const sibling=JSON.stringify([old.parentId,normalized(leaf.name)]);if(targets.has(sibling)||locations.some(l=>l.id!==old.id&&l.parentId===old.parentId&&normalized(l.name)===normalized(leaf.name)))throw Error('sibling name conflict: '+leaf.name);targets.add(sibling);
  ordered.push({compartmentId:leaf.compartmentId,locationId:old.id});if(old.name!==leaf.name)renames.push({locationId:old.id,parentId:old.parentId,from:old.name,to:leaf.name});
 }
 const bound:CabinetLayout={...structuredClone(layout),revision:0,cells:layout.cells.map(c=>({...structuredClone(c),locationId:c.drawer.compartments.length===1?byCompartment.get(c.drawer.compartments[0].id)!:null}))};
 const binding:CabinetMetadata={schemaVersion:1,revision:0,layout:bound,leafBindings:ordered};
 const nextMetadata=planCabinetMetadata(metadata,binding,null,locations,rootId);
 return {rootId,renames,binding,previousMetadata:structuredClone(metadata),nextMetadata};
}
export function planLegacyMigration(approval:{id:string;instanceId:string;catalogHash:string;snapshotHash:string;approvalId:string;physicalConfirmed:boolean},fresh:LegacyMigrationInput,reviewed:LegacyMigrationPreview):ApprovedPlan{
 if(approval.physicalConfirmed!==true||![approval.id,approval.instanceId,approval.catalogHash,approval.snapshotHash,approval.approvalId].every(nonempty))throw Error('physical mapping approval required');
 const p=previewLegacyMigration(fresh);if(!equal(p,reviewed))throw Error('migration preview is stale');
 const operations:Operation[]=p.renames.map((r,i)=>({id:approval.id+':'+i,kind:'rename-location',payload:{locationId:r.locationId,expectedParentId:r.parentId,expectedName:r.from,name:r.to}}));
 operations.push({id:approval.id+':'+operations.length,kind:'update-location-metadata',payload:{locationId:p.rootId,expectedMetadata:p.previousMetadata,metadata:p.nextMetadata,expectedLeaves:p.binding.leafBindings.map(b=>{const l=fresh.locations.find(x=>x.id===b.locationId)!;return {locationId:l.id,parentId:l.parentId,name:p.renames.find(r=>r.locationId===l.id)?.to??l.name}})}});
 return {id:approval.id,instanceId:approval.instanceId,catalogHash:approval.catalogHash,snapshotHash:approval.snapshotHash,approvalId:approval.approvalId,operations};
}
export function verifyLegacyMigration(preview:LegacyMigrationPreview,before:ExistingLocation[],after:ExistingLocation[],metadata:Record<string,unknown>){
 try{const old=new Map(before.map(l=>[l.id,l])),next=new Map(after.map(l=>[l.id,l]));if(old.size!==before.length||next.size!==after.length||old.size!==next.size||!equal(metadata,preview.nextMetadata))return false;
 for(const [id,l] of old){const r=next.get(id),change=preview.renames.find(x=>x.locationId===id);if(!r||r.parentId!==l.parentId||r.structural!==l.structural||r.name!==(change?.to??l.name))return false}
 return equal(readCabinetMetadata(metadata,after,preview.rootId),preview.binding);
 }catch{return false}
}

// Full software readback requires both layout integrity and exact StockItem conservation.
export function verifyLegacyMigrationWithStock(preview:LegacyMigrationPreview,before:ExistingLocation[],after:ExistingLocation[],metadata:Record<string,unknown>,stockBefore:MigrationStockSnapshot,stockAfter:MigrationStockSnapshot){
 return verifyLegacyMigration(preview,before,after,metadata)&&verifyMigrationStock(stockBefore,stockAfter,new Set(before.map(l=>l.id)),new Set(after.map(l=>l.id)));
}
