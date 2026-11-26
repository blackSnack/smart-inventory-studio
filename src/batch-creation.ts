import {previewBatch,type BatchDraft} from './batch-catalog.js';
import {prepareDemoDraft,type DraftPart} from './demo-part-draft.js';
import type {Catalog} from './catalog.js';
import type {ApprovedPlan} from './operation-journal.js';
function prepare(row:BatchDraft,catalog:Catalog,id:string,parts:DraftPart[]){
 const mode=row.sourceUrl&&(row.manufacturer&&row.mpn||row.supplier&&row.sku)?'exact':'partial';
 return prepareDemoDraft({name:row.name,category:row.category,manufacturer:row.manufacturer,mpn:row.mpn,supplier:row.supplier,sku:row.sku,parameters:row.parameters,sourceUrls:row.sourceUrl?[row.sourceUrl]:[],datasheetUrl:row.datasheetUrl,imageUrl:null},catalog,mode,id,parts);
}
export function reviewBatchCreation(csv:string,catalog:Catalog,parts:DraftPart[]){
 const preview=previewBatch(csv,catalog);
 const rows=preview.rows.map(row=>{
  if(row.issues.length||row.duplicateRows.length)return {...row,decision:'blocked' as const,candidates:[] as string[]};
  try{const p=prepare(row,catalog,'preview:'+row.row,parts);return {...row,decision:p.blocked?'blocked' as const:p.resolution.decision==='reuse'?'existing' as const:'create' as const,candidates:p.resolution.matches.filter(m=>m.result!=='different').map(m=>m.id),mode:p.part.details!.identity.mode}}
  catch(e){return {...row,issues:[...row.issues,e instanceof Error?e.message:'invalid parameters'],decision:'blocked' as const,candidates:[] as string[]}}
 });
 return {...preview,rows};
}
export function planBatchCreation(id:string,instanceId:string,revision:number,csv:string,reviewed:number[],catalog:Catalog,parts:DraftPart[]):ApprovedPlan{
 if(!id||!instanceId||!Number.isSafeInteger(revision)||revision<0||!reviewed.length||new Set(reviewed).size!==reviewed.length||!Number.isSafeInteger(revision+reviewed.length))throw Error('invalid batch approval');
 const preview=reviewBatchCreation(csv,catalog,parts);
 const selected=new Set(reviewed),rows=preview.rows.filter(r=>selected.has(r.row));
 if(rows.length!==reviewed.length||rows.some(r=>r.decision!=='create'))throw Error('batch contains unapproved, invalid or existing identity');
 const next=[...parts];
 const operations=rows.map((r,i)=>{
  const p=prepare(r,catalog,id+':part:'+r.row,next);
  if(p.blocked||p.resolution.decision==='reuse'||next.some(x=>x.id===p.part.id))throw Error('batch identity conflict');
  next.push(p.part);
  return {id:id+':'+i,kind:'create-demo-catalog-part',payload:{part:p.part,expectedRevision:revision+i,row:r.row}};
 });
 return {id,instanceId,catalogHash:catalog.catalogVersion,snapshotHash:String(revision),approvalId:id,operations};
}
