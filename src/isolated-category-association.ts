import {assertLocalOperationContext,type LocalOperationContext} from './local-operation-context.js';
import {fixtureEvidenceFor,type FixtureEvidenceConfig,type FixtureEvidenceStore} from './fixture-operation-evidence.js';
import {probeSchema} from './provider-schema.js';
import {InvenTreeReadProvider} from './domain.js';
import {InvenTreeAssociationReader,type ScalarTypeReview} from './inventree-association-read.js';
import {indexAssociationSnapshot,previewCategoryTemplateAssociations,type AssociationSnapshot} from './category-template-association.js';
import type {Catalog} from './catalog.js';
import type {CategoryMapping} from './parameter-mapping.js';
import {snapshotKey} from './approved-snapshot.js';
import type {Operation,OperationTransport,Observation} from './operation-journal.js';
const kind='fixture-associate-category-template';
type Relation={id:string;categoryId:string;templateId:string;defaultValue:string};
type Baseline={snapshot:AssociationSnapshot;defaults:Relation[]};
const id=(x:unknown):string=>{const s=typeof x==='number'&&Number.isSafeInteger(x)?String(x):x;if(typeof s!=='string'||!(/^[1-9][0-9]{0,15}$/).test(s)||!Number.isSafeInteger(Number(s)))throw Error('invalid association ID');return s};
const obj=(x:unknown):Record<string,unknown>=>{if(!x||typeof x!=='object'||Array.isArray(x))throw Error('invalid association row');return x as Record<string,unknown>};
const sort=<T extends {id:string}>(rows:T[])=>rows.slice().sort((a,b)=>a.id.localeCompare(b.id));
function normalized(b:Baseline){
 const s=b.snapshot;indexAssociationSnapshot(s,s.instanceId);
 if(!Array.isArray(b.defaults)||b.defaults.some(r=>typeof r.defaultValue!=='string'||r.defaultValue.length>500))throw Error('missing relation defaults');
 const defaults=sort(b.defaults),relations=sort(s.relations);
 if(snapshotKey(defaults.map(({defaultValue,...r})=>r))!==snapshotKey(relations))throw Error('relation defaults mismatch');
 return {snapshot:{...s,categories:sort(s.categories),templates:sort(s.templates),relations},defaults};
}
function row(raw:unknown):Relation{const r=obj(raw);if(typeof r.default_value!=='string'||r.default_value.length>500)throw Error('invalid association default');return {id:id(r.pk),categoryId:id(r.category),templateId:id(r.template),defaultValue:r.default_value}}
function parse(o:Operation){
 if(o.kind!==kind||!o.id.trim()||o.payload.confirmed!==true)throw Error('explicit isolated association approval required');
 const p=o.payload,categoryId=id(p.categoryId),templateId=id(p.templateId),baseline=normalized(p.baseline as Baseline),s=baseline.snapshot;
 if(s.complete!==true||p.instanceId!==s.instanceId||!Array.isArray(p.reviews))throw Error('complete same-instance baseline required');
 const reviews=p.reviews as ScalarTypeReview[],{categories,templates,pairs}=indexAssociationSnapshot(s,s.instanceId),category=categories.get(categoryId),template=templates.get(templateId);
 if(!category||!template||!template.enabled||!['string','number'].includes(template.type)||s.categories.some(c=>c.parentId===categoryId))throw Error('reviewed leaf category and scalar template required');
 if(!reviews.some(r=>r.templateId===templateId&&r.name===template.name&&r.unit===template.unit&&r.type===template.type&&r.confirmed===true))throw Error('explicit semantic review required');
 for(let c:typeof category|undefined=category;c;c=c.parentId===null?undefined:categories.get(c.parentId))if(pairs.has(JSON.stringify([c.id,templateId])))throw Error('direct or ancestor association already exists');
 return {categoryId,templateId,baseline,reviews};
}
// Fixture-only command; intentionally not registered in the shared provider operation allowlist.
export function planIsolatedAssociation(operationId:string,catalog:Catalog,mapping:CategoryMapping,key:string,baseline:Baseline,reviews:ScalarTypeReview[]):Operation{
 const b=normalized(structuredClone(baseline)),entry=previewCategoryTemplateAssociations(catalog,mapping,b.snapshot,b.snapshot.instanceId).find(x=>x.key===key);
 if(entry?.status!=='associate'||!entry.templateId)throw Error('association not an approved candidate');
 const operation:Operation={id:operationId,kind,payload:{confirmed:true,instanceId:b.snapshot.instanceId,categoryId:mapping.remoteCategoryId,templateId:entry.templateId,baseline:b,reviews:structuredClone(reviews)}};parse(operation);return operation;
}
export class IsolatedCategoryAssociationTransport implements OperationTransport{

