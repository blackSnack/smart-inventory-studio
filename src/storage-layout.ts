// Rectangles use integer grid units, independent of display names and provider IDs.
export interface Rect {x:number;y:number;width:number;height:number}
export interface Compartment extends Rect {id:string}
export interface Drawer {id:string;width:number;height:number;revision:number;compartments:Compartment[]}
function area(r:Rect){return r.width*r.height}
function overlap(a:Rect,b:Rect){return a.x<b.x+b.width&&b.x<a.x+a.width&&a.y<b.y+b.height&&b.y<a.y+a.height}
export function validateDrawer(d:Drawer):void {
 if(!d.id||![d.width,d.height,d.revision].every(Number.isSafeInteger)||d.width<1||d.height<1||d.width*d.height>1000000||d.revision<0||!d.compartments.length||d.compartments.length>1000)throw Error('invalid drawer');
 const ids=new Set<string>();let sum=0;
 for(const [i,c] of d.compartments.entries()){
  if(!c.id||ids.has(c.id)||![c.x,c.y,c.width,c.height].every(Number.isSafeInteger)||c.x<0||c.y<0||c.width<=0||c.height<=0||c.x+c.width>d.width||c.y+c.height>d.height||d.compartments.slice(0,i).some(b=>overlap(b,c)))throw Error('invalid partition');
  ids.add(c.id);sum+=area(c);
 }
 if(sum!==d.width*d.height)throw Error('layout does not cover drawer');
}
export function splitCompartment(d:Drawer,id:string,axis:'horizontal'|'vertical',sizes:number[],newIds:string[]):Drawer{
 validateDrawer(d);const c=d.compartments.find(x=>x.id===id);if(!c||sizes.length<2||sizes.length!==newIds.length||!sizes.every(s=>Number.isSafeInteger(s)&&s>0)||sizes.reduce((a,b)=>a+b,0)!==(axis==='vertical'?c.width:c.height))throw Error('invalid split');
 let offset=0;const created=sizes.map((size,i)=>{const rect={id:newIds[i],x:c.x+(axis==='vertical'?offset:0),y:c.y+(axis==='horizontal'?offset:0),width:axis==='vertical'?size:c.width,height:axis==='horizontal'?size:c.height};offset+=size;return rect});
 const next={...d,revision:d.revision+1,compartments:[...d.compartments.filter(x=>x.id!==id),...created]};validateDrawer(next);return next;
}
export function mergeCompartments(d:Drawer,ids:string[],newId:string):Drawer{
 validateDrawer(d);const selected=d.compartments.filter(c=>ids.includes(c.id));if(ids.length<2||new Set(ids).size!==ids.length||selected.length!==ids.length)throw Error('invalid selection');
 const x=Math.min(...selected.map(c=>c.x)),y=Math.min(...selected.map(c=>c.y));const width=Math.max(...selected.map(c=>c.x+c.width))-x,height=Math.max(...selected.map(c=>c.y+c.height))-y;
 if(selected.reduce((s,c)=>s+area(c),0)!==width*height)throw Error('selection is not a contiguous rectangle');
 const next={...d,revision:d.revision+1,compartments:[...d.compartments.filter(c=>!ids.includes(c.id)),{id:newId,x,y,width,height}]};validateDrawer(next);return next;
}
// Layout changes are proposals only. Stock transfers, reference checks and physical confirmation are application-layer gates.
export function mergeMetadata(existing:Record<string,unknown>,layout:Drawer,expectedRevision:number):Record<string,unknown>{
 validateDrawer(layout);const current=existing.smart_inventory;
 if(current!==undefined&&(!current||typeof current!=='object'||Array.isArray(current)))throw Error('metadata conflict');
 const old=(current??{}) as Record<string,unknown>;const rev=old.revision??0;
 if(rev!==expectedRevision||layout.revision!==expectedRevision+1)throw Error('stale layout revision');
 return {...existing,smart_inventory:{...old,schemaVersion:1,revision:layout.revision,layout}};
}
