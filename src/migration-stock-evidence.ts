// A caller-supplied complete, instance-scoped readback baseline. No server access or mutation.
export interface MigrationStockItem {stockItemId:string;partId:string;locationId:string|null;quantity:string;batch:string|null;serial:string|null;status:string}
export interface MigrationStockSnapshot {instanceId:string;complete:boolean;items:MigrationStockItem[]}
const nonempty=(x:unknown):x is string=>typeof x==='string'&&!!x.trim();
const nullableText=(x:unknown):x is string|null=>x===null||typeof x==='string';
function decimal(value:unknown){
 if(typeof value!=='string'||value.length>128||!/^\d+(?:\.\d+)?$/.test(value))throw Error('invalid exact stock quantity');
 const [integer,fraction='']=value.split('.'),i=integer.replace(/^0+(?=\d)/,''),f=fraction.replace(/0+$/,'');return f?i+'.'+f:i;
}
function index(snapshot:MigrationStockSnapshot,locations:ReadonlySet<string>){
 if(!snapshot||snapshot.complete!==true||!nonempty(snapshot.instanceId)||!Array.isArray(snapshot.items))throw Error('incomplete stock evidence');
 const result=new Map<string,string>();
 for(const item of snapshot.items){
  if(!item||!nonempty(item.stockItemId)||!nonempty(item.partId)||!(item.locationId===null||nonempty(item.locationId)&&locations.has(item.locationId))||!nullableText(item.batch)||!nullableText(item.serial)||!nonempty(item.status)||result.has(item.stockItemId))throw Error('invalid stock reference evidence');
  // Compare each record, not aggregate quantities; preserve batch, serial and status verbatim.
  result.set(item.stockItemId,JSON.stringify([item.partId,item.locationId,decimal(item.quantity),item.batch,item.serial,item.status]));
 }
 return result;
}
export function verifyMigrationStock(before:MigrationStockSnapshot,after:MigrationStockSnapshot,beforeLocations:ReadonlySet<string>,afterLocations:ReadonlySet<string>):boolean{
 try{
  const a=index(before,beforeLocations),b=index(after,afterLocations);
  return before.instanceId===after.instanceId&&a.size===b.size&&[...a].every(([id,value])=>b.get(id)===value);
 }catch{return false}
}
