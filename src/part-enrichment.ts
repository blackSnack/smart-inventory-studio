import type {Catalog} from './catalog.js';
import {prepareDemoDraft,strongIdentity,demoIdentity,type DraftPart} from './demo-part-draft.js';
import {reviewEnrichment,approvedEnrichment,type Suggestion,type ReviewField} from './enrichment-review.js';
import type {EnrichmentRequest} from './ai-enrichment-provider.js';
import type {ApprovedPlan} from './operation-journal.js';
export interface EnrichmentApproval {partId:string;suggestions:Suggestion[];accepted:string[]}
const linkKeys=['datasheetUrl','imageUrl'] as const;
function validLink(value:string){try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password}catch{return false}}
export function enrichmentRequest(part:DraftPart,catalog:Catalog):EnrichmentRequest{
 const details=part.details,i=details?.identity;
 if(!details||!i||i.mode!=='exact'||!((i.manufacturer&&i.mpn)||(i.supplier&&i.sku))||!details.draft.sourceUrls.length)throw Error('缺少已核验的元件身份，不能推断额定参数');
 const category=catalog.categories.find(c=>c.key===i.category);if(!category)throw Error('未知参数模板');
 const known=Object.fromEntries([...category.parameters.map(k=>[k,details.draft.parameters[k]??null]),...linkKeys.map(k=>[k,details.draft[k]])]);
 return {partId:part.id,name:part.name,category:i.category,manufacturer:i.manufacturer,mpn:i.mpn,supplier:i.supplier,sku:i.sku,known,allowedKeys:[...category.parameters,...linkKeys],sourceUrls:details.draft.sourceUrls};
}
export function reviewPartEnrichment(part:DraftPart,catalog:Catalog,suggestions:Suggestion[]):ReviewField[]{
 const input=enrichmentRequest(part,catalog);
 return reviewEnrichment(input.known,input.allowedKeys,suggestions).map(f=>{
  if(linkKeys.includes(f.key as typeof linkKeys[number])&&f.value!==null&&!validLink(f.value))return {...f,status:'unsupported'};
  if(f.status==='missing'&&!linkKeys.includes(f.key as typeof linkKeys[number])){try{const d=part.details!.draft;prepareDemoDraft({...d,parameters:{...d.parameters,[f.key]:f.value}},catalog,'exact',part.id,[])}catch{return {...f,status:'unsupported'}}}
  return f;
 });
}
export function applyPartEnrichment(part:DraftPart,catalog:Catalog,approval:EnrichmentApproval,all:DraftPart[]):DraftPart{
 if(part.id!==approval.partId||!approval.accepted.length)throw Error('invalid enrichment approval');
 const fields=reviewPartEnrichment(part,catalog,approval.suggestions);
 const values=approvedEnrichment(fields,approval.accepted);
 const old=part.details!,draft=structuredClone(old.draft),evidence={...old.fieldEvidence};
 for(const [k,v] of Object.entries(values)){if(k==='datasheetUrl'||k==='imageUrl')draft[k]=v;else draft.parameters[k]=v;const e=fields.find(x=>x.key===k)!.evidence;evidence[k]=structuredClone(e);draft.sourceUrls=[...new Set([...draft.sourceUrls,...e.map(x=>x.url)])]}
 const proposed=prepareDemoDraft(draft,catalog,'exact',part.id,all.filter(p=>p.id!==part.id));
 if(proposed.blocked||proposed.resolution.decision==='reuse'||all.some(p=>p.id!==part.id&&!!demoIdentity(p)&&strongIdentity(proposed.part.details!.identity,demoIdentity(p)!)))throw Error('identity conflict');
 const next=proposed.part.details!;
 if(!strongIdentity(old.identity,next.identity)||Object.entries(old.identity.fields).some(([k,v])=>v!==null&&next.identity.fields[k]!==v))throw Error('known identity changed');
 return {...part,spec:proposed.part.spec,details:{...next,fieldEvidence:evidence}};
}
export function planPartEnrichment(id:string,instanceId:string,revision:number,parts:DraftPart[],catalog:Catalog,approvals:EnrichmentApproval[]):ApprovedPlan{
 if(!id||!instanceId||!Number.isSafeInteger(revision)||revision<0||!approvals.length||approvals.length>100||new Set(approvals.map(a=>a.partId)).size!==approvals.length)throw Error('invalid enrichment plan');
 const operations=approvals.map((a,i)=>{const part=parts.find(p=>p.id===a.partId);if(!part)throw Error('part missing');applyPartEnrichment(part,catalog,a,parts);return {id:id+':'+i,kind:'enrich-demo-part',payload:{approval:structuredClone(a),catalog:structuredClone(catalog),expectedRevision:revision+i}}});
 return {id,instanceId,catalogHash:catalog.catalogVersion,snapshotHash:String(revision),approvalId:id,operations};
}
