import {probeSchema} from './provider-schema.js';
import {InvenTreeReadAdapter,type LocationSummary} from './inventory-provider.js';
import {readCabinetMetadata,type CabinetMetadata} from './cabinet-metadata.js';
import type {MetadataReadPort} from './inventory-contract.js';
const obj=(x:unknown):x is Record<string,unknown>=>!!x&&typeof x==='object'&&!Array.isArray(x);
const validId=(x:string)=>typeof x==='string'&&/^[1-9][0-9]{0,17}$/.test(x);
export class InvenTreeMetadataReadAdapter implements MetadataReadPort{
 private constructor(private base:URL,private token:string,private model:string,private request:typeof fetch,private locations:InvenTreeReadAdapter,private legacy:boolean){}
 static async open(config:{base:string;token:string;locationModel:string},request:typeof fetch){
  const {base,token,locationModel}=config;
  if(typeof locationModel!=='string'||!(/^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)?$/.test(locationModel)))throw Error('explicit location metadata model required');
  const b=new URL(base.endsWith('/')?base:base+'/');
  const e=await probeSchema(b.href,token,[{key:'location-list',path:'/api/stock/location/',method:'get'},{key:'location-metadata',path:'/api/metadata/{model}/{id}/',method:'get'},{key:'legacy-metadata',path:'/api/stock/location/{id}/metadata/',method:'get'},{key:'legacy-metadata-pk',path:'/api/stock/location/{pk}/metadata/',method:'get'}],request);
  const declared=(key:string)=>e.operations.some(o=>o.key===key&&o.declared);
  const modern=declared('location-metadata'),legacy=!modern&&(declared('legacy-metadata')||declared('legacy-metadata-pk'))&&['stocklocation','stock.stocklocation'].includes(locationModel);
  if(!declared('location-list')||(!modern&&!legacy))throw Error('location metadata API not declared');
  return new InvenTreeMetadataReadAdapter(b,token,locationModel,request,new InvenTreeReadAdapter(b.href,token,request),legacy);
 }
 private async read(locationId:string,locations:LocationSummary[]):Promise<Record<string,unknown>>{
  if(!validId(locationId)||!locations.some(l=>l.id===locationId))throw Error('unknown location ID');
  const response=await this.request(new URL(this.legacy?'api/stock/location/'+locationId+'/metadata/':'api/metadata/'+this.model+'/'+locationId+'/',this.base),{method:'GET',headers:{Authorization:'Token '+this.token,Accept:'application/json'},cache:'no-store',redirect:'error',signal:AbortSignal.timeout(20000)});
  if(!response.ok)throw Error('metadata HTTP '+response.status);
  const raw=await response.text();if(raw.length>4*1024*1024)throw Error('metadata response too large');const data:unknown=JSON.parse(raw);
  if(!obj(data)||!obj(data.metadata))throw Error('invalid location metadata response');
  // The actual server's route/model and permissions must be verified; do not treat an error as empty metadata.
  return structuredClone(data.metadata);
 }
 async getLocationMetadata(locationId:string):Promise<Record<string,unknown>>{
  if(!validId(locationId))throw Error('invalid location ID');
  return this.read(locationId,await this.locations.getLocations());
 }
 async getCabinet(locationId:string):Promise<CabinetMetadata|null>{
  if(!validId(locationId))throw Error('invalid location ID');
  const locations=await this.locations.getLocations();
  if(!locations.some(l=>l.id===locationId&&l.structural))throw Error('unknown structural cabinet root');
  return readCabinetMetadata(await this.read(locationId,locations),locations,locationId);
 }
}
