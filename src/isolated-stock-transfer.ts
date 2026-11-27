import {isRetiredLocationName} from './native-retired-location.js';
import {assertLocalOperationContext,type LocalOperationContext} from './local-operation-context.js';
import {fixtureEvidenceFor,type FixtureEvidenceConfig,type FixtureEvidenceStore} from './fixture-operation-evidence.js';
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
// Exact subtraction in a common decimal scale, never floating point.
function remainder(total:string,move:string){const [a,b='']=total.split('.'),[c,d='']=move.split('.'),scale=Math.max(b.length,d.length),n=BigInt(a+b.padEnd(scale,'0'))-BigInt(c+d.padEnd(scale,'0'));if(n<0n)throw Error('transfer exceeds approved stock');const digits=n.toString().padStart(scale+1,'0');return decimal(scale?digits.slice(0,-scale)+'.'+digits.slice(-scale):digits)}
function row(x:unknown){const r=obj(x);if(typeof r.in_stock!=='boolean'||typeof r.is_building!=='boolean')throw Error('missing stock lifecycle evidence');return {id:id(r.pk),part:id(r.part),location:id(r.location),quantity:decimal(r.quantity),batch:text(r.batch),serial:text(r.serial),status:id(r.status),supplier:nullableId(r.supplier_part),purchase:nullableId(r.purchase_order),sales:nullableId(r.sales_order),owner:nullableId(r.owner),customer:nullableId(r.customer),parent:nullableId(r.parent),belongsTo:nullableId(r.belongs_to),consumedBy:nullableId(r.consumed_by),packaging:text(r.packaging),expiry:text(r.expiry_date),allocated:decimal(r.allocated),inStock:r.in_stock,isBuilding:r.is_building,children:decimal(r.child_items),installed:decimal(r.installed_items)}}
type Stock=ReturnType<typeof row>;
const sort=(rows:Stock[])=>rows.slice().sort((a,b)=>a.id.localeCompare(b.id));
function scoped(raw:unknown,location:string){if(!Array.isArray(raw))throw Error('approved stock baseline required');const rows=sort(raw.map(row));if(new Set(rows.map(r=>r.id)).size!==rows.length||rows.some(r=>r.location!==location))throw Error('stock baseline scope mismatch');return rows}
function parse(o:Operation,allowContinuation=false){
 if(o.kind!=='transfer-stock'||!o.id.trim()||o.payload.physicalConfirmed!==true)throw Error('explicit transfer approval required');const p=o.payload,source=id(p.sourceId),target=id(p.targetId),stockId=id(p.stockItemId),partId=id(p.partId),quantity=decimal(p.quantity);
 if(source===target||quantity==='0')throw Error('invalid transfer scope');
 const before=sort([...scoped(p.expectedSource,source),...scoped(p.expectedTarget,target)]),item=before.find(x=>x.id===stockId);
 if(new Set(before.map(x=>x.id)).size!==before.length||before.some(x=>x.part!==partId)||!item||item.location!==source||item.allocated!=='0'||item.status!=='10'||!item.inStock||item.isBuilding||item.customer!==null||item.belongsTo!==null||item.consumedBy!==null||item.sales!==null||item.installed!=='0')throw Error('only reviewed unallocated ordinary stock can move');
 const prior:{locationId:string;rows:Stock[]}[]=[];
 if(p.continuation!==undefined){
  if(p.linkedExpected!==undefined||p.expectedLinked!==undefined)throw Error('conflicting lineage modes');
  if(!allowContinuation)throw Error('continuation requires explicit native context');
  const c=obj(p.continuation),original=row(c.original);
  if(!Array.isArray(c.splits)||!c.splits.length||c.splits.length>999||!Array.isArray(p.expectedPrior)||p.expectedPrior.length!==c.splits.length||original.id!==stockId||original.location!==source||original.children!=='0'||original.parent!==null||original.serial!==null&&original.serial.trim())throw Error('invalid prior split evidence');
  let qty=original.quantity;const seen=new Set<string>(),childIds=new Set<string>();
  for(const raw of c.splits){const x=obj(raw),locationId=id(x.locationId),q=decimal(x.quantity);if(locationId===source||locationId===target||seen.has(locationId)||q==='0')throw Error('invalid prior destination');seen.add(locationId);qty=remainder(qty,q);
   const evidence=p.expectedPrior.map(obj).filter(y=>y.locationId===locationId);if(evidence.length!==1)throw Error('missing prior destination evidence');
   const rows=scoped(evidence[0].rows,locationId),children=rows.filter(y=>y.parent===stockId);
   if(children.length!==1||childIds.has(children[0].id)||snapshotKey(children[0])!==snapshotKey({...original,id:children[0].id,location:locationId,quantity:q,parent:stockId,children:'0'}))throw Error('prior child lineage changed');
   childIds.add(children[0].id);prior.push({locationId,rows});
  }
  if(qty==='0'||snapshotKey(item)!==snapshotKey({...original,quantity:qty,children:String(c.splits.length)}))throw Error('prior split remainder changed');
 }else if(p.linkedExpected!==undefined){
  if(!allowContinuation||p.expectedPrior!==undefined||quantity!==item.quantity||!Array.isArray(p.linkedExpected)||p.linkedExpected.length<2||p.linkedExpected.length>10000||!Array.isArray(p.expectedLinked))throw Error('linked StockItems may only move whole with complete evidence');
  const expected=sort(p.linkedExpected.map(row)),locations=[...new Set(expected.map(x=>x.location))].filter(x=>x!==source&&x!==target).sort();
  if(p.expectedLinked.length!==locations.length||new Set(expected.map(x=>x.id)).size!==expected.length)throw Error('duplicate or incomplete lineage scope');
  for(const locationId of locations){const matches=p.expectedLinked.map(obj).filter(x=>x.locationId===locationId);if(matches.length!==1)throw Error('missing linked location baseline');prior.push({locationId,rows:scoped(matches[0].rows,locationId)})}
  const actual=[...before,...prior.flatMap(x=>x.rows)],byId=new Map(actual.map(x=>[x.id,x])),family=new Map(expected.map(x=>[x.id,x]));
  if(actual.length!==byId.size||!family.has(stockId)||expected.some(x=>!byId.has(x.id)||snapshotKey(x)!==snapshotKey(byId.get(x.id))||x.part!==partId||x.parent!==null&&!family.has(x.parent)||actual.filter(y=>y.parent===x.id).length!==Number(x.children)||actual.some(y=>y.parent===x.id&&!family.has(y.id))))throw Error('linked stock evidence changed or incomplete');
  const roots=new Set<string>();for(const x of expected){let y=x;const seen=new Set<string>();while(y.parent!==null){if(seen.has(y.id))throw Error('cyclic stock lineage');seen.add(y.id);y=family.get(y.parent)!}roots.add(y.id)}if(roots.size!==1)throw Error('unrelated stock lineage');
 }else if(item.parent!==null||item.children!=='0'||p.expectedPrior!==undefined||p.expectedLinked!==undefined)throw Error('unreviewed child lineage');
 if(p.reviewedStock!==undefined&&snapshotKey(row(p.reviewedStock))!==snapshotKey(item))throw Error('reviewed stock record changed');
 const remaining=remainder(item.quantity,quantity),split=remaining!=='0';
 if(split&&(item.parent!==null||p.splitConfirmed!==true||item.serial!==null&&item.serial.trim()!==''))throw Error('explicit nonserialized split approval required');
 const after=sort(before.map(x=>x.id!==stockId?x:split?{...x,quantity:remaining,children:(BigInt(x.children)+1n).toString()}:{...x,location:target}));
 const expectedChild=split?{...item,location:target,quantity,parent:stockId,children:'0'}:null;
 return {source,target,stockId,partId,quantity,before,after,expectedChild,prior};
}
type Parsed=ReturnType<typeof parse>;
export class IsolatedStockTransferTransport implements OperationTransport{

