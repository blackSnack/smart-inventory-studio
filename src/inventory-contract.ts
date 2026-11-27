import type {InventoryReadPort,InventoryCapabilities,PartSummary,LocationSummary,StockDistribution} from './inventory-provider.js';
import type {ApprovedPlan,OperationTransport,Operation} from './operation-journal.js';
export interface CategoryRef {id:string;name:string;parentId:string|null}
export interface ParameterTemplateRef {id:string;name:string;unit:string|null;type:string}
export interface ParameterValueRef {templateId:string;value:string|null}
export interface SourceRef {kind:'manufacturer'|'supplier'|'datasheet'|'image'|'other';url:string;label:string}
export interface PartRecord extends PartSummary {parameters:ParameterValueRef[];sources:SourceRef[];manufacturerParts:{manufacturer:string;mpn:string}[];supplierParts:{supplier:string;sku:string}[]}
export interface CatalogReadPort {getPart(id:string):Promise<PartRecord>;getCategories():Promise<CategoryRef[]>;getParameterTemplates(categoryId:string):Promise<ParameterTemplateRef[]>}
export interface MetadataReadPort {getLocationMetadata(locationId:string):Promise<Record<string,unknown>>}
export interface SearchParameterTemplate {id:string;name:string;unit:string|null}
export interface SearchParameterValue {partId:string;templateId:string;value:string|null}
export interface ParameterSearchPort {probe():Promise<SearchParameterTemplate[]>;values(templateId:string):Promise<SearchParameterValue[]>}
export type InventoryFeature='read'|'partDetails'|'categories'|'parameterTemplates'|'metadata'|'write'|'stockTransfer';
export interface InventoryFeatureSet extends InventoryCapabilities {partDetails?:boolean;categories?:boolean;operationKinds?:readonly string[]}
export const SYNTHETIC_OPERATION_KINDS=['receive-existing-part','create-demo-part-and-receive','create-demo-catalog-part','save-demo-cabinet','enrich-demo-part','rename-demo-locations'] as const;
export const PROVIDER_OPERATION_KINDS=['receive-existing-part','create-part','create-category','create-parameter-template','set-part-parameter','set-part-source','create-location','rename-location','update-location-metadata','transfer-stock'] as const;
const supportedKinds=new Set<string>([...SYNTHETIC_OPERATION_KINDS,...PROVIDER_OPERATION_KINDS]);
// Object-key order is irrelevant; array order and exact scalar values are not.
function canonical(value:unknown):string{if(value===null)return 'null';if(typeof value==='string'||typeof value==='boolean'||typeof value==='number'&&Number.isFinite(value))return JSON.stringify(value);if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';if(value&&typeof value==='object'&&(Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null)){const entries=Object.entries(value).filter(([,v])=>v!==undefined);return '{'+entries.sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,v])=>JSON.stringify(k)+':'+canonical(v)).join(',')+'}'}throw Error('invalid operation payload')}
export class UnsupportedInventoryOperation extends Error{constructor(public kind:string){super('Unsupported inventory operation: '+kind);this.name='UnsupportedInventoryOperation'}}
export interface InventoryPorts {instanceId:string;read:InventoryReadPort;catalog?:CatalogReadPort;metadata?:MetadataReadPort;parameterSearch?:ParameterSearchPort;operations?:OperationTransport;capabilities():Promise<InventoryFeatureSet>}
export class UnsupportedInventoryCapability extends Error{constructor(public feature:InventoryFeature){super('Unsupported inventory capability: '+feature);this.name='UnsupportedInventoryCapability'}}
export class InventorySession{
 constructor(private ports:InventoryPorts){if(!ports.instanceId.trim())throw Error('inventory instance required')}
 get instanceId(){return this.ports.instanceId}
 getCapabilities(){return this.ports.capabilities()}
 async searchParts(q:string):Promise<PartSummary[]>{await this.require('read');return this.ports.read.searchParts(q)}
 async getStockByPart(id:string):Promise<StockDistribution[]>{await this.require('read');return this.ports.read.getStockByPart(id)}
 async getLocations():Promise<LocationSummary[]>{await this.require('read');return this.ports.read.getLocations()}
 async probeParameterSearch(){await this.require('read');if(!this.ports.parameterSearch)throw new UnsupportedInventoryCapability('parameterTemplates');return this.ports.parameterSearch.probe()}
 async getSearchParameterValues(templateId:string){await this.require('read');if(!this.ports.parameterSearch)throw new UnsupportedInventoryCapability('parameterTemplates');return this.ports.parameterSearch.values(templateId)}
 async getPart(id:string){await this.require('partDetails');if(!this.ports.catalog)throw new UnsupportedInventoryCapability('partDetails');return this.ports.catalog.getPart(id)}
 async getCategories(){await this.require('categories');if(!this.ports.catalog)throw new UnsupportedInventoryCapability('categories');return this.ports.catalog.getCategories()}
 async getParameterTemplates(id:string){await this.require('parameterTemplates');if(!this.ports.catalog)throw new UnsupportedInventoryCapability('parameterTemplates');return this.ports.catalog.getParameterTemplates(id)}
 async getLocationMetadata(id:string){await this.require('metadata');if(!this.ports.metadata)throw new UnsupportedInventoryCapability('metadata');return this.ports.metadata.getLocationMetadata(id)}
 async operationTransport(plan:ApprovedPlan):Promise<OperationTransport>{
  plan=structuredClone(plan);
  if(plan.instanceId!==this.instanceId)throw Error('wrong inventory instance');
  if(![plan.id,plan.catalogHash,plan.snapshotHash,plan.approvalId].every(v=>typeof v==='string'&&v.trim())||!Array.isArray(plan.operations)||!plan.operations.length||new Set(plan.operations.map(o=>o.id)).size!==plan.operations.length||plan.operations.some(o=>!o.id||!o.kind))throw Error('invalid approved plan');
  const approved=new Map(plan.operations.map(o=>[o.id,canonical(o)]));
  const checked=async(operation:Operation,write:boolean)=>{if(approved.get(operation.id)!==canonical(operation))throw Error('operation outside approved plan');const caps=await this.ports.capabilities();if(!supportedKinds.has(operation.kind)||!caps.operationKinds?.includes(operation.kind))throw new UnsupportedInventoryOperation(operation.kind);if(write&&caps.write!==true)throw new UnsupportedInventoryCapability('write');if(operation.kind==='transfer-stock'&&caps.stockTransfer!==true)throw new UnsupportedInventoryCapability('stockTransfer');if(operation.kind==='update-location-metadata'&&caps.metadata!==true)throw new UnsupportedInventoryCapability('metadata');if(operation.kind==='create-parameter-template'&&caps.parameterTemplates!==true)throw new UnsupportedInventoryCapability('parameterTemplates');};
  if(!this.ports.operations)throw new UnsupportedInventoryCapability('write');const transport=this.ports.operations;
  for(const operation of plan.operations)await checked(operation,true);
  return {send:async operation=>{const snapshot=structuredClone(operation);await checked(snapshot,true);await transport.send(snapshot)},observe:async operation=>{const snapshot=structuredClone(operation);await checked(snapshot,false);return transport.observe(snapshot)}};
 }
 // Recovery is readback-only: revocation of write permission must not cause a blind replay.
 async observationTransport(plan:ApprovedPlan):Promise<OperationTransport>{
  if(plan.instanceId!==this.instanceId)throw Error('wrong inventory instance');const transport=this.ports.operations;if(!transport)throw new UnsupportedInventoryCapability('write');
  if(!Array.isArray(plan.operations)||!plan.operations.length||!plan.approvalId||new Set(plan.operations.map(o=>o.id)).size!==plan.operations.length)throw Error('invalid approved plan');
  const approved=new Map(plan.operations.map(o=>[o.id,canonical(o)]));
  return {send:async()=>{throw Error('readback only')},observe:async op=>{if(approved.get(op.id)!==canonical(op))throw Error('operation outside approved plan');if(!supportedKinds.has(op.kind))throw new UnsupportedInventoryOperation(op.kind);return transport.observe(structuredClone(op))}};
 }
 private async require(feature:InventoryFeature){const c=await this.ports.capabilities();if(c[feature]!==true)throw new UnsupportedInventoryCapability(feature)}
}
