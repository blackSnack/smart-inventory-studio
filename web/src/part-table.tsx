import type {DemoPart} from '../../src/synthetic-inventory';
import {demoIdentity} from '../../src/demo-part-draft';
import {ChevronRight} from './icons';
type Props={parts:DemoPart[];names:Record<string,string>;selection:boolean;selected:string[];activeId?:string;onSelect:(id:string,checked:boolean)=>void;onChoose:(part:DemoPart)=>void};
/** One responsive table, with a compact two-line record layout on phones. */
export function PartTable({parts,names,selection,selected,activeId,onSelect,onChoose}:Props){
 if(!parts.length)return <p role="status" className="studio-surface text-center text-sm text-muted">未找到匹配元件</p>;
 return <div className="studio-list-group"><table className="studio-parts-table w-full"><thead><tr>{selection&&<th scope="col" className="studio-col-check"><span className="sr-only">选择</span></th>}<th scope="col">元件名称</th><th scope="col">规格</th><th scope="col">库位</th><th scope="col" className="text-right">库存</th></tr></thead><tbody>{parts.map(p=>{const bins=Object.entries(p.stock).filter(([,n])=>n>0);const qty=bins.reduce((sum,[,n])=>sum+n,0),identity=demoIdentity(p);return <tr key={p.id} data-active={activeId===p.id} data-selected={selected.includes(p.id)} data-selection={selection}>
 {selection&&<td className="studio-col-check"><label className="studio-table-checkbox"><input type="checkbox" aria-label={'选择 '+p.name+' '+p.id} checked={selected.includes(p.id)} disabled={!selected.includes(p.id)&&selected.length>=100} onChange={e=>onSelect(p.id,e.target.checked)}/></label></td>}
 <td className="studio-col-name"><button type="button" className="studio-table-open studio-result" aria-label={'查看 '+p.id} aria-expanded={activeId===p.id} onClick={()=>onChoose(p)}><strong className="break-words">{p.name}</strong><span className="block text-xs text-muted break-all">{[p.id,identity?.manufacturer,identity?.mpn,identity?.supplier,identity?.sku].filter(Boolean).join(' · ')}</span>{p.partial&&<span className="block text-xs text-warn">资料不完整 · 独立库存</span>}</button></td>
 <td className="studio-col-spec text-sm break-words">{p.spec}</td><td className="studio-col-location text-sm">{bins.length?bins.slice(0,2).map(([id,n])=><span className="studio-location-chip" key={id}>{Object.hasOwn(names,id)?names[id]:id} · {n}</span>):<span className="text-muted">暂无库存</span>}{bins.length>2&&<span className="text-xs text-muted">另 {bins.length-2} 处</span>}</td><td className="studio-col-qty"><span className="tabular-nums font-semibold">{qty} 件</span><span className="studio-table-chevron"><ChevronRight/></span></td>
 </tr>})}</tbody></table></div>
}
