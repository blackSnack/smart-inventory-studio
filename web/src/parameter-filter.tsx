import {useState} from 'react';import {Button,Panel} from './ui';import {validateCatalog} from '../../src/catalog';import {canonicalFields} from '../../src/identity-resolution';import {partitionSearch,type Constraint} from '../../src/parameter-search';import {demoIdentity} from '../../src/demo-part-draft';import type {DemoPart} from '../../src/synthetic-inventory';import seed from '../../catalog/electronic-parts.json';
const catalog=validateCatalog(seed);
export interface FilterSelection {category:string;constraints:Constraint[];includeUnknown:boolean}
export function filterDemoParts(parts:DemoPart[],selection:FilterSelection){
 const items=parts.flatMap(part=>{const f=demoIdentity(part);return f?.category===selection.category?[{part,fields:f.fields}]:[]});
 const r=partitionSearch(items,selection.constraints);return {matches:r.matches.map(x=>x.part),unknown:r.unknown.map(x=>x.part)}
}
const siUnits=['Ω','F','H','V','W','A'];
function toConstraint(category:string,key:string,operator:Constraint['operator'],input:string):Constraint{
 const field=catalog.fieldDefinitions[key];if(!field||!catalog.categories.find(c=>c.key===category)?.parameters.includes(key)||!input.trim())throw Error('请选择参数并输入值');
 const numeric=field.type==='number';if(!numeric&&operator!=='eq')throw Error('文本参数只支持相等筛选');
 let value=input.trim();
 if(numeric&&field.unit&&siUnits.includes(field.unit)&&/^\d+(?:\.\d+)?$/.test(value))value+=' '+field.unit;
 value=canonicalFields(category,{[key]:value},catalog)[key]??'';
 if(numeric&&!/^\d+(?:\.\d+)?$/.test(value))throw Error('请输入非负数值，或带明确单位的 SI 表达式');
 return {key,operator,value,kind:numeric?'decimal':'text'};
}
export function ParameterFilter({selection,onChange}:{selection:FilterSelection|null;onChange:(s:FilterSelection|null)=>void}){
 const [expanded,setExpanded]=useState(false),[field,setField]=useState(''),[operator,setOperator]=useState<Constraint['operator']>('eq'),[value,setValue]=useState(''),[error,setError]=useState('');
 const category=catalog.categories.find(c=>c.key===selection?.category),chosen=category?.parameters.includes(field)?field:category?.parameters[0]??'',definition=catalog.fieldDefinitions[chosen];
 function selectCategory(key:string){setField('');setOperator('eq');setValue('');setError('');onChange(key?{category:key,constraints:[],includeUnknown:true}:null)}
 function add(){if(!selection)return;try{const c=toConstraint(selection.category,chosen,operator,value);onChange({...selection,constraints:[...selection.constraints.filter(x=>x.key!==c.key||x.operator!==c.operator),c]});setValue('');setError('')}catch(e){setError(e instanceof Error?e.message:'参数无效')}}
 return <Panel className="space-y-2"><details open={expanded} onToggle={e=>setExpanded(e.currentTarget.open)}><summary className="studio-summary font-medium cursor-pointer min-h-11 flex items-center"><span>技术参数筛选</span>{selection&&<span className="ml-2 text-xs text-muted">（{selection.constraints.length} 条条件）</span>}</summary>
 <div className="space-y-3"><label className="block">筛选分类<select aria-label="筛选分类" value={selection?.category??''} onChange={e=>selectCategory(e.target.value)}><option value="">全部分类</option>{catalog.categories.map(c=><option key={c.key} value={c.key}>{(c as typeof c & {labelZh?:string}).labelZh??c.key}</option>)}</select></label>
 {category&&selection&&<><label className="block">技术参数<select aria-label="技术参数" value={chosen} onChange={e=>{setField(e.target.value);setOperator('eq');setValue('');setError('')}}>{category.parameters.map(k=><option key={k} value={k}>{catalog.fieldDefinitions[k].labelZh}</option>)}</select></label>
 <div className="grid grid-cols-[100px_1fr] gap-2"><label>比较方式<select aria-label="比较方式" value={operator} onChange={e=>setOperator(e.target.value as Constraint['operator'])}><option value="eq">等于</option>{definition?.type==='number'&&<><option value="gte">不低于</option><option value="lte">不高于</option></>}</select></label><label>参数值<input value={value} onChange={e=>setValue(e.target.value)} placeholder={definition?.unit?'单位 '+definition.unit:'精确规格'}/></label></div>
 <Button variant="secondary" disabled={!value.trim()} onClick={add}>添加筛选条件</Button>{error&&<p role="alert" className="text-sm text-warn">{error}</p>}
 {selection.constraints.map((c,i)=><div key={c.key+c.operator} className="flex items-center justify-between gap-2 border-t border-line pt-2"><span className="text-sm">{catalog.fieldDefinitions[c.key].labelZh} {c.operator==='eq'?'=':c.operator==='gte'?'≥':'≤'} {c.value} {catalog.fieldDefinitions[c.key].unit??''}</span><Button variant="ghost" aria-label={'移除条件 '+(i+1)} onClick={()=>onChange({...selection,constraints:selection.constraints.filter((_,j)=>j!==i)})}>移除</Button></div>)}
 <label className="flex gap-2 items-center text-sm"><input type="checkbox" checked={selection.includeUnknown} onChange={e=>onChange({...selection,includeUnknown:e.target.checked})}/>显示参数未知的待确认候选</label><Button variant="ghost" onClick={()=>selectCategory('')}>清除参数筛选</Button></>}
 </div></details></Panel>
}
