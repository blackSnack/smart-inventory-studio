export type Mode = 'exact' | 'generic' | 'partial';
export type Spec = string | null;
export interface Identity { id:string; category:string; mode:Mode; manufacturer?:string; mpn?:string; supplier?:string; sku?:string; sourceGroup?:string; fields:Record<string,Spec>; }
export interface Policy { fields:string[]; genericPooling:boolean; version:number }
export type Match = 'same'|'different'|'candidate'|'conflict';
const canon=(s?:string)=>s?.trim()||''; // case folding must be supplier-specific, not blanket MPN folding
export function match(a:Identity,b:Identity,p:Policy):Match {
 if(a.category!==b.category)return 'different';
 const conflict=[...new Set([...p.fields,...Object.keys(a.fields),...Object.keys(b.fields)])].some(k=>a.fields[k]!=null&&b.fields[k]!=null&&a.fields[k]!==b.fields[k]);
 const exact=!!canon(a.manufacturer)&&canon(a.manufacturer)===canon(b.manufacturer)&&!!canon(a.mpn)&&canon(a.mpn)===canon(b.mpn);
 const sku=!!canon(a.supplier)&&canon(a.supplier)===canon(b.supplier)&&!!canon(a.sku)&&canon(a.sku)===canon(b.sku);
 const mpnConflict=!!canon(a.manufacturer)&&!!canon(b.manufacturer)&&!!canon(a.mpn)&&!!canon(b.mpn)&&!exact;
 if((exact||sku)&&(conflict||mpnConflict))return 'conflict';
 if(a.mode==='partial'||b.mode==='partial')return conflict?'different':'candidate';
 if(a.mode==='exact'&&b.mode==='exact')return exact||sku?'same':mpnConflict||conflict?'different':'candidate';
 if(conflict)return 'different';
 if(a.mode==='generic'&&b.mode==='generic'&&p.genericPooling&&p.fields.length>0&&p.fields.every(k=>a.fields[k]!=null&&a.fields[k]!==''&&a.fields[k]===b.fields[k]))return 'same';
 return 'candidate';
}
// Decimal string, not IEEE floats. Case-sensitive SI prefixes. Explicit unit required.
export function normalizeSI(input:string,unit:'Ω'|'F'|'H'|'V'|'W'|'A'):string {
 const m=input.trim().replaceAll('μ','µ').match(/^([+]?(?:\d+(?:\.\d*)?|\.\d+))\s*(p|n|µ|u|m|k|K|M|G)?\s*(Ω|F|H|V|W|A)$/u);
 if(!m||m[3]!==unit)throw Error('invalid or ambiguous unit');
 const exp:Record<string,number>={'':0,p:-12,n:-9,'µ':-6,u:-6,m:-3,k:3,K:3,M:6,G:9};
 const [a,b='']=m[1].replace(/^\+/,'').split('.'); const digits=a+b; const point=a.length+exp[m[2]||''];
 const raw=point<=0?'0.'+'0'.repeat(-point)+digits:point>=digits.length?digits+'0'.repeat(point-digits.length):digits.slice(0,point)+'.'+digits.slice(point);
 const [x,y='']=raw.split('.');const f=y.replace(/0+$/,'');return (x.replace(/^0+(?=\d)/,'')||'0')+(f?'.'+f:'');
}
export interface Location { id:string; name:string; structural:boolean; occupants:string[] }
export interface Allocation { locationId:string; quantity:number }
export function validateAllocation(partId:string,quantity:number,allocations:Allocation[],locations:Location[]):void {
 if(!Number.isSafeInteger(quantity)||quantity<=0)throw Error('invalid quantity');
 const ids=new Set<string>();let sum=0;
 for(const a of allocations){if(ids.has(a.locationId)||!Number.isSafeInteger(a.quantity)||a.quantity<=0)throw Error('invalid allocation');ids.add(a.locationId);const loc=locations.find(l=>l.id===a.locationId);if(!loc||loc.structural||loc.occupants.some(p=>p!==partId))throw Error('invalid or mixed location');sum+=a.quantity;}
 if(sum!==quantity)throw Error('quantity mismatch');
}
export interface Cell {id:string; layer:number;row:number;col:number;name:string}
export function planExpansion(old:Cell[],dims:{layers:number;rows:number;cols:number}):{keep:Cell[];create:Omit<Cell,'id'>[]} {
 if(![dims.layers,dims.rows,dims.cols].every(x=>Number.isSafeInteger(x)&&x>0)||dims.layers*dims.rows*dims.cols>10000)throw Error('invalid dimensions');
 const coords=new Set<string>();const ids=new Set<string>();const names=new Set<string>();
 for(const c of old){if(![c.layer,c.row,c.col].every(x=>Number.isInteger(x)&&x>=0)||c.layer>=dims.layers||c.row>=dims.rows||c.col>=dims.cols)throw Error('cannot shrink or discard locations');const k=`${c.layer}/${c.row}/${c.col}`;if(coords.has(k)||ids.has(c.id)||names.has(c.name))throw Error('duplicate existing cell');coords.add(k);ids.add(c.id);names.add(c.name);}
 const create:Omit<Cell,'id'>[]=[];for(let l=0;l<dims.layers;l++)for(let r=0;r<dims.rows;r++)for(let c=0;c<dims.cols;c++){if(coords.has(`${l}/${r}/${c}`))continue;const base=`L${l+1}-R${r+1}-C${c+1}`;let name=base,n=1;while(names.has(name))name=`${base}-${++n}`;names.add(name);create.push({layer:l,row:r,col:c,name});}return {keep:old.slice(),create};
}
export interface InventoryProvider { searchParts(query:string):Promise<unknown[]>; getStockByPart(id:string):Promise<unknown[]>; getLocations():Promise<unknown[]>; getCapabilities():Promise<Record<string,boolean>>; }
// Read-only transport foundation. Production writes require verified schema and operation journal.
export class InvenTreeReadProvider implements InventoryProvider {
 constructor(private base:string,private token:string,private request:typeof fetch=fetch){}
 async list(path:string,params:Record<string,string>={}):Promise<unknown[]> {const base=new URL(this.base.endsWith('/')?this.base:this.base+'/'); if(!['http:','https:'].includes(base.protocol)||base.username||base.password||base.search||base.hash)throw Error('invalid base');if(!/^api\/[a-z]+(?:\/[a-z]+)*\/$/.test(path))throw Error('invalid read path');let url:URL|null=new URL(path,base);const expectedPath=url.pathname;Object.entries(params).forEach(([k,v])=>url!.searchParams.set(k,v));let out:unknown[]=[];let expectedCount:number|null=null;const visited=new Set<string>();while(url){if(url.origin!==base.origin||url.pathname!==expectedPath||!!url.username||!!url.password||!!url.hash||Object.entries(params).some(([k,v])=>url!.searchParams.get(k)!==v)||visited.has(url.href)||visited.size>=1000)throw Error('unsafe pagination');visited.add(url.href);const res=await this.request(url,{headers:{Authorization:`Token ${this.token}`,Accept:'application/json'},redirect:'error',cache:'no-store'});if(!res.ok)throw Error(`HTTP ${res.status}`);const data=await res.json();if(Array.isArray(data)){if(out.length||data.length>100000)throw Error('invalid unpaginated response');return data}if(!Array.isArray(data.results)||data.next!=null&&typeof data.next!=='string')throw Error('invalid response');if(data.count!==undefined){if(!Number.isSafeInteger(data.count)||data.count<0||data.count>100000||expectedCount!==null&&expectedCount!==data.count)throw Error('inconsistent page count');expectedCount=data.count}out.push(...data.results);if(out.length>100000)throw Error('too many rows');url=data.next?new URL(data.next,url):null;if(!url&&expectedCount!==null&&out.length!==expectedCount)throw Error('incomplete pagination');}return out;}
 searchParts(query:string){return this.list('api/part/',{search:query});}
 getStockByPart(id:string){return this.list('api/stock/',{part:id});}
 getLocations(){return this.list('api/stock/location/');}
 async getCapabilities(){return {read:true,write:false};}
}
