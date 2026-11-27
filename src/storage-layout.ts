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

// Exact proportions in the existing integer-coordinate format. Refine the
// selected axis only, then reduce the common grid divisor. No floating-point
// rounding or identity changes for untouched compartments.
export const MAX_COMPARTMENTS=1000;
const gcd=(a:bigint,b:bigint):bigint=>{while(b){const r=a%b;a=b;b=r}return a};
export function sameCompartmentGeometry(a:Drawer,old:Compartment,b:Drawer,next:Compartment):boolean{
 return (['x','width','y','height'] as const).every(k=>{const horizontal=k==='x'||k==='width';return BigInt(old[k])*BigInt(horizontal?b.width:b.height)===BigInt(next[k])*BigInt(horizontal?a.width:a.height)});
}
export function splitByRatio(d:Drawer,id:string,axis:'horizontal'|'vertical',weights:number[],newIds:string[]):Drawer{
 validateDrawer(d);
 const c=d.compartments.find(r=>r.id===id);
 if(!c||!['horizontal','vertical'].includes(axis)||weights.length<2||weights.length!==newIds.length||d.compartments.length-1+weights.length>MAX_COMPARTMENTS||!weights.every(n=>Number.isSafeInteger(n)&&n>0))throw Error('分隔数量或比例无效');
 const horizontal=axis==='vertical',size=BigInt(horizontal?c.width:c.height),total=weights.reduce((a,b)=>a+BigInt(b),0n);
 const divisor=weights.reduce((a,b)=>gcd(a,BigInt(b)),0n),sum=total/divisor;
 const scale=sum/gcd(size,sum);
 let offset=0n;
 const rects=d.compartments.flatMap(r=>{
  const x=BigInt(r.x)*(horizontal?scale:1n),y=BigInt(r.y)*(horizontal?1n:scale),width=BigInt(r.width)*(horizontal?scale:1n),height=BigInt(r.height)*(horizontal?1n:scale);
  if(r.id!==id)return [{id:r.id,x,y,width,height}];
  return weights.map((w,i)=>{const length=size*scale*(BigInt(w)/divisor)/sum;const result={id:newIds[i],x:x+(horizontal?offset:0n),y:y+(horizontal?0n:offset),width:horizontal?length:width,height:horizontal?height:length};offset+=length;return result});
 });
 let width=BigInt(d.width)*(horizontal?scale:1n),height=BigInt(d.height)*(horizontal?1n:scale);
 let gx=width,gy=height;
 for(const r of rects){gx=gcd(gcd(gx,r.x),r.width);gy=gcd(gcd(gy,r.y),r.height)}
 width/=gx;height/=gy;
 if(width*height>1000000n)throw Error('当前分隔组合超过精确布局容量，请减少比例复杂度');
 const next:Drawer={...d,width:Number(width),height:Number(height),revision:d.revision+1,compartments:rects.map(r=>({id:r.id,x:Number(r.x/gx),y:Number(r.y/gy),width:Number(r.width/gx),height:Number(r.height/gy)}))};
 validateDrawer(next);return next;
}