 private constructor(private evidence:FixtureEvidenceStore,private base:URL,private token:string,private request:typeof fetch,private reader:InvenTreeAssociationReader,private read:InvenTreeReadProvider){}
 static async open(config:{base:string;token:string;fixtureOnly:true}&FixtureEvidenceConfig,request:typeof fetch){
  const evidence=fixtureEvidenceFor(config);const b=new URL(config.base.endsWith('/')?config.base:config.base+'/');if(config.fixtureOnly!==true||b.protocol!=='https:'||!b.hostname.endsWith('.test')||b.username||b.password||b.search||b.hash||!config.token.trim()||typeof request!=='function')throw Error('isolated fixture configuration required');
  return IsolatedCategoryAssociationTransport.openTransport(b,config,request,evidence);
 }
 static async openLocalAcceptance(ctx:LocalOperationContext,evidence:FixtureEvidenceStore){
  assertLocalOperationContext(ctx,evidence);const config={token:ctx.token},request=ctx.request,b=new URL(ctx.base);
  return IsolatedCategoryAssociationTransport.openTransport(b,config,request,evidence);
 }
 private static async openTransport(b:URL,config:{token:string},request:typeof fetch,evidence:FixtureEvidenceStore){
  const e=await probeSchema(b.href,config.token,[{key:'associate',path:'/api/part/category/parameters/',method:'post'}],request);if(e.operations.some(o=>!o.declared))throw Error('association write API not declared');
  return new IsolatedCategoryAssociationTransport(evidence,b,config.token,request,await InvenTreeAssociationReader.open(b.href,config.token,request),new InvenTreeReadProvider(b.href,config.token,request));
 }
 async readCandidate(instanceId:string,reviews:ScalarTypeReview[]):Promise<Baseline>{
  const snapshot=await this.reader.readCandidate(instanceId,reviews),defaults=(await this.read.list('api/part/category/parameters/')).map(row);
  return normalized({snapshot,defaults});
 }
 private async current(p:ReturnType<typeof parse>){const b=await this.readCandidate(p.baseline.snapshot.instanceId,p.reviews);return {...b,snapshot:{...b.snapshot,complete:true}}}
 async send(o:Operation){const s=structuredClone(o),p=parse(s),key=snapshotKey(s);if(!await this.evidence.claim(s))throw Error('already attempted; readback only');
  if(snapshotKey(await this.current(p))!==snapshotKey(p.baseline))throw Error('association baseline changed');
  const res=await this.request(new URL('api/part/category/parameters/',this.base),{method:'POST',headers:{Authorization:'Token '+this.token,Accept:'application/json','Content-Type':'application/json'},cache:'no-store',redirect:'error',signal:AbortSignal.timeout(20000),body:JSON.stringify({category:Number(p.categoryId),template:Number(p.templateId),default_value:''})});
  if(!res.ok)throw Error('association HTTP '+res.status);const r=row(await res.json());if(r.categoryId!==p.categoryId||r.templateId!==p.templateId||r.defaultValue!==''||p.baseline.defaults.some(x=>x.id===r.id))throw Error('association acknowledgement mismatch');await this.evidence.record(s,{key,id:r.id});
 }
 async observe(o:Operation):Promise<Observation>{try{const s=structuredClone(o),p=parse(s),a=await this.evidence.read<{key:string;id:string}>(s),b=await this.current(p);
  if(!a||a.key!==snapshotKey(s))return {status:'unknown',evidence:'Fixture: no correlated association acknowledgement; no replay'};
  const created=b.defaults.find(r=>r.id===a.id);if(!created)return {status:'unknown',evidence:'Fixture: acknowledged association not visible'};
  if(created.categoryId!==p.categoryId||created.templateId!==p.templateId||created.defaultValue!=='')return {status:'blocked',evidence:'Fixture: association identity/default changed'};
  const previous={snapshot:{...b.snapshot,relations:b.snapshot.relations.filter(r=>r.id!==a.id)},defaults:b.defaults.filter(r=>r.id!==a.id)};
  if(snapshotKey(previous)!==snapshotKey(p.baseline))return {status:'blocked',evidence:'Fixture: prior association baseline changed'};
  return {status:'verified',evidence:'Fixture: exact new relation ID and empty default read back; prior definitions unchanged'};
 }catch{return {status:'unknown',evidence:'Fixture: association readback unavailable'}}}
}
