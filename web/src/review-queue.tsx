import {Button} from './ui';
type Item={id:string;name:string;status:string;count?:number};
export function ReviewQueue({items,active,onSelect}:{items:Item[];active:string|null;onSelect:(id:string)=>void}){
 return <nav className="studio-review-queue studio-list-group" aria-label="元件审核队列"><h3>审核队列</h3>{items.map(item=><Button key={item.id} variant="ghost" aria-current={active===item.id?'true':undefined} className="studio-queue-row" onClick={()=>onSelect(item.id)}><span className="min-w-0 break-words">{item.name} · {item.status}{item.count?' · '+item.count+' 项已选':''}</span></Button>)}</nav>
}