 private constructor(private evidence:FixtureEvidenceStore,private base:URL,private token:string,private request:typeof fetch,private read:InvenTreeReadProvider,private locations:InvenTreeReadAdapter,private allowContinuation=false){}
 static async open(config:{base:string;token:string;fixtureOnly:true}&FixtureEvidenceConfig,request:typeof fetch){
  const evidence=fixtureEvidenceFor(config);const b=new URL(config.base.endsWith('/')?config.base:config.base+'/');if(config.fixtureOnly!==true||b.protocol!=='https:'||!b.hostname.endsWith('.test')||b.username||b.password||b.search||b.hash||!config.token.trim())throw Error('isolated fixture configuration required');
  return IsolatedStockTransferTransport.openTransport(b,config,request,evidence);
 }
 static async openLocalAcceptance(ctx:LocalOperationContext,evidence:FixtureEvidenceStore){
  assertLocalOperationContext(ctx,evidence);const config={token:ctx.token},request=ctx.request,b=new URL(ctx.base);
  return IsolatedStockTransferTransport.openTransport(b,config,request,evidence,true);
 }
 private static async openTransport(b:URL,config:{token:string},request:typeof fetch,evidence:FixtureEvidenceStore,allowContinuation=false){
  const e=await probeSchema(b.href,config.token,[{key:'locations',path:'/api/stock/location/',method:'get'},{key:'stock',path:'/api/stock/',method:'get'},{key:'transfer',path:'/api/stock/transfer/',method:'post'}],request);
  if(e.operations.some(o=>!o.declared))throw Error('transfer API not declared');return new IsolatedStockTransferTransport(evidence,b,config.token,request,new InvenTreeReadProvider(b.href,config.token,request),new InvenTreeReadAdapter(b.href,config.token,request),allowContinuation);
 }
 private async current(p:Parsed){const tree=await this.locations.getLocations();for(const id of [p.source,p.target])if(!tree.some(x=>x.id===id&&!x.structural&&!isRetiredLocationName(x.name))||tree.some(x=>x.parentId===id))throw Error('transfer leaf changed');
  for(const prior of p.prior){if(!tree.some(x=>x.id===prior.locationId&&!x.structural)||snapshotKey(scoped(await this.read.list('api/stock/',{location:prior.locationId,cascade:'false'}),prior.locationId))!==snapshotKey(prior.rows))throw Error('prior split location changed')}
  const [a,b]=await Promise.all([this.read.list('api/stock/',{location:p.source,cascade:'false'}),this.read.list('api/stock/',{location:p.target,cascade:'false'})]);const rows=sort([...scoped(a,p.source),...scoped(b,p.target)]);if(new Set(rows.map(x=>x.id)).size!==rows.length)throw Error('duplicate cross-location stock');return rows}
 async send(o:Operation){const s=structuredClone(o),p=parse(s,this.allowContinuation),key=snapshotKey(s);if(!await this.evidence.claim(s))throw Error('already attempted; readback only');
  if(snapshotKey(await this.current(p))!==snapshotKey(p.before))throw Error('approved transfer baseline changed');
  const r=await this.request(new URL('api/stock/transfer/',this.base),{method:'POST',headers:{Authorization:'Token '+this.token,Accept:'application/json','Content-Type':'application/json'},cache:'no-store',redirect:'error',signal:AbortSignal.timeout(20000),body:JSON.stringify({items:[{pk:Number(p.stockId),quantity:p.quantity,merge:false}],location:Number(p.target)})});if(!r.ok)throw Error('transfer HTTP '+r.status);await this.evidence.record(s,key);
 }
 async observe(o:Operation):Promise<Observation>{try{const s=structuredClone(o),p=parse(s,this.allowContinuation),rows=await this.current(p);if(await this.evidence.read<string>(s)!==snapshotKey(s))return {status:'unknown',evidence:'Fixture: no correlated transfer acknowledgement; no replay'};
  if(!p.expectedChild&&snapshotKey(rows)===snapshotKey(p.after))return {status:'verified',evidence:'Fixture: same StockItem ID and exact whole quantity moved; prior references preserved'};
  if(p.expectedChild){const known=new Set(p.before.map(x=>x.id)),created=rows.filter(x=>!known.has(x.id)),existing=rows.filter(x=>known.has(x.id));
   if(created.length===1&&snapshotKey(existing)===snapshotKey(p.after)&&snapshotKey(created[0])===snapshotKey({...p.expectedChild,id:created[0].id}))return {status:'verified',evidence:'Fixture: original ID and exact remainder retained, new child linked to source, moved quantity and prior references verified'};
  }
  if(snapshotKey(rows)===snapshotKey(p.before))return {status:'unknown',evidence:'Fixture: original stock location remains; no replay'};
  return {status:'blocked',evidence:'Fixture: stock transfer conservation conflict'};
 }catch{return {status:'unknown',evidence:'Fixture: transfer readback unavailable'}}}
}
