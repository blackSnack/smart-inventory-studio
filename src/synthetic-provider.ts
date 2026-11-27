import {InventorySession,SYNTHETIC_OPERATION_KINDS,type InventoryPorts,type InventoryFeatureSet,type PartRecord,type CatalogReadPort,type MetadataReadPort} from './inventory-contract.js';
import type {InventoryReadPort,PartSummary,LocationSummary,StockDistribution} from './inventory-provider.js';
import type {Catalog} from './catalog.js';
import {demoIdentity,type DraftPart} from './demo-part-draft.js';
import {searchReceiptParts} from './receipt-search.js';
import {locationName} from './warehouse-state.js';
import type {SyntheticInventoryStore,DemoSnapshot} from './synthetic-inventory.js';
import {DEMO_INSTANCE} from './synthetic-inventory.js';
type Source=Pick<SyntheticInventoryStore,'snapshot'|'send'|'observe'>;
const summary=(p:DraftPart):PartSummary=>({id:p.id,name:p.name,ipn:null,description:p.spec,categoryId:demoIdentity(p)?.category??null});
function record(p:DraftPart,catalog:Catalog):PartRecord{
 const identity=demoIdentity(p),d=p.details?.draft,category=catalog.categories.find(c=>c.key===identity?.category);
 const sources:PartRecord['sources']=[];if(d?.datasheetUrl)sources.push({kind:'datasheet',url:d.datasheetUrl,label:'Datasheet'});if(d?.imageUrl)sources.push({kind:'image',url:d.imageUrl,label:'Image'});for(const url of new Set(d?.sourceUrls??[]))if(!sources.some(s=>s.url===url))sources.push({kind:'other',url,label:'Source'});
 return {...summary(p),parameters:(category?.parameters??[]).map(templateId=>({templateId,value:identity?.fields[templateId]??null})),sources,manufacturerParts:identity?.manufacturer&&identity.mpn?[{manufacturer:identity.manufacturer,mpn:identity.mpn}]:[],supplierParts:identity?.supplier&&identity.sku?[{supplier:identity.supplier,sku:identity.sku}]:[]}
}
export function createSyntheticSession(source:Source,catalog:Catalog,fallbackIds:readonly string[],instanceId=DEMO_INSTANCE){
 const capabilities=async():Promise<InventoryFeatureSet>=>({read:true,write:true,partDetails:true,categories:true,parameterTemplates:true,metadata:true,stockTransfer:false,operationKinds:[...SYNTHETIC_OPERATION_KINDS]});
 const part=(s:DemoSnapshot,id:string)=>{const p=s.parts.find(x=>x.id===id);if(!p)throw Error('part not found');return p};
 const read:InventoryReadPort={getCapabilities:capabilities,searchParts:async q=>{const s=await source.snapshot();return searchReceiptParts(s.parts,q,s.warehouse?.names).map(summary)},getStockByPart:async id=>{const p=part(await source.snapshot(),id);return Object.entries(p.stock).map(([locationId,q]):StockDistribution=>({partId:id,locationId,quantity:String(q),stockItemIds:['synthetic:'+JSON.stringify([id,locationId])]}))},getLocations:async()=>{const s=await source.snapshot();const w=s.warehouse;if(!w)return fallbackIds.map(id=>({id,name:id,parentId:null,structural:false}));return w.cabinets.flatMap(c=>{const id='synthetic-cabinet:'+c.layout.id;return [{id,name:c.layout.name,parentId:null,structural:true},...Object.values(c.leaves).map(locationId=>({id:locationId,name:locationName(w,locationId),parentId:id,structural:false}))] as LocationSummary[]})}};
 const catalogRead:CatalogReadPort={getPart:async id=>record(part(await source.snapshot(),id),catalog),getCategories:async()=>catalog.categories.map(c=>({id:c.key,name:c.labelZh??c.key,parentId:null})),getParameterTemplates:async id=>{const c=catalog.categories.find(x=>x.key===id);if(!c)throw Error('category not found');return c.parameters.map(k=>({id:k,name:catalog.fieldDefinitions[k].labelZh,unit:catalog.fieldDefinitions[k].unit,type:catalog.fieldDefinitions[k].type}))}};
 const metadata:MetadataReadPort={getLocationMetadata:async id=>{const s=await source.snapshot();const c=s.warehouse?.cabinets.find(x=>'synthetic-cabinet:'+x.layout.id===id);if(c)return {layout:structuredClone(c.layout)};if(s.warehouse?.cabinets.some(x=>Object.values(x.leaves).includes(id))||!s.warehouse&&fallbackIds.includes(id))return {};throw Error('location not found')}};
 const ports:InventoryPorts={instanceId,read,catalog:catalogRead,metadata,operations:source,capabilities};
 return new InventorySession(ports)
}
