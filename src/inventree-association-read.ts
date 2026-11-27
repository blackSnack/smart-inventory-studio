import {InvenTreeReadProvider} from './domain.js';
import {probeSchema} from './provider-schema.js';
import {indexAssociationSnapshot,type AssociationSnapshot} from './category-template-association.js';
const obj=(x:unknown):Record<string,unknown>=>{if(!x||typeof x!=='object'||Array.isArray(x))throw Error('invalid association row');return x as Record<string,unknown>};
const id=(x:unknown):string=>{const s=typeof x==='number'&&Number.isSafeInteger(x)?String(x):x;if(typeof s!=='string'||!(/^[1-9][0-9]{0,17}$/).test(s))throw Error('invalid association ID');return s};
const str=(x:unknown):string=>{if(typeof x!=='string')throw Error('invalid association text');return x};
export interface ScalarTypeReview {templateId:string;name:string;unit:string|null;type:'string'|'number';confirmed:true}
export class InvenTreeAssociationReader{
 private constructor(private read:InvenTreeReadProvider){}
 static async open(base:string,token:string,request:typeof fetch){
  const paths=['/api/part/category/','/api/parameter/template/','/api/part/category/parameters/'];
  const e=await probeSchema(base,token,paths.map(path=>({key:path,path,method:'get'})),request);
  if(e.operations.some(o=>!o.declared))throw Error('association API not declared');
  return new InvenTreeAssociationReader(new InvenTreeReadProvider(base,token,request));
 }
 async readCandidate(instanceId:string,reviews:readonly ScalarTypeReview[]=[]):Promise<AssociationSnapshot>{
  if(typeof instanceId!=='string'||!instanceId.trim()||!Array.isArray(reviews))throw Error('association instance required');
  const confirmed=structuredClone(reviews);if(new Set(confirmed.map(x=>id(x.templateId))).size!==confirmed.length||confirmed.some(x=>x.confirmed!==true||!['string','number'].includes(x.type)||typeof x.name!=='string'||!x.name.trim()||!(x.unit===null||typeof x.unit==='string')))throw Error('invalid scalar semantic reviews');
  const [categories,templates,relations]=await Promise.all([this.read.list('api/part/category/'),this.read.list('api/parameter/template/',{for_model:'part.part'}),this.read.list('api/part/category/parameters/')]);
  const seen=new Set<string>();
  const snapshot:AssociationSnapshot={instanceId,complete:false,
   categories:categories.map(x=>{const r=obj(x);return {id:id(r.pk),name:str(r.name),parentId:r.parent===null?null:id(r.parent)}}),
   templates:templates.map(x=>{const r=obj(x),tid=id(r.pk),name=str(r.name),unit=str(r.units).trim()||null;
    if((r.model_type!=='part.part'&&r.model_type!==null)||typeof r.checkbox!=='boolean'||typeof r.enabled!=='boolean'||!Object.hasOwn(r,'selectionlist'))throw Error('invalid native template scope');
    const choices=str(r.choices),selection=r.selectionlist===null?null:id(r.selectionlist);
    const reviewed=confirmed.find(c=>c.templateId===tid);let type=r.model_type===null?'unknown':r.checkbox?'boolean':choices.trim()||selection!==null?'enum':'unknown';
    if(reviewed){if(r.model_type!== 'part.part'||type!=='unknown'||name!==reviewed.name||unit!==reviewed.unit||r.enabled!==true)throw Error('reviewed scalar definition changed');type=reviewed.type;seen.add(tid)}
    return {id:tid,name,unit,type,enabled:r.enabled};
   }),
   relations:relations.map(x=>{const r=obj(x);return {id:id(r.pk),categoryId:id(r.category),templateId:id(r.template)}})
  };
  if(seen.size!==confirmed.length)throw Error('reviewed native template missing');
  indexAssociationSnapshot(snapshot,instanceId);
  return snapshot;
 }
}
