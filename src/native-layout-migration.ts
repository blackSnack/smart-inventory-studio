import {validateCabinet, type CabinetLayout,type ExistingLocation} from './cabinet-layout.js';
import {readCabinetMetadata,planCabinetMetadata,type LeafBinding} from './cabinet-metadata.js';
import {receiptId,receiptDecimal} from './receipt-stock-baseline.js';
import {retiredLocationName,isRetiredLocationName} from './native-retired-location.js';
import type {BrowserWorkStore,NativeQueueItem,NativeWorkInput} from './browser-native-workflow.js';
type Row=Record<string,unknown>;
export type LocationRef={locationId:string}|{createId:string;name:string;parentId:string};
export type LayoutMove={stockItemId:string;targetCompartmentId:string;quantity:string};
type Prior={operationId:string;target:LocationRef;quantity:string};
type LinkedRow={stock:Row;location:LocationRef;priorMove?:string};
export type NativeLayoutQueueItem={id:string;kind:'cabinet-transfer';sourceId:string;stock:Row;target:LocationRef;quantity:string;prior:Prior[];linked?:LinkedRow[]}|{id:string;kind:'cabinet-finalize';rootId:string;expectedMetadata:Row;layout:CabinetLayout;bindings:{compartmentId:string;ref:LocationRef}[];retiring:string[]};
const obj=(x:unknown):Row=>{if(!x||typeof x!=='object'||Array.isArray(x))throw Error('invalid migration record');return x as Row};
export function nativeLocationTree(rows:unknown[]):ExistingLocation[]{return rows.map(x=>{const r=obj(x);if(typeof r.name!=='string'||typeof r.structural!=='boolean')throw Error('invalid native location');return {id:receiptId(r.pk),name:r.name,parentId:r.parent===null?null:receiptId(r.parent),structural:r.structural}})}
function under(tree:ExistingLocation[],id:string,root:string){
 let x=tree.find(r=>r.id===id);const seen=new Set<string>();
 while(x?.parentId){if(seen.has(x.id))throw Error('cyclic locations');seen.add(x.id);if(x.parentId===root)return true;x=tree.find(r=>r.id===x!.parentId)}
 return false;
}
export function cabinetEligibleLeaves(tree:ExistingLocation[],root:string){return tree.filter(x=>!x.structural&&!isRetiredLocationName(x.name)&&!tree.some(y=>y.parentId===x.id)&&under(tree,x.id,root))}
const decimal=(x:unknown)=>receiptDecimal(x);
function sub(a:string,b:string){const [i,f='']=a.split('.'),[j,g='']=b.split('.'),scale=Math.max(f.length,g.length),n=BigInt(i+f.padEnd(scale,'0'))-BigInt(j+g.padEnd(scale,'0'));if(n<0n)throw Error('stock allocation exceeds source');const s=n.toString().padStart(scale+1,'0');return decimal(scale?s.slice(0,-scale)+'.'+s.slice(-scale):s)}
const nativeOp=(id:string,kind:string,payload:Row):NativeWorkInput=>({id,kind:'operation',payload:{id,kind,payload}});
export function nativeLayoutMigration(input:{rootId:string;expectedMetadata:Row;layout:CabinetLayout;tree:ExistingLocation[];bindings:Record<string,string>;stocks:Record<string,unknown[]>;moves:LayoutMove[]},uid:()=>string):NativeQueueItem[]{
 const {rootId,expectedMetadata,layout,tree,bindings,stocks,moves}=structuredClone(input);
 validateCabinet(layout);const root=tree.find(x=>x.id===rootId),old=readCabinetMetadata(expectedMetadata,tree,rootId);
 if(!root?.structural||new Set(tree.map(x=>x.id)).size!==tree.length)throw Error('invalid cabinet root');
 if(old&&(layout.id!==old.layout.id||old.layout.cells.some(c=>!layout.cells.some(n=>n.id===c.id&&n.layer===c.layer&&n.row===c.row&&n.col===c.col))))throw Error('cabinet coordinates changed');
 const all=layout.cells.flatMap(c=>c.drawer.compartments.map((r,i)=>({cell:c,compartmentId:r.id,index:i})));
 if(new Set(all.map(x=>x.compartmentId)).size!==all.length||Object.keys(bindings).length!==all.length||all.some(x=>!Object.hasOwn(bindings,x.compartmentId)))throw Error('bind every compartment');
 const eligible=cabinetEligibleLeaves(tree,rootId),used=new Set<string>(),names=new Set(tree.filter(x=>x.parentId===rootId).map(x=>x.name.trim().toLowerCase())),ops:NativeQueueItem[]=[],refs:{compartmentId:string;ref:LocationRef}[]=[];
 for(const a of all){const choice=bindings[a.compartmentId];
  if(choice==='@new'){
   const base=a.cell.name+(a.cell.drawer.compartments.length>1?'-S'+(a.index+1):'');let name=base,n=1;while(names.has(name.trim().toLowerCase()))name=base+'-'+(++n);
   if(name.length>128||!name.trim()||isRetiredLocationName(name))throw Error('invalid new leaf name');names.add(name.toLowerCase());const createId=uid();ops.push(nativeOp(createId,'create-location',{expectedAbsent:true,physicalConfirmed:true,parentId:root.id,parentName:root.name,name,description:'Studio cabinet compartment',structural:false}));refs.push({compartmentId:a.compartmentId,ref:{createId,name,parentId:root.id}});
  }else{if(!eligible.some(x=>x.id===choice)||used.has(choice))throw Error('invalid or duplicate target leaf');used.add(choice);refs.push({compartmentId:a.compartmentId,ref:{locationId:choice}})}
 }
 const oldIds=new Set(old?.leafBindings.map(x=>x.locationId)??[]),retiring=[...oldIds].filter(id=>!used.has(id)),required=new Set([...oldIds,...used]),rows:Row[]=[],seen=new Set<string>();
 for(const id of required){if(!Object.hasOwn(stocks,id)||!Array.isArray(stocks[id]))throw Error('complete visible stock snapshot required');for(const raw of stocks[id]){const x=obj(raw),key=receiptId(x.pk);if(seen.has(key)||receiptId(x.location)!==id)throw Error('invalid stock snapshot');receiptId(x.part);decimal(x.quantity);seen.add(key);rows.push(x)}}
 const occupancy=new Map<string,Set<string>>();for(const id of used)occupancy.set(id,new Set(rows.filter(x=>String(x.location)===id).map(x=>String(x.part))));
 const remaining=new Map<string,string>(),priors=new Map<string,Prior[]>(),edges=new Set<string>(),projected=new Map<string,LinkedRow>(rows.map(x=>[String(x.pk),{stock:x,location:{locationId:String(x.location)}}]));
 const family=(stock:Row)=>{const index=new Map(rows.map(x=>[String(x.pk),x]));let root=stock;const seen=new Set<string>();while(root.parent!==null){if(seen.has(String(root.pk)))throw Error('cyclic stock lineage');seen.add(String(root.pk));const p=index.get(receiptId(root.parent));if(!p)throw Error('linked parent outside reviewed cabinet');root=p}const group:Row[]=[],visit=(x:Row)=>{if(group.some(y=>y.pk===x.pk))throw Error('cyclic linked stock');group.push(x);const children=rows.filter(y=>y.parent!==null&&String(y.parent)===String(x.pk));if(String(children.length)!==decimal(x.child_items))throw Error('linked child outside reviewed cabinet');for(const c of children)visit(c)};visit(root);if(group.some(x=>String(x.part)!==String(stock.part)))throw Error('mixed linked stock identity');return group.map(x=>structuredClone(projected.get(String(x.pk))!))};
 for(const x of rows)remaining.set(String(x.pk),decimal(x.quantity));
 for(const m of moves){
  const stock=rows.find(x=>String(x.pk)===m.stockItemId),ref=refs.find(x=>x.compartmentId===m.targetCompartmentId)?.ref,q=decimal(m.quantity);
  if(!stock||!ref||!oldIds.has(String(stock.location))||q==='0'||'locationId'in ref&&ref.locationId===String(stock.location))throw Error('invalid migration move');
  const edge=JSON.stringify([m.stockItemId,m.targetCompartmentId]);if(edges.has(edge))throw Error('duplicate stock destination');edges.add(edge);
  const target='locationId'in ref?ref.locationId:'new:'+ref.createId,part=String(stock.part),o=occupancy.get(target)??new Set<string>();o.add(part);if(o.size!==1)throw Error('mixed target stock');occupancy.set(target,o);
  const before=remaining.get(m.stockItemId)!,after=sub(before,q),prior=priors.get(m.stockItemId)??[];
  const linked=stock.parent!==null||decimal(stock.child_items)!=='0'?family(stock):undefined;
  if(linked&&(after!=='0'||prior.length)||decimal(stock.allocated)!=='0'||String(stock.status)!=='10'||stock.in_stock!==true||stock.is_building!==false||stock.customer!==null||stock.belongs_to!==null||stock.consumed_by!==null||stock.sales_order!==null||decimal(stock.installed_items)!=='0'||after!=='0'&&stock.serial!==null&&String(stock.serial).trim())throw Error('stock lifecycle or serial restriction');
  remaining.set(m.stockItemId,after);const id=uid();ops.push({id,kind:'cabinet-transfer',sourceId:String(stock.location),stock,target:ref,quantity:q,prior:structuredClone(prior),...(linked?{linked}:{})});
  if(after==='0')projected.set(m.stockItemId,{stock,location:ref,priorMove:id});
  if(after!=='0')priors.set(m.stockItemId,[...prior,{operationId:id,target:ref,quantity:q}]);
 }
 for(const x of rows.filter(x=>retiring.includes(String(x.location))))if(decimal(x.quantity)==='0'||remaining.get(String(x.pk))!=='0')throw Error('retiring leaf must have every stock record moved');
 for(const id of retiring){const loc=tree.find(x=>x.id===id);if(!loc||!loc.parentId||isRetiredLocationName(loc.name))throw Error('invalid retiring leaf');ops.push(nativeOp(uid(),'rename-location',{locationId:id,expectedParentId:loc.parentId,expectedName:loc.name,name:retiredLocationName(id),retireConfirmed:true}))}
 const revision=old?old.revision+1:0;ops.push({id:uid(),kind:'cabinet-finalize',rootId,expectedMetadata,layout:{...layout,revision},bindings:refs,retiring});
 if(ops.length>1000)throw Error('migration exceeds queue capacity');return ops;
}
async function resolveRef(ref:LocationRef,scope:string,store:Pick<BrowserWorkStore,'get'>){
 if('locationId'in ref)return receiptId(ref.locationId);
 const r=await store.get(scope,ref.createId);
 if(!r||r.state!=='verified'||r.preparation.scope!==scope||r.preparation.input.kind!=='operation'||r.preparation.input.payload.kind!=='create-location'||r.preparation.input.payload.payload.name!==ref.name||r.preparation.input.payload.payload.parentId!==ref.parentId||r.preparation.input.payload.payload.structural!==false||!r.ackBinding)throw Error('new leaf not verified');
 return receiptId(obj(r.ack).id);
}
export function layoutDependencies(item:NativeQueueItem):string[]{
 const refs=(r:LocationRef)=>'createId'in r?[r.createId]:[];
 if(item.kind==='cabinet-transfer')return [...refs(item.target),...item.prior.flatMap(p=>[p.operationId,...refs(p.target)]),...(item.linked??[]).flatMap(x=>[...refs(x.location),...(x.priorMove?[x.priorMove]:[])])];
 if(item.kind==='cabinet-finalize')return item.bindings.flatMap(b=>refs(b.ref));
 return [];
}
export async function resolveNativeLayoutItem(item:NativeLayoutQueueItem,scope:string,store:Pick<BrowserWorkStore,'get'>,tree?:ExistingLocation[]):Promise<NativeWorkInput>{
 if(item.kind==='cabinet-transfer'){
  const targetId=await resolveRef(item.target,scope,store),splits=[];
  for(const p of item.prior){const r=await store.get(scope,p.operationId),locationId=await resolveRef(p.target,scope,store);if(!r||r.state!=='verified'||r.preparation.scope!==scope||r.preparation.input.kind!=='operation'||r.preparation.input.payload.kind!=='transfer-stock'||r.preparation.input.payload.payload.stockItemId!==String(item.stock.pk)||r.preparation.input.payload.payload.sourceId!==item.sourceId||r.preparation.input.payload.payload.targetId!==locationId||r.preparation.input.payload.payload.quantity!==p.quantity||!r.ackBinding)throw Error('preceding stock split unverified');splits.push({locationId,quantity:p.quantity})}
  const linkedExpected:Row[]=[];
  for(const x of item.linked??[]){const locationId=await resolveRef(x.location,scope,store);if(x.priorMove){const r=await store.get(scope,x.priorMove);if(!r||r.state!=='verified'||r.preparation.scope!==scope||r.preparation.input.kind!=='operation'||r.preparation.input.payload.kind!=='transfer-stock'||r.preparation.input.payload.payload.stockItemId!==String(x.stock.pk)||r.preparation.input.payload.payload.targetId!==locationId||!r.ackBinding)throw Error('preceding linked move not verified')}linkedExpected.push({...x.stock,location:Number(locationId)})}
  return nativeOp(item.id,'transfer-stock',{physicalConfirmed:true,sourceId:item.sourceId,targetId,stockItemId:String(item.stock.pk),partId:String(item.stock.part),quantity:item.quantity,splitConfirmed:true,...(splits.length?{continuation:{original:item.stock,splits}}:{reviewedStock:item.stock}),...(item.linked?{linkedExpected}:{})});
 }
 if(!tree)throw Error('fresh location tree required');const leafBindings:LeafBinding[]=[];
 for(const b of item.bindings){const locationId=await resolveRef(b.ref,scope,store);if(!cabinetEligibleLeaves(tree,item.rootId).some(x=>x.id===locationId))throw Error('target leaf changed');leafBindings.push({compartmentId:b.compartmentId,locationId})}
 const next={...item.layout,cells:item.layout.cells.map(c=>({...c,locationId:c.drawer.compartments.length===1?leafBindings.find(b=>b.compartmentId===c.drawer.compartments[0].id)!.locationId:null}))},previous=readCabinetMetadata(item.expectedMetadata,tree,item.rootId);
 if(item.retiring.some(id=>!tree.some(x=>x.id===id&&x.name===retiredLocationName(id))))throw Error('retired leaf is not archived');
 const metadata=planCabinetMetadata(item.expectedMetadata,{schemaVersion:1,revision:next.revision,layout:next,leafBindings},previous?.revision??null,tree,item.rootId);
 return nativeOp(item.id,'update-location-metadata',{locationId:item.rootId,expectedMetadata:item.expectedMetadata,metadata,expectedLeaves:leafBindings.map(b=>{const x=tree.find(r=>r.id===b.locationId)!;return {locationId:x.id,parentId:x.parentId,name:x.name}}),retiringLocationIds:item.retiring});
}
