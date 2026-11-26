export type Constraint={key:string;operator:'eq'|'gte'|'lte';value:string;kind:'decimal'|'text'};
export type FilterResult='match'|'unknown'|'excluded';
function decimal(s:string){if(!/^\d+(?:\.\d+)?$/.test(s)||s.length>128)throw Error('invalid canonical decimal');const [a,b='']=s.split('.');return {digits:BigInt(a+b),scale:b.length}}
function compare(a:string,b:string){const x=decimal(a),y=decimal(b),scale=Math.max(x.scale,y.scale);const l=x.digits*10n**BigInt(scale-x.scale),r=y.digits*10n**BigInt(scale-y.scale);return l<r?-1:l>r?1:0}
export function filterParameters(fields:Record<string,string|null>,constraints:Constraint[]):FilterResult{
 let unknown=false;
 for(const c of constraints){if(!c.key||!c.value.trim()||c.kind==='text'&&c.operator!=='eq')throw Error('invalid constraint');if(c.kind==='decimal')decimal(c.value);
 const v=fields[c.key];if(v==null||!v.trim()){unknown=true;continue}
 let cmp:number;try{cmp=c.kind==='decimal'?compare(v,c.value):v===c.value?0:1}catch{unknown=true;continue}
 if(c.operator==='eq'?cmp!==0:c.operator==='gte'?cmp<0:cmp>0)return 'excluded';
 }return unknown?'unknown':'match';
}
export function partitionSearch<T extends {fields:Record<string,string|null>}>(items:T[],constraints:Constraint[]){const result:{matches:T[];unknown:T[];excluded:T[]}={matches:[],unknown:[],excluded:[]};for(const item of items){const s=filterParameters(item.fields,constraints);result[s==='match'?'matches':s].push(item)}return result}
