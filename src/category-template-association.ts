import {planParameterMapping,type CategoryMapping,type RemoteTemplate} from './parameter-mapping.js';
import type {Catalog} from './catalog.js';
import type {CategoryRef} from './inventory-contract.js';
export interface DirectTemplateRelation {id:string;categoryId:string;templateId:string}
export interface AssociationSnapshot {instanceId:string;complete:boolean;categories:CategoryRef[];templates:(RemoteTemplate&{enabled:boolean})[];relations:DirectTemplateRelation[]}
export type AssociationPreview={key:string;status:'direct'|'ancestor'|'associate'|'create-template'|'review';templateId?:string;ancestorIds?:string[];reason?:string};
const nonblank=(x:unknown):x is string=>typeof x==='string'&&!!x.trim();
export function previewCategoryTemplateAssociations(catalog:Catalog,mapping:CategoryMapping,snapshot:AssociationSnapshot,instanceId:string):AssociationPreview[]{
 if(!snapshot||snapshot.complete!==true||!nonblank(instanceId)||snapshot.instanceId!==instanceId||!Array.isArray(snapshot.categories)||!Array.isArray(snapshot.templates)||!Array.isArray(snapshot.relations))throw Error('complete same-instance association evidence required');
 const categories=new Map(snapshot.categories.map(c=>[c.id,c])),templates=new Map(snapshot.templates.map(t=>[t.id,t]));
 if(categories.size!==snapshot.categories.length||templates.size!==snapshot.templates.length||snapshot.categories.some(c=>!nonblank(c.id)||!nonblank(c.name)||c.parentId!==null&&!categories.has(c.parentId))||snapshot.templates.some(t=>!nonblank(t.id)||!nonblank(t.name)||typeof t.enabled!=='boolean'||!(t.unit===null||typeof t.unit==='string')||!nonblank(t.type)))throw Error('invalid category or template evidence');
 for(const c of snapshot.categories){const seen=new Set<string>();let node:CategoryRef|undefined=c;while(node){if(seen.has(node.id))throw Error('cyclic category tree');seen.add(node.id);node=node.parentId===null?undefined:categories.get(node.parentId)}}
 const category=categories.get(mapping.remoteCategoryId);if(!category)throw Error('mapped category missing');
 const ancestors:string[]=[];let parent=category.parentId;while(parent!==null){ancestors.push(parent);parent=categories.get(parent)!.parentId}
 const ids=new Set<string>(),pairs=new Set<string>();
 for(const r of snapshot.relations){const pair=JSON.stringify([r.categoryId,r.templateId]);if(!nonblank(r.id)||ids.has(r.id)||pairs.has(pair)||!categories.has(r.categoryId)||!templates.has(r.templateId))throw Error('invalid or duplicate direct relation');ids.add(r.id);pairs.add(pair)}
 const plan=planParameterMapping(catalog,mapping,snapshot.templates);
 return plan.map(p=>{
  if(p.status==='create')return {key:p.key,status:'create-template'};
  if(p.status!=='reuse'||!p.remoteId)return {key:p.key,status:'review',...(p.remoteId?{templateId:p.remoteId}:{}),reason:p.reason??'explicit semantic mapping required'};
  const templateId=p.remoteId,t=templates.get(templateId)!;
  if(!t.enabled)return {key:p.key,status:'review',templateId,reason:'mapped template disabled'};
  if(pairs.has(JSON.stringify([category.id,templateId])))return {key:p.key,status:'direct',templateId};
  const ancestorIds=ancestors.filter(a=>pairs.has(JSON.stringify([a,templateId])));
  // Report ancestry as evidence only, not a claim that the server applies inheritance.
  if(ancestorIds.length)return {key:p.key,status:'ancestor',templateId,ancestorIds,reason:'verify runtime inheritance before creating a direct association'};
  return {key:p.key,status:'associate',templateId};
 });
}
