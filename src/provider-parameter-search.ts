import type {PartSummary} from './inventory-provider.js';import type {SearchParameterTemplate,SearchParameterValue} from './inventory-contract.js';import {filterParameters,type Constraint} from './parameter-search.js';import {normalizeSI} from './domain.js';
export interface NativeFilter {templateId:string;operator:Constraint['operator'];kind:Constraint['kind'];value:string}
function scalar(raw:string,t:SearchParameterTemplate,kind:Constraint['kind']){const v=raw.trim();if(kind==='text')return v;if(/^\d+(?:\.\d+)?$/.test(v))return v;
 if(t.unit&&['Ω','F','H','V','W','A'].includes(t.unit)){try{return normalizeSI(v,t.unit as 'Ω'|'F'|'H'|'V'|'W'|'A')}catch{return null}}return null}
export function partitionProviderParts(parts:PartSummary[],template:SearchParameterTemplate,values:SearchParameterValue[],filter:NativeFilter){
 if(filter.templateId!==template.id||!filter.value.trim()||!['eq','gte','lte'].includes(filter.operator)||!['decimal','text'].includes(filter.kind)||filter.kind==='text'&&filter.operator!=='eq')throw Error('invalid parameter filter');
 const wanted=scalar(filter.value,template,filter.kind);if(wanted===null||!wanted||filter.kind==='decimal'&&!/^\d+(?:\.\d+)?$/.test(wanted))throw Error('invalid numeric filter');
 const byId=new Map<string,string|null>();for(const v of values){if(v.templateId!==template.id||byId.has(v.partId))throw Error('invalid parameter snapshot');byId.set(v.partId,v.value)}
 const matches:PartSummary[]=[],unknown:PartSummary[]=[];const constraint:Constraint={key:'parameter',kind:filter.kind,operator:filter.operator,value:wanted};
 for(const p of parts){const raw=byId.get(p.id),value=raw?scalar(raw,template,filter.kind):null;const r=filterParameters({parameter:value},[constraint]);if(r==='match')matches.push(p);else if(r==='unknown')unknown.push(p)}
 return {matches,unknown};
}
