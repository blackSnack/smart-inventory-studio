export type ReceiptStockBaseline={id:string;partId:string;locationId:string;quantity:string;batch:string|null;serial:string|null;status:string};
const object=(x:unknown):Record<string,unknown>=>{if(!x||typeof x!=='object'||Array.isArray(x))throw Error('invalid receipt record');return x as Record<string,unknown>};
export const receiptId=(x:unknown):string=>{const s=typeof x==='number'&&Number.isSafeInteger(x)?String(x):x;if(typeof s!=='string'||!(/^[1-9][0-9]{0,15}$/).test(s)||!Number.isSafeInteger(Number(s)))throw Error('invalid fixture ID');return s};
export const receiptDecimal=(x:unknown):string=>{const s=typeof x==='number'&&Number.isSafeInteger(x)?String(x):x;if(typeof s!=='string'||s.length>128||!/^\d+(?:\.\d+)?$/.test(s))throw Error('invalid quantity');const [a,b='']=s.split('.'),i=a.replace(/^0+(?=\d)/,''),f=b.replace(/0+$/,'');return f?i+'.'+f:i};
const optionalText=(x:unknown):string|null=>{if(x!==null&&typeof x!=='string')throw Error('missing batch/serial evidence');return x};
const status=(x:unknown):string=>{const s=typeof x==='number'&&Number.isSafeInteger(x)?String(x):x;if(typeof s!=='string'||!/^\d+$/.test(s))throw Error('invalid stock status');return s};
function normalize(s:unknown):ReceiptStockBaseline{const r=object(s);return {id:receiptId(r.id),partId:receiptId(r.partId),locationId:receiptId(r.locationId),quantity:receiptDecimal(r.quantity),batch:optionalText(r.batch),serial:optionalText(r.serial),status:status(r.status)}}
export function receiptStockBaseline(rows:unknown,locationId:string):ReceiptStockBaseline[]{if(!Array.isArray(rows))throw Error('stock baseline required');const stock=rows.map(normalize);if(new Set(stock.map(x=>x.id)).size!==stock.length||stock.some(x=>x.locationId!==locationId))throw Error('invalid stock baseline scope');return stock.sort((a,b)=>a.id.localeCompare(b.id))}

export function nativeReceiptStock(rows:unknown[],locationId:string):ReceiptStockBaseline[]{
 return receiptStockBaseline(rows.map(x=>{const r=object(x);return {id:r.pk,partId:r.part,locationId:r.location,quantity:r.quantity,batch:r.batch,serial:r.serial,status:r.status}}),locationId);
}
