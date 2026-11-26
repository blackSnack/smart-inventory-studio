import type {Catalog} from './catalog.js';
const STANDARD=['name','category','manufacturer','mpn','supplier','sku','source_url','datasheet_url'] as const;
export interface BatchDraft {row:number;name:string;category:string;manufacturer:string|null;mpn:string|null;supplier:string|null;sku:string|null;sourceUrl:string|null;datasheetUrl:string|null;parameters:Record<string,string|null>;quantity:0;issues:string[];duplicateRows:number[]}
export interface BatchPreview {catalogVersion:string;rows:BatchDraft[];unmappedHeaders:string[];requiresReview:true}
export function parseCSV(input:string):string[][]{
 if(input.length>1_000_000)throw Error('CSV exceeds 1 MB');
 const text=input.replace(/^\uFEFF/,'');const rows:string[][]=[];let row:string[]=[],field='',quoted=false,closed=false;
 const fieldEnd=()=>{row.push(field);field='';closed=false};
 const rowEnd=()=>{fieldEnd();if(row.some(v=>v.trim()))rows.push(row);row=[];if(rows.length>501)throw Error('maximum 500 data rows')};
 for(let i=0;i<text.length;i++){const ch=text[i];
  if(quoted){if(ch==='"'){if(text[i+1]==='"'){field+='"';i++}else{quoted=false;closed=true}}else field+=ch;continue}
  if(ch===','){fieldEnd();continue}if(ch==='\r'||ch==='\n'){if(ch==='\r'&&text[i+1]==='\n')i++;rowEnd();continue}
  if(closed)throw Error('unexpected character after closing quote');
  if(ch==='"'){if(field.length)throw Error('unexpected quote');quoted=true}else field+=ch;
 }
 if(quoted)throw Error('unterminated quoted field');if(field.length||row.length||closed)rowEnd();return rows;
}
const clean=(s:string)=>s.trim()||null;
const validURL=(s:string)=>{try{const u=new URL(s);return u.protocol==='https:'&&!u.username&&!u.password}catch{return false}};
export function previewBatch(csv:string,catalog:Catalog):BatchPreview{
 const [header,...data]=parseCSV(csv);if(!header||!data.length)throw Error('CSV requires header and at least one row');
 const columns=header.map(s=>s.trim());if(columns.some(c=>!c)||new Set(columns).size!==columns.length||!columns.includes('name')||!columns.includes('category'))throw Error('unique headers name and category required');
 if(columns.length>150)throw Error('too many columns');
 const allowed=new Set<string>([...STANDARD,...Object.keys(catalog.fieldDefinitions).map(k=>'param:'+k)]);
 const unmappedHeaders=columns.filter(h=>!allowed.has(h));
 const rows=data.map((values,i):BatchDraft=>{
  const issues:string[]=[];if(values.length!==columns.length)issues.push('column count mismatch');const get=(key:string)=>clean(values[columns.indexOf(key)]??'');
  const name=get('name')??'',category=get('category')??'',c=catalog.categories.find(x=>x.key===category);
  if(!name)issues.push('missing name');if(!c)issues.push('unknown category');
  const manufacturer=get('manufacturer'),mpn=get('mpn'),supplier=get('supplier'),sku=get('sku'),sourceUrl=get('source_url'),datasheetUrl=get('datasheet_url');
  if((!!manufacturer)!=(!!mpn))issues.push('manufacturer and MPN must be reviewed together');if((!!supplier)!=(!!sku))issues.push('supplier and SKU must be reviewed together');
  for(const [k,v] of [['source_url',sourceUrl],['datasheet_url',datasheetUrl]])if(v&&!validURL(v))issues.push('invalid HTTPS '+k);
  const parameters:Record<string,string|null>=Object.fromEntries((c?.parameters??[]).map(k=>[k,get('param:'+k)]));
  for(const h of columns.filter(h=>h.startsWith('param:')))if(get(h)&&!c?.parameters.includes(h.slice(6)))issues.push('unmapped parameter '+h);
  for(const h of unmappedHeaders)if(get(h))issues.push('unmapped column '+h);
  return {row:i+2,name,category,manufacturer,mpn,supplier,sku,sourceUrl,datasheetUrl,parameters,quantity:0,issues,duplicateRows:[]};
 });
 const signatures=(r:BatchDraft)=>[r.manufacturer&&r.mpn?JSON.stringify(['mpn',r.manufacturer,r.mpn]):null,r.supplier&&r.sku?JSON.stringify(['sku',r.supplier,r.sku]):null].filter((x):x is string=>x!==null);
 const keys=new Map<string,number[]>();for(const r of rows)for(const key of signatures(r))keys.set(key,[...(keys.get(key)??[]),r.row]);
 for(const r of rows)r.duplicateRows=[...new Set(signatures(r).flatMap(k=>keys.get(k)??[]))].filter(n=>n!==r.row).sort((a,b)=>a-b);
 return {catalogVersion:catalog.catalogVersion,rows,unmappedHeaders,requiresReview:true};
}
