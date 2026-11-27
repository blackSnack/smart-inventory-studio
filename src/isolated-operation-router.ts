import {PROVIDER_OPERATION_KINDS,UnsupportedInventoryOperation,type InventoryFeatureSet} from './inventory-contract.js';
import {IsolatedLocationTransport} from './isolated-location-transport.js';
import {IsolatedLocationCreateTransport} from './isolated-location-create.js';
import {IsolatedStockTransferTransport} from './isolated-stock-transfer.js';
import {IsolatedStockReceiptTransport} from './isolated-stock-receipt.js';
import {IsolatedPartCreateTransport} from './isolated-part-create.js';
import {IsolatedTemplateSyncTransport} from './isolated-template-sync.js';
import {IsolatedParameterWriteTransport} from './isolated-parameter-write.js';
import {IsolatedSourceLinkTransport} from './isolated-source-link.js';
import type {Operation,OperationTransport} from './operation-journal.js';
type Kind=typeof PROVIDER_OPERATION_KINDS[number];
type Config={base:string;token:string;fixtureOnly:true;metadataModel?:string};
export class IsolatedOperationRouter implements OperationTransport{
 private constructor(private routes:ReadonlyMap<string,OperationTransport>){}
 static async open(config:Config,kinds:readonly Kind[],request:typeof fetch){
  const cfg={...config},selected=[...kinds];
  const base=new URL(cfg.base);if(cfg.fixtureOnly!==true||base.protocol!=='https:'||!base.hostname.endsWith('.test')||base.username||base.password||base.search||base.hash||!cfg.token.trim()||typeof request!=='function')throw Error('isolated fixture configuration required');
  if(!selected.length||new Set(selected).size!==selected.length||selected.some(k=>!PROVIDER_OPERATION_KINDS.includes(k)))throw Error('invalid fixture operation selection');
  const groups:{kinds:Kind[];open:()=>Promise<OperationTransport>}[]=[
   {kinds:['receive-existing-part'],open:()=>IsolatedStockReceiptTransport.open(cfg,request)},
   {kinds:['create-part'],open:()=>IsolatedPartCreateTransport.open(cfg,request)},
   {kinds:['create-category','create-parameter-template'],open:()=>IsolatedTemplateSyncTransport.open(cfg,request)},
   {kinds:['set-part-parameter'],open:()=>IsolatedParameterWriteTransport.open(cfg,request)},
   {kinds:['set-part-source'],open:()=>IsolatedSourceLinkTransport.open(cfg,request)},
   {kinds:['create-location'],open:()=>IsolatedLocationCreateTransport.open(cfg,request)},
   {kinds:['rename-location','update-location-metadata'],open:()=>IsolatedLocationTransport.open({...cfg,metadataModel:cfg.metadataModel??''},request)},
   {kinds:['transfer-stock'],open:()=>IsolatedStockTransferTransport.open(cfg,request)}
  ];
  const entries=await Promise.all(groups.filter(g=>g.kinds.some(k=>selected.includes(k))).map(async g=>{const t=await g.open();return g.kinds.filter(k=>selected.includes(k)).map(k=>[k,t] as const)}));
  return new IsolatedOperationRouter(new Map(entries.flat()));
 }
 // This describes only the explicitly selected, schema-probed fixture routes.
 // It is not a real service permission probe; callers retain the InventorySession approval gate.
 fixtureCapabilities():InventoryFeatureSet{
  return {read:true,write:true,metadata:this.routes.has('update-location-metadata'),parameterTemplates:this.routes.has('create-parameter-template'),stockTransfer:this.routes.has('transfer-stock'),operationKinds:[...this.routes.keys()]};
 }
 private route(operation:Operation){const t=this.routes.get(operation.kind);if(!t)throw new UnsupportedInventoryOperation(operation.kind);return t}
 async send(operation:Operation){const snapshot=structuredClone(operation);await this.route(snapshot).send(snapshot)}
 async observe(operation:Operation){const snapshot=structuredClone(operation);return this.route(snapshot).observe(snapshot)}
}
