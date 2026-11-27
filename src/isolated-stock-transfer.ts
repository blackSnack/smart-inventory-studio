import {probeSchema} from './provider-schema.js';
import {InvenTreeReadProvider} from './domain.js';
import {InvenTreeReadAdapter} from './inventory-provider.js';
import {snapshotKey} from './approved-snapshot.js';
import type {Operation,OperationTransport,Observation} from './operation-journal.js';
const obj=(x:unknown):Record<string,unknown>=>{if(!x||typeof x!=='object'||Array.isArray(x))throw Error('invalid transfer record');return x as Record<string,unknown>};
const id=(x:unknown):string=>{const s=typeof x==='number'&&Number.isSafeInteger(x)?String(x):x;if(typeof s!=='string'||!(/^[1-9][0-9]{0,15}$/).test(s)||!Number.isSafeInteger(Number(s)))throw Error('invalid transfer ID');return s};
const nullableId=(x:unknown)=>x===null?null:id(x);
const text=(x:unknown)=>{if(x!==null&&typeof x!=='string')throw Error('missing stock text');return x};
function decimal(x:unknown){const s=typeof x==='number'&&Number.isSafeInteger(x)?String(x):x;if(typeof s!=='string'||s.length>128||!/^\d+(?:\.\d+)?$/.test(s))throw Error('invalid transfer quantity');const [a,b='']=s.split('.'),i=a.replace(/^0+(?=\d)/,''),f=b.replace(/0+$/,'');return f?i+'.'+f:i}
function row(x:unknown){const r=obj(x);if(typeof r.in_stock!=='boolean'||typeof r.is_building!=='boolean')throw Error('missing stock lifecycle evidence');return {id:id(r.pk),part:id(r.part),location:id(r.location),quantity:decimal(r.quantity),batch:text(r.batch),serial:text(r.serial),status:id(r.status),supplier:nullableId(r.supplier_part),purchase:nullableId(r.purchase_order),sales:nullableId(r.sales_order),owner:nullableId(r.owner),customer:nullableId(r.customer),parent:nullableId(r.parent),belongsTo:nullableId(r.belongs_to),consumedBy:nullableId(r.consumed_by),packaging:text(r.packaging),expiry:text(r.expiry_date),allocated:decimal(r.allocated),inStock:r.in_stock,isBuilding:r.is_building,children:decimal(r.child_items),installed:decimal(r.installed_items)}}
type Stock=ReturnType<typeof row>;
const sort=(rows:Stock[])=>rows.slice().sort((a,b)=>a.id.localeCompare(b.id));
function scoped(raw:unknown,location:string){if(!Array.isArray(raw))throw Error('approved stock baseline required');const rows=sort(raw.map(row));if(new Set(rows.map(r=>r.id)).size!==rows.length||rows.some(r=>r.location!==location))throw Error('stock baseline scope mismatch');return rows}
function parse(o:Operation){
 if(o.kind!=='transfer-stock'||!o.id.trim()||o.payload.physicalConfirmed!==true)throw Error('explicit whole transfer approval required');const p=o.payload,source=id(p.sourceId),target=id(p.targetId),stockId=id(p.stockItemId),partId=id(p.partId),quantity=decimal(p.quantity);
 if(source===target||quantity==='0')throw Error('invalid transfer scope');
 const before=sort([...scoped(p.expectedSource,source),...scoped(p.expectedTarget,target)]),item=before.find(x=>x.id===stockId);
 if(new Set(before.map(x=>x.id)).size!==before.length||before.some(x=>x.part!==partId)||!item||item.location!==source||item.quantity!==quantity||item.allocated!=='0'||item.status!=='10'||!item.inStock||item.isBuilding||item.customer!==null||item.parent!==null||item.belongsTo!==null||item.consumedBy!==null||item.sales!==null||item.children!=='0'||item.installed!=='0')throw Error('only reviewed whole unallocated ordinary stock can move');
 return {source,target,stockId,partId,quantity,before,after:sort(before.map(x=>x.id===stockId?{...x,location:target}:x))};
}
type Parsed=ReturnType<typeof parse>;
export class IsolatedStockTransferTransport implements OperationTransport{
 private attempted=new Set<string>();private ack=new Map<string,string>();
 private constructor(private base:URL,private token:string,private request:typeof fetch,private read:InvenTreeReadProvider,private locations:InvenTreeReadAdapter){}
 static async open(config:{base:string;token:string;fixtureOnly:true},request:typeof fetch){
  const b=new URL(config.base.endsWith('/')?config.base:config.base+'/');if(config.fixtureOnly!==true||b.protocol!=='https:'||!b.hostname.endsWith('.test')||b.username||b.password||b.search||b.hash||!config.token.trim())throw Error('isolated fixture configuration required');
  const e=await probeSchema(b.href,config.token,[{key:'locations',path:'/api/stock/location/',method:'get'},{key:'stock',path:'/api/stock/',method:'get'},{key:'transfer',path:'/api/stock/transfer/',method:'post'}],request);
  if(e.operations.some(o=>!o.declared))throw Error('transfer API not declared');return new IsolatedStockTransferTransport(b,config.token,request,new InvenTreeReadProvider(b.href,config.token,request),new InvenTreeReadAdapter(b.href,config.token,request));
 }
 private async current(p:Parsed){const tree=await this.locations.getLocations();for(const id of [p.source,p.target])if(!tree.some(x=>x.id===id&&!x.structural)||tree.some(x=>x.parentId===id))throw Error('transfer leaf changed');
  const [a,b]=await Promise.all([this.read.list('api/stock/',{location:p.source,cascade:'false'}),this.read.list('api/stock/',{location:p.target,cascade:'false'})]);const rows=sort([...scoped(a,p.source),...scoped(b,p.target)]);if(new Set(rows.map(x=>x.id)).size!==rows.length)throw Error('duplicate cross-location stock');return rows}
 async send(o:Operation){const s=structuredClone(o),p=parse(s),key=snapshotKey(s);if(this.attempted.has(s.id))throw Error('already attempted; readback only');this.attempted.add(s.id);
  if(snapshotKey(await this.current(p))!==snapshotKey(p.before))throw Error('approved transfer baseline changed');
  const r=await this.request(new URL('api/stock/transfer/',this.base),{method:'POST',headers:{Authorization:'Token '+this.token,Accept:'application/json','Content-Type':'application/json'},cache:'no-store',redirect:'error',signal:AbortSignal.timeout(20000),body:JSON.stringify({items:[{pk:Number(p.stockId),quantity:p.quantity,merge:false}],location:Number(p.target)})});if(!r.ok)throw Error('transfer HTTP '+r.status);this.ack.set(s.id,key);
 }
 async observe(o:Operation):Promise<Observation>{try{const s=structuredClone(o),p=parse(s),rows=await this.current(p);if(this.ack.get(s.id)!==snapshotKey(s))return {status:'unknown',evidence:'Fixture: no correlated transfer acknowledgement; no replay'};
  if(snapshotKey(rows)===snapshotKey(p.after))return {status:'verified',evidence:'Fixture: same StockItem ID and exact whole quantity moved; prior references preserved'};
  if(snapshotKey(rows)===snapshotKey(p.before))return {status:'unknown',evidence:'Fixture: original stock location remains; no replay'};
  return {status:'blocked',evidence:'Fixture: stock transfer conservation conflict'};
 }catch{return {status:'unknown',evidence:'Fixture: transfer readback unavailable'}}}
}
