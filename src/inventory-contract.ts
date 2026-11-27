import {snapshotKey} from './approved-snapshot.js';
import type {InventoryReadPort,InventoryCapabilities,PartSummary,LocationSummary,StockDistribution} from './inventory-provider.js';
import type {ApprovedPlan,OperationTransport,Operation} from './operation-journal.js';
export interface CategoryRef {id:string;name:string;parentId:string|null}
export interface ParameterTemplateRef {id:string;name:string;unit:string|null;type:string}
export interface ParameterValueRef {templateId:string;value:string|null;template?:{name:string;unit:string|null}}
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
const nonblank=(v:unknown):v is string=>typeof v==='string'&&!!v.trim();
function checkedPlan(plan:ApprovedPlan,instanceId:string):ApprovedPlan{
 const p=structuredClone(plan);
 if(!p||p.instanceId!==instanceId)throw Error('wrong inventory instance');
 if(![p.id,p.instanceId,p.catalogHash,p.snapshotHash,p.approvalId].every(nonblank)||!Array.isArray(p.operations)||!p.operations.length||p.operations.some(o=>!o||!nonblank(o.id)||!nonblank(o.kind)||!o.payload||typeof o.payload!=='object'||Array.isArray(o.payload)||(Object.getPrototypeOf(o.payload)!==Object.prototype&&Object.getPrototypeOf(o.payload)!==null))||new Set(p.operations.map(o=>o.id)).size!==p.operations.length)throw Error('invalid approved plan');
 snapshotKey(p);return p;
}
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
  plan=checkedPlan(plan,this.instanceId);
  const approved=new Map(plan.operations.map(o=>[o.id,snapshotKey(o)]));
  const checked=async(operation:Operation,write:boolean)=>{if(approved.get(operation.id)!==snapshotKey(operation))throw Error('operation outside approved plan');const caps=await this.ports.capabilities();if(!supportedKinds.has(operation.kind)||!caps.operationKinds?.includes(operation.kind))throw new UnsupportedInventoryOperation(operation.kind);if(write&&caps.write!==true)throw new UnsupportedInventoryCapability('write');if(operation.kind==='transfer-stock'&&caps.stockTransfer!==true)throw new UnsupportedInventoryCapability('stockTransfer');if(operation.kind==='update-location-metadata'&&caps.metadata!==true)throw new UnsupportedInventoryCapability('metadata');if(operation.kind==='create-parameter-template'&&caps.parameterTemplates!==true)throw new UnsupportedInventoryCapability('parameterTemplates');};
  if(!this.ports.operations)throw new UnsupportedInventoryCapability('write');const transport=this.ports.operations;
  for(const operation of plan.operations)await checked(operation,true);
  return {send:async operation=>{const snapshot=structuredClone(operation);await checked(snapshot,true);await transport.send(snapshot)},observe:async operation=>{const snapshot=structuredClone(operation);await checked(snapshot,false);return transport.observe(snapshot)}};
 }
 // Recovery is readback-only: revocation of write permission must not cause a blind replay.
 async observationTransport(plan:ApprovedPlan):Promise<OperationTransport>{
  plan=checkedPlan(plan,this.instanceId);const transport=this.ports.operations;if(!transport)throw new UnsupportedInventoryCapability('write');
  const approved=new Map(plan.operations.map(o=>[o.id,snapshotKey(o)]));
  return {send:async()=>{throw Error('readback only')},observe:async op=>{const snapshot=structuredClone(op);if(approved.get(snapshot.id)!==snapshotKey(snapshot))throw Error('operation outside approved plan');if(!supportedKinds.has(snapshot.kind))throw new UnsupportedInventoryOperation(snapshot.kind);return transport.observe(snapshot)}};
 }
 private async require(feature:InventoryFeature){const c=await this.ports.capabilities();if(c[feature]!==true)throw new UnsupportedInventoryCapability(feature)}
}
