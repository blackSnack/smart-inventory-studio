import type {InventoryReadPort,InventoryCapabilities,PartSummary,LocationSummary,StockDistribution} from './inventory-provider.js';
import type {ApprovedPlan,OperationTransport} from './operation-journal.js';
export interface CategoryRef {id:string;name:string;parentId:string|null}
export interface ParameterTemplateRef {id:string;name:string;unit:string|null;type:string}
export interface ParameterValueRef {templateId:string;value:string|null}
export interface SourceRef {kind:'manufacturer'|'supplier'|'datasheet'|'image'|'other';url:string;label:string}
export interface PartRecord extends PartSummary {parameters:ParameterValueRef[];sources:SourceRef[];manufacturerParts:{manufacturer:string;mpn:string}[];supplierParts:{supplier:string;sku:string}[]}
export interface CatalogReadPort {getPart(id:string):Promise<PartRecord>;getCategories():Promise<CategoryRef[]>;getParameterTemplates(categoryId:string):Promise<ParameterTemplateRef[]>}
export interface MetadataReadPort {getLocationMetadata(locationId:string):Promise<Record<string,unknown>>}
export type InventoryFeature='partDetails'|'categories'|'parameterTemplates'|'metadata'|'write'|'stockTransfer';
export interface InventoryFeatureSet extends InventoryCapabilities {partDetails?:boolean;categories?:boolean}
export interface InventoryPorts {instanceId:string;read:InventoryReadPort;catalog?:CatalogReadPort;metadata?:MetadataReadPort;operations?:OperationTransport;capabilities():Promise<InventoryFeatureSet>}
export class UnsupportedInventoryCapability extends Error{constructor(public feature:InventoryFeature){super('Unsupported inventory capability: '+feature);this.name='UnsupportedInventoryCapability'}}
export class InventorySession{
 constructor(private ports:InventoryPorts){if(!ports.instanceId.trim())throw Error('inventory instance required')}
 get instanceId(){return this.ports.instanceId}
 searchParts(q:string):Promise<PartSummary[]>{return this.ports.read.searchParts(q)}
 getStockByPart(id:string):Promise<StockDistribution[]>{return this.ports.read.getStockByPart(id)}
 getLocations():Promise<LocationSummary[]>{return this.ports.read.getLocations()}
 async getPart(id:string){await this.require('partDetails');if(!this.ports.catalog)throw new UnsupportedInventoryCapability('partDetails');return this.ports.catalog.getPart(id)}
 async getCategories(){await this.require('categories');if(!this.ports.catalog)throw new UnsupportedInventoryCapability('categories');return this.ports.catalog.getCategories()}
 async getParameterTemplates(id:string){await this.require('parameterTemplates');if(!this.ports.catalog)throw new UnsupportedInventoryCapability('parameterTemplates');return this.ports.catalog.getParameterTemplates(id)}
 async getLocationMetadata(id:string){await this.require('metadata');if(!this.ports.metadata)throw new UnsupportedInventoryCapability('metadata');return this.ports.metadata.getLocationMetadata(id)}
 async operationTransport(plan:ApprovedPlan){if(plan.instanceId!==this.instanceId)throw Error('wrong inventory instance');await this.require('write');if(plan.operations.some(o=>o.kind==='transfer-stock'))await this.require('stockTransfer');if(plan.operations.some(o=>o.kind==='update-location-metadata'))await this.require('metadata');if(plan.operations.some(o=>o.kind==='create-parameter-template'))await this.require('parameterTemplates');if(!this.ports.operations)throw new UnsupportedInventoryCapability('write');return this.ports.operations}
 private async require(feature:InventoryFeature){const c=await this.ports.capabilities();if(c[feature]!==true)throw new UnsupportedInventoryCapability(feature)}
}
