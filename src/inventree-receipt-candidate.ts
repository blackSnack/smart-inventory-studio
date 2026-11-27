import {isRetiredLocationName} from './native-retired-location.js';
import {InvenTreeReadProvider,validateAllocation,type Allocation,type Location} from './domain.js';
import {InvenTreeReadAdapter} from './inventory-provider.js';
import {probeSchema} from './provider-schema.js';
import {receiptId,nativeReceiptStock,type ReceiptStockBaseline} from './receipt-stock-baseline.js';
import {snapshotKey} from './approved-snapshot.js';

export interface ReceiptCandidateInput {partId:string;quantity:number;allocations:Allocation[]}
const row=(x:unknown):Record<string,unknown>=>{if(!x||typeof x!=='object'||Array.isArray(x))throw Error('invalid receipt Part');return x as Record<string,unknown>};
const nonblank=(x:unknown):x is string=>typeof x==='string'&&!!x.trim()&&x.length<=4000;
function selection(input:ReceiptCandidateInput){
 const r=structuredClone(input);
 if(!r||receiptId(r.partId)!==r.partId||!Number.isSafeInteger(r.quantity)||r.quantity<=0||!Array.isArray(r.allocations)||!r.allocations.length||r.allocations.length>100)throw Error('invalid receipt selection');
 const seen=new Set<string>();let sum=0;
 for(const a of r.allocations){
  if(receiptId(a.locationId)!==a.locationId||seen.has(a.locationId)||!Number.isSafeInteger(a.quantity)||a.quantity<=0||!Number.isSafeInteger(sum+a.quantity))throw Error('invalid allocation');
  seen.add(a.locationId);sum+=a.quantity;
 }
 if(sum!==r.quantity)throw Error('quantity mismatch');
 return r;
}
export class InvenTreeReceiptCandidateReader{
 private constructor(private base:URL,private token:string,private request:typeof fetch,private read:InvenTreeReadProvider,private locations:InvenTreeReadAdapter){}
 static async open(base:string,token:string,request:typeof fetch=fetch){
  const u=new URL(base.endsWith('/')?base:base+'/');
  const required=['/api/part/{id}/','/api/stock/location/','/api/stock/'];
  const check=await probeSchema(u.href,token,required.map(path=>({key:path,path,method:'get'})),request);
  if(check.operations.some(o=>!o.declared))throw Error('receipt read API not declared');
  return new InvenTreeReceiptCandidateReader(u,token,request,new InvenTreeReadProvider(u.href,token,request),new InvenTreeReadAdapter(u.href,token,request));
 }
 private async snapshot(input:ReceiptCandidateInput){
  const res=await this.request(new URL('api/part/'+input.partId+'/',this.base),{method:'GET',headers:{Authorization:'Token '+this.token,Accept:'application/json'},cache:'no-store',redirect:'error',signal:AbortSignal.timeout(20000)});
  if(!res.ok)throw Error('receipt Part read failed');
  const r=row(await res.json());
  if(receiptId(r.pk)!==input.partId||r.active!==true||r.trackable!==false||r.virtual!==false||!nonblank(r.name)||!(r.IPN===null||typeof r.IPN==='string'&&r.IPN.length<=4000)||!Object.hasOwn(r,'category'))throw Error('unsupported or incomplete receipt Part');
  const part={id:input.partId,name:r.name,ipn:r.IPN,categoryId:r.category===null?null:receiptId(r.category),active:true,trackable:false,virtual:false};
  const tree=await this.locations.getLocations();
  const byLocation:Record<string,ReceiptStockBaseline[]>=Object.create(null),selected:Location[]=[],paths:Record<string,{id:string;name:string;parentId:string|null;structural:boolean}[]>=Object.create(null);
  const stockIds=new Set<string>();
  for(const a of input.allocations){
   const leaf=tree.find(l=>l.id===a.locationId);
   if(!leaf||leaf.structural||isRetiredLocationName(leaf.name)||tree.some(l=>l.parentId===leaf.id))throw Error('not a storage leaf');
   const path=[];let current:typeof leaf|undefined=leaf;
   while(current){receiptId(current.id);if(!nonblank(current.name))throw Error('invalid location name');path.unshift(current);current=current.parentId===null?undefined:tree.find(l=>l.id===current!.parentId)}
   paths[a.locationId]=path;
   const stock=nativeReceiptStock(await this.read.list('api/stock/',{location:a.locationId,cascade:'false'}),a.locationId);
   for(const s of stock){if(stockIds.has(s.id)||s.partId!==input.partId)throw Error('mixed or duplicate stock baseline');stockIds.add(s.id)}
   byLocation[a.locationId]=stock;
   selected.push({id:leaf.id,name:leaf.name,structural:false,occupants:[...new Set(stock.filter(s=>s.quantity!=='0').map(s=>s.partId))]});
  }
  validateAllocation(input.partId,input.quantity,input.allocations,selected);
  return {part,locations:selected,paths,byLocation};
 }
 // No approval ID, executable plan, write capability or physical confirmation is produced.
 async readCandidate(instanceId:string,raw:ReceiptCandidateInput){
  if(!nonblank(instanceId))throw Error('inventory instance required');
  const input=selection(raw),first=await this.snapshot(input),second=await this.snapshot(input);
  if(snapshotKey(first)!==snapshotKey(second))throw Error('receipt baseline changed');
  return {instanceId,input,...first,status:'stable-visible-candidate' as const,baselineComplete:false as const,requiresVisibilityReview:true as const,requiresIdentityAndPhysicalReview:true as const,executionAllowed:false as const};
 }
 async recheck(candidate:Awaited<ReturnType<InvenTreeReceiptCandidateReader['readCandidate']>>){
  const previous=structuredClone(candidate);
  const fresh=await this.readCandidate(previous.instanceId,previous.input);
  if(snapshotKey(previous)!==snapshotKey(fresh))throw Error('receipt candidate changed; review again');
  return fresh;
 }
}
