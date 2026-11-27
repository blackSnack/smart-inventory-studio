import {fixtureEvidenceFor,type FixtureEvidenceConfig,type FixtureEvidenceStore} from './fixture-operation-evidence.js';
import {probeSchema} from './provider-schema.js';
import {InvenTreeReadProvider} from './domain.js';
import {InvenTreeReadAdapter} from './inventory-provider.js';
import {snapshotKey} from './approved-snapshot.js';
import type {ApprovedPlan,Operation,OperationTransport,Observation} from './operation-journal.js';
import {receiptId as id,receiptDecimal as decimal,receiptStockBaseline as list,nativeReceiptStock,type ReceiptStockBaseline as Stock} from './receipt-stock-baseline.js';
const object=(x:unknown):Record<string,unknown>=>{if(!x||typeof x!=='object'||Array.isArray(x))throw Error('invalid receipt record');return x as Record<string,unknown>};
function parse(o:Operation){
 if(o.kind!=='receive-existing-part'||!o.id.trim())throw Error('unsupported receipt operation');
 const p=o.payload,partId=id(p.partId),locationId=id(p.locationId),quantity=p.quantity;
 if(typeof quantity!=='number'||!Number.isSafeInteger(quantity)||quantity<=0||!Array.isArray(p.expectedOccupants)||p.expectedOccupants.some(x=>id(x)!==partId)||p.expectedRevision!==undefined)throw Error('invalid isolated receipt approval');
 const baseline=list(p.expectedStock,locationId);if(baseline.some(x=>x.partId!==partId))throw Error('mixed stock baseline');
 const expected=[...new Set(p.expectedOccupants)].sort(),actual=[...new Set(baseline.filter(x=>x.quantity!=='0').map(x=>x.partId))].sort();
 if(snapshotKey(expected)!==snapshotKey(actual))throw Error('occupancy baseline mismatch');
 return {partId,locationId,quantity,baseline};
}
// Add exact per-leaf snapshots before review; the caller must use a complete isolated baseline.
export function bindIsolatedReceiptBaseline(plan:ApprovedPlan,byLocation:Record<string,Stock[]>):ApprovedPlan{
 const next=structuredClone(plan);
 for(const o of next.operations){if(typeof o.payload.locationId!=='string'||!Object.hasOwn(byLocation,o.payload.locationId))throw Error('missing approved stock baseline');o.payload.expectedStock=structuredClone(byLocation[o.payload.locationId]);parse(o)}
 return next;
}
export class IsolatedStockReceiptTransport implements OperationTransport{

 private constructor(private evidence:FixtureEvidenceStore,private base:URL,private token:string,private request:typeof fetch,private transport:InvenTreeReadProvider,private locations:InvenTreeReadAdapter){}
 static async open(config:{base:string;token:string;fixtureOnly:true}&FixtureEvidenceConfig,request:typeof fetch){
  const evidence=fixtureEvidenceFor(config);const b=new URL(config.base.endsWith('/')?config.base:config.base+'/');if(config.fixtureOnly!==true||b.protocol!=='https:'||!b.hostname.endsWith('.test')||b.username||b.password||b.search||b.hash||!config.token.trim())throw Error('isolated fixture configuration required');
  const e=await probeSchema(b.href,config.token,[{key:'part',path:'/api/part/{id}/',method:'get'},{key:'locations',path:'/api/stock/location/',method:'get'},{key:'stock-read',path:'/api/stock/',method:'get'},{key:'stock-create',path:'/api/stock/',method:'post'}],request);
  if(e.operations.some(o=>!o.declared))throw Error('receipt API not declared');
  return new IsolatedStockReceiptTransport(evidence,b,config.token,request,new InvenTreeReadProvider(b.href,config.token,request),new InvenTreeReadAdapter(b.href,config.token,request));
 }
 private async call(path:string,method:'GET'|'POST',body?:Record<string,unknown>){
  const r=await this.request(new URL(path,this.base),{method,headers:{Authorization:'Token '+this.token,Accept:'application/json',...(body?{'Content-Type':'application/json'}:{})},redirect:'error',cache:'no-store',signal:AbortSignal.timeout(20000),...(body?{body:JSON.stringify(body)}:{})});
  if(!r.ok)throw Error('receipt HTTP '+r.status);const data:unknown=await r.json();
  if(method==='POST'){if(!Array.isArray(data)||data.length!==1)throw Error('expected exactly one created StockItem');return object(data[0])}
  return object(data);
 }
 private async current(p:ReturnType<typeof parse>){
  const part=await this.call('api/part/'+p.partId+'/','GET');if(id(part.pk)!==p.partId||part.active!==true||part.trackable!==false||part.virtual!==false)throw Error('unsupported receipt part');
  const locations=await this.locations.getLocations(),leaf=locations.find(x=>x.id===p.locationId);if(!leaf||leaf.structural||locations.some(x=>x.parentId===leaf.id))throw Error('receipt leaf changed');
  const raw=await this.transport.list('api/stock/',{location:p.locationId,cascade:'false'});
  return nativeReceiptStock(raw,p.locationId);
 }
 async send(o:Operation){
  const snapshot=structuredClone(o),p=parse(snapshot),key=snapshotKey(snapshot);if(!await this.evidence.claim(snapshot))throw Error('receipt already attempted; readback only');
  if(snapshotKey(await this.current(p))!==snapshotKey(p.baseline))throw Error('stock baseline changed');
  const result=await this.call('api/stock/','POST',{part:Number(p.partId),location:Number(p.locationId),quantity:p.quantity});
  const stockId=id(result.pk);if(p.baseline.some(x=>x.id===stockId)||id(result.part)!==p.partId||id(result.location)!==p.locationId||decimal(result.quantity)!==String(p.quantity))throw Error('receipt acknowledgement mismatch');
  await this.evidence.record(snapshot,{key,stockId});
 }
 async observe(o:Operation):Promise<Observation>{try{
  const snapshot=structuredClone(o),p=parse(snapshot),ack=await this.evidence.read<{key:string;stockId:string}>(snapshot),current=await this.current(p);
  if(!ack||ack.key!==snapshotKey(snapshot))return {status:'unknown',evidence:'Fixture: no correlated create acknowledgement; matching stock alone is not proof; do not replay'};
  const created=current.find(x=>x.id===ack.stockId),previous=current.filter(x=>x.id!==ack.stockId);
  if(!created)return {status:'unknown',evidence:'Fixture: acknowledged stock ID not visible'};
  if(created.partId!==p.partId||created.quantity!==String(p.quantity)||created.serial&&created.serial.trim()||created.batch&&created.batch.trim()||created.status!=='10'||snapshotKey(previous)!==snapshotKey(p.baseline))return {status:'blocked',evidence:'Fixture: stock or baseline differs from approved receipt'};
  return {status:'verified',evidence:'Fixture: acknowledged new StockItem ID and exact quantity read back; prior records unchanged'};
 }catch{return {status:'unknown',evidence:'Fixture: readback unavailable'}}}
}
