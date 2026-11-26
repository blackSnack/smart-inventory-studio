import type {Evidence} from './enrichment-review.js';
import type {PhotoDraft} from './ai-provider.js';
import {parseDraft} from './ai-provider.js';
import {categoryPolicy,type Catalog} from './catalog.js';
import {canonicalFields,resolveCandidates} from './identity-resolution.js';
import {validateAllocation,type Identity,type Allocation,type Location} from './domain.js';
import type {ApprovedPlan} from './operation-journal.js';
export interface DemoPartDetails {identity:Identity;draft:PhotoDraft;catalogVersion:string;fieldEvidence?:Record<string,Evidence[]>}
export interface DraftPart {id:string;name:string;spec:string;partial:boolean;stock:Record<string,number>;details?:DemoPartDetails}
const fixtures:Record<string,{category:string;fields:Record<string,string|null>}>={
 'RES-001':{category:'resistor.smd',fields:{resistance:'10000',tolerance:'±1%',package:'0603',rated_power:'0.1'}},
 'RES-002':{category:'resistor.smd',fields:{resistance:'10000',tolerance:'±5%',package:'0603',rated_power:'0.1'}},
 'CAP-001':{category:'capacitor.ceramic',fields:{capacitance:'0.00001',rated_voltage:'25',package:'0805',tolerance:'±10%',dielectric_class:'X7R'}},
 'CAP-002':{category:'capacitor.ceramic',fields:{capacitance:'0.00001',rated_voltage:'25',package:'0805',tolerance:null,dielectric_class:null}},
};
export function demoIdentity(p:DraftPart):Identity|null{
 if(p.details)return p.details.identity;
 const f=fixtures[p.id];return f?{id:p.id,mode:'partial',sourceGroup:p.id,...f}:null;
}
const trim=(x:string|null)=>x?.trim()||undefined;
export function strongIdentity(a:Identity,b:Identity):boolean{
 const same=(x?:string,y?:string)=>!!x?.trim()&&x.trim()===y?.trim();
 return same(a.manufacturer,b.manufacturer)&&same(a.mpn,b.mpn)||same(a.supplier,b.supplier)&&same(a.sku,b.sku);
}
export function prepareDemoDraft(raw:PhotoDraft,catalog:Catalog,mode:'exact'|'partial',id:string,parts:DraftPart[]){
 const draft=parseDraft({...raw,sourceUrls:raw.sourceUrls.map(s=>s.trim()).filter(Boolean)},catalog.categories.map(c=>c.key));
 if(!id||!draft.name?.trim()||!draft.category)throw Error('名称及分类必填');
 const category=catalog.categories.find(c=>c.key===draft.category)!;
 if(!category.identityPolicy.supportedModes.includes(mode))throw Error('不支持该身份类型');
 const manufacturer=trim(draft.manufacturer),mpn=trim(draft.mpn),supplier=trim(draft.supplier),sku=trim(draft.sku);
 if(mode==='exact'&&(!(manufacturer&&mpn)&&!(supplier&&sku)||!draft.sourceUrls.length))throw Error('精确身份需要完整型号或供应商编号以及可信来源链接');
 const values={...draft.parameters};for(const k of category.parameters){const d=catalog.fieldDefinitions[k],v=values[k]?.trim();if(v&&d.type==='number'&&d.unit&&['Ω','F','H','V','W','A'].includes(d.unit)&&/^\d+(?:\.\d+)?$/.test(v))values[k]=v+' '+d.unit}
 const fields=canonicalFields(category.key,values,catalog);
 const identity:Identity={id,category:category.key,mode,manufacturer,mpn,supplier,sku,sourceGroup:mode==='partial'?id:undefined,fields};
 const candidates=parts.flatMap(p=>{const c=demoIdentity(p);return c?[c]:[]});
 const resolution=resolveCandidates(identity,candidates,categoryPolicy(catalog,category.key),true,true);
 const strong=candidates.filter(c=>strongIdentity(identity,c));
 const blocked=resolution.decision==='blocked'||strong.length>0&&resolution.decision!=='reuse';
 const spec=category.parameters.flatMap(k=>{const v=draft.parameters[k];return v?[v]:[]}).slice(0,4).join(' · ')||'参数未知';
 const part:DraftPart={id,name:draft.name.trim(),spec,partial:mode==='partial',stock:{},details:{identity,draft,catalogVersion:catalog.catalogVersion}};
 return {part,resolution,blocked};
}
export function planNewDemoReceipt(planId:string,instanceId:string,revision:number,part:DraftPart,quantity:number,allocations:Allocation[],locations:Location[],approved:boolean):ApprovedPlan{
 if(!approved||!part.details||Object.keys(part.stock).length||!Number.isSafeInteger(revision)||revision<0||!planId||!instanceId)throw Error('新元件入库审核不完整');
 validateAllocation(part.id,quantity,allocations,locations);
 // Synthetic provider can atomically create and receive. Real REST adapter must use its own multi-step journal.
 return {id:planId,instanceId,catalogHash:part.details.catalogVersion,snapshotHash:String(revision),approvalId:planId,operations:[{id:planId+':0',kind:'create-demo-part-and-receive',payload:{part,quantity,allocations,expectedRevision:revision}}]};
}
