import type {ApprovedPlan} from './operation-journal.js';
export interface StockSnapshot {id:string;partId:string;locationId:string;quantity:number}
export interface TargetLeaf {id:string;structural:boolean;occupants:string[]}
export interface Move {stockId:string;targetId:string;quantity:number}
export interface TransferApproval {id:string;instanceId:string;catalogHash:string;snapshotHash:string;approvalId:string;physicalConfirmed:boolean}
export function planWarehouseTransfer(a:TransferApproval,stocks:StockSnapshot[],targets:TargetLeaf[],moves:Move[],retiring:string[]):ApprovedPlan{
 if(!a.physicalConfirmed||![a.id,a.instanceId,a.catalogHash,a.snapshotHash,a.approvalId].every(v=>v.trim())||!moves.length)throw Error('missing approval');
 if(new Set(stocks.map(s=>s.id)).size!==stocks.length||new Set(targets.map(t=>t.id)).size!==targets.length)throw Error('duplicate snapshot ID');
 if(stocks.some(s=>!Number.isSafeInteger(s.quantity)||s.quantity<=0))throw Error('invalid source quantity');
 const totals=new Map<string,number>(),occupancy=new Map(targets.map(t=>[t.id,new Set(t.occupants)])),keys=new Set<string>();
 for(const m of moves){const s=stocks.find(s=>s.id===m.stockId),t=targets.find(t=>t.id===m.targetId),key=JSON.stringify([m.stockId,m.targetId]);
 if(!s||!t||t.structural||retiring.includes(t.id)||s.locationId===t.id||keys.has(key)||!Number.isSafeInteger(m.quantity)||m.quantity<=0)throw Error('invalid move');keys.add(key);
 const n=(totals.get(s.id)??0)+m.quantity;if(!Number.isSafeInteger(n)||n>s.quantity)throw Error('quantity exceeded');totals.set(s.id,n);
 const o=occupancy.get(t.id)!;o.add(s.partId);if(o.size>1)throw Error('mixed target');
 }
 for(const s of stocks)if(retiring.includes(s.locationId)&&totals.get(s.id)!==s.quantity)throw Error('retiring location retains stock');
 return {id:a.id,instanceId:a.instanceId,catalogHash:a.catalogHash,snapshotHash:a.snapshotHash,approvalId:a.approvalId,operations:moves.map((m,i)=>{const s=stocks.find(s=>s.id===m.stockId)!;return {id:a.id+':'+i,kind:'transfer-stock',payload:{stockId:s.id,partId:s.partId,sourceId:s.locationId,targetId:m.targetId,quantity:m.quantity}}})};
}
