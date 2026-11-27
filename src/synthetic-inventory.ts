import {applyPartEnrichment,type EnrichmentApproval} from './part-enrichment.js';import {validateCatalog} from './catalog.js';
import {applyCabinetLayout,validateWarehouse,warehouseIds,type WarehouseState} from './warehouse-state.js';import type {CabinetLayout} from './cabinet-layout.js';
import {demoIdentity,strongIdentity,type DemoPartDetails} from './demo-part-draft.js';
import {validateAllocation,type Location} from './domain.js';
import type {Operation,OperationTransport,Observation} from './operation-journal.js';
export interface DemoPart {id:string;name:string;spec:string;partial:boolean;stock:Record<string,number>;details?:DemoPartDetails}
interface Receipt {operation:Operation;receiptId:string}
export interface DemoSnapshot {revision:number;parts:DemoPart[];receipts:Receipt[];warehouse?:WarehouseState}
const STORE='inventory',KEY='synthetic';
export const DEMO_INSTANCE='studio-synthetic-v1';
export function demoLocations(parts:DemoPart[],ids:string[]):Location[]{return ids.map(id=>({id,name:id,structural:false,occupants:parts.filter(p=>(p.stock[id]??0)>0).map(p=>p.id).sort()}))}
function validate(state:DemoSnapshot,ids:string[]){if(state?.warehouse){validateWarehouse(state.warehouse);ids=warehouseIds(state.warehouse)}if(!state||!Number.isSafeInteger(state.revision)||state.revision<0||!Array.isArray(state.parts)||!Array.isArray(state.receipts)||new Set(state.parts.map(p=>p.id)).size!==state.parts.length||new Set(state.receipts.map(r=>r.operation.id)).size!==state.receipts.length)throw Error('invalid synthetic snapshot');for(const p of state.parts){if(!p.id||!p.name||!p.stock||Object.entries(p.stock).some(([k,q])=>!ids.includes(k)||!Number.isSafeInteger(q)||q<0))throw Error('invalid synthetic stock')}if(demoLocations(state.parts,ids).some(l=>l.occupants.length>1))throw Error('synthetic inventory is mixed')}
const equal=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
export class SyntheticInventoryStore implements OperationTransport{
 private constructor(private db:IDBDatabase,private ids:string[]){}
 static async open(seed:DemoPart[],ids:string[],databaseName='smart-inventory-studio-demo-v1',factory:IDBFactory=indexedDB,warehouse?:WarehouseState):Promise<SyntheticInventoryStore>{
  if(!ids.length||new Set(ids).size!==ids.length||ids.some(i=>!i))throw Error('invalid synthetic locations');const initial:DemoSnapshot={revision:0,parts:structuredClone(seed),receipts:[],...(warehouse?{warehouse:structuredClone(warehouse)}:{})};validate(initial,ids);
  const db=await new Promise<IDBDatabase>((resolve,reject)=>{const r=factory.open(databaseName,1);r.onupgradeneeded=()=>r.result.createObjectStore(STORE);r.onerror=()=>reject(r.error);r.onblocked=()=>reject(Error('synthetic database blocked'));r.onsuccess=()=>{r.result.onversionchange=()=>r.result.close();resolve(r.result)}});
  const provider=new SyntheticInventoryStore(db,[...ids]);try{await provider.transaction(state=>{if(state){validate(state,ids);if(warehouse&&!state.warehouse){const next={...state,warehouse:structuredClone(warehouse)};validate(next,ids);return {next,value:undefined}}return {value:undefined}}return {next:initial,value:undefined}},true);return provider}catch(e){provider.close();throw e}
 }
 close(){this.db.close()}
 private transaction<T>(change:(state:DemoSnapshot|undefined)=>{next?:DemoSnapshot;value:T},write=false):Promise<T>{
  return new Promise((resolve,reject)=>{const tx=this.db.transaction(STORE,write?'readwrite':'readonly'),store=tx.objectStore(STORE),req=store.get(KEY);let value:T;let cause:unknown;tx.oncomplete=()=>resolve(value);tx.onabort=()=>reject(cause??tx.error??Error('synthetic transaction aborted'));req.onsuccess=()=>{try{const result=change(req.result as DemoSnapshot|undefined);value=result.value;if(result.next){validate(result.next,this.ids);store.put(result.next,KEY)}}catch(e){cause=e;tx.abort()}}})
 }
 async snapshot(){return this.transaction(state=>{if(!state)throw Error('missing synthetic inventory');validate(state,this.ids);return {value:state}})}
 async send(operation:Operation):Promise<void>{
  return this.transaction(state=>{if(!state)throw Error('missing synthetic inventory');validate(state,this.ids);if(!['receive-existing-part','create-demo-part-and-receive','create-demo-catalog-part','save-demo-cabinet','enrich-demo-part'].includes(operation.kind)||!operation.id)throw Error('unsupported synthetic operation');
   const previous=state.receipts.find(r=>r.operation.id===operation.id);if(previous){if(!equal(previous.operation,operation))throw Error('operation identity conflict');return {value:undefined}}
   if(state.receipts.length>=20000)throw Error('synthetic receipt log limit');
   if(operation.kind==='enrich-demo-part'){const {approval,catalog,expectedRevision}=operation.payload;if(expectedRevision!==state.revision||!approval||typeof approval!=='object')throw Error('stale enrichment approval');const a=approval as EnrichmentApproval,idx=state.parts.findIndex(p=>p.id===a.partId);if(idx<0)throw Error('part missing');state.parts[idx]=applyPartEnrichment(state.parts[idx],validateCatalog(catalog),a,state.parts);state.revision++;state.receipts.push({operation:structuredClone(operation),receiptId:'demo-receipt:'+operation.id});return {next:state,value:undefined}}
   if(operation.kind==='save-demo-cabinet'){const {draft,expectedRevision}=operation.payload;if(!state.warehouse||expectedRevision!==state.revision||!draft||typeof draft!=='object')throw Error('stale layout approval');state.warehouse=applyCabinetLayout(state.warehouse,draft as CabinetLayout,state.parts);const allowed=new Set(warehouseIds(state.warehouse));for(const p of state.parts)for(const id of Object.keys(p.stock))if(!allowed.has(id)&&p.stock[id]===0)delete p.stock[id];state.revision++;state.receipts.push({operation:structuredClone(operation),receiptId:'demo-receipt:'+operation.id});return {next:state,value:undefined}}
   if(operation.kind==='create-demo-part-and-receive'||operation.kind==='create-demo-catalog-part'){
    const {part,quantity,allocations,expectedRevision}=operation.payload;
    if(!part||typeof part!=='object'||expectedRevision!==state.revision||operation.kind==='create-demo-part-and-receive'&&(!Array.isArray(allocations)||typeof quantity!=='number'))throw Error('stale or invalid new part plan');
    const p=structuredClone(part) as DemoPart;const identity=p.details?.identity;
    if(!p.id||!p.name?.trim()||!identity||identity.id!==p.id||!['exact','partial'].includes(identity.mode)||Object.keys(p.stock??{}).length||state.parts.some(x=>x.id===p.id||!!demoIdentity(x)&&strongIdentity(identity,demoIdentity(x)!)))throw Error('duplicate or invalid new part identity');
    p.stock={};if(operation.kind==='create-demo-part-and-receive'){if(typeof quantity!=='number'||!Array.isArray(allocations))throw Error('invalid receipt');validateAllocation(p.id,quantity,allocations,demoLocations(state.parts,state.warehouse?warehouseIds(state.warehouse):this.ids));for(const a of allocations)p.stock[a.locationId]=a.quantity;}
    state.parts.push(p);state.revision++;state.receipts.push({operation:structuredClone(operation),receiptId:'demo-receipt:'+operation.id});return {next:state,value:undefined};
   }
   const {partId,locationId,quantity,expectedOccupants}=operation.payload;if(typeof partId!=='string'||typeof locationId!=='string'||typeof quantity!=='number'||!Array.isArray(expectedOccupants)||expectedOccupants.some(x=>typeof x!=='string'))throw Error('invalid receipt operation');
   const part=state.parts.find(p=>p.id===partId),locations=demoLocations(state.parts,state.warehouse?warehouseIds(state.warehouse):this.ids),location=locations.find(l=>l.id===locationId);if(!part||!location||!equal(location.occupants,[...expectedOccupants].sort()))throw Error('stale occupancy');
   validateAllocation(partId,quantity,[{locationId,quantity}],locations);
   const nextQty=(part.stock[locationId]??0)+quantity;if(!Number.isSafeInteger(nextQty))throw Error('quantity overflow');
   part.stock[locationId]=nextQty;state.revision++;state.receipts.push({operation:structuredClone(operation),receiptId:'demo-receipt:'+operation.id});return {next:state,value:undefined};
  },true)
 }
 async observe(operation:Operation):Promise<Observation>{const state=await this.snapshot(),r=state.receipts.find(x=>x.operation.id===operation.id);if(!r)return {status:'unknown',evidence:'No matching atomic synthetic receipt; do not replay automatically'};if(!equal(r.operation,operation))return {status:'blocked',evidence:'Synthetic operation ID collision'};return {status:'verified',evidence:r.receiptId}}
}
