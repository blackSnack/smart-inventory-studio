import {Button,Modal} from './ui';
import type {PartRecord} from '../../src/inventory-contract';
import type {PartSummary} from '../../src/inventory-provider';
export function LivePartDetail({part,record,busy,error,onClose,onRetry,onEnrich}:{part:PartSummary;record:PartRecord|null;busy:boolean;error:string;onClose:()=>void;onRetry:()=>void;onEnrich?:()=>void}){
 const labels=new Map<string,number>();for(const p of record?.parameters??[]){if(p.template)labels.set(p.template.name,(labels.get(p.template.name)??0)+1)}
 const row=(label:string,value:string,key=label)=><div key={key} className="grid grid-cols-2 gap-3 text-sm"><dt className="text-muted break-words">{label}</dt><dd className="text-right font-medium break-words">{value}</dd></div>;
 return <Modal presentation="detail" open onClose={onClose} title="元件详情" description="只读库存元件详情" footer={record&&onEnrich&&<Button className="w-full" variant="secondary" onClick={onEnrich}>补全资料</Button>}><div className="space-y-6"><div className="space-y-2"><h3 className="font-semibold break-words">{record?.name??part.name}</h3><p className="text-sm text-muted break-words">{(record??part).ipn||'未设置 IPN'}</p><p className="text-sm break-words">{(record??part).description}</p></div>
 {busy&&<p role="status">正在读取详情…</p>}{error&&<div className="space-y-3"><p role="alert">{error}</p><Button variant="secondary" onClick={onRetry}>重试读取</Button></div>}
 {record&&<><section className="studio-surface space-y-3"><h3 className="font-semibold">技术参数</h3>{record.parameters.length?<dl className="space-y-3">{record.parameters.map(p=>row(p.template?p.template.name+(p.template.unit?' · '+p.template.unit:'')+((labels.get(p.template.name)??0)>1?' ('+p.templateId+')':''):'参数 '+p.templateId,p.value??'未知',p.templateId))}</dl>:<p className="text-sm text-muted">暂无参数记录</p>}</section>
 <section className="studio-surface space-y-3"><h3 className="font-semibold">制造商与供应商</h3>{record.manufacturerParts.length+record.supplierParts.length?<dl className="space-y-3">{record.manufacturerParts.map((m,i)=>row(m.manufacturer,m.mpn,'m'+i))}{record.supplierParts.map((s,i)=>row(s.supplier,s.sku,'s'+i))}</dl>:<p className="text-sm text-muted">暂无来源身份记录</p>}</section>
 <section className="studio-surface space-y-3"><h3 className="font-semibold">资料链接</h3>{record.sources.length?record.sources.map((s,i)=><a key={i} href={s.url} target="_blank" rel="noopener noreferrer" className="block min-h-11 py-2 text-sm underline break-all">{s.label} · {new URL(s.url).hostname}</a>):<p className="text-sm text-muted">暂无外部资料链接</p>}</section></>}
 </div></Modal>
}
