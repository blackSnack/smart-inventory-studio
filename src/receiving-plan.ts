import {validateAllocation,type Allocation,type Location} from './domain.js';
import type {ApprovedPlan,Operation} from './operation-journal.js';
export interface ReceiptApproval {planId:string;instanceId:string;catalogHash:string;snapshotHash:string;approvalId:string;partId:string;identityConfirmed:boolean;physicalSpaceConfirmed:boolean;quantity:number;allocations:Allocation[];snapshotRevision?:number}
export function planExistingPartReceipt(a:ReceiptApproval,locations:Location[]):ApprovedPlan {
 if(!a.partId||!a.planId||!a.instanceId||!a.catalogHash||!a.snapshotHash||!a.approvalId||!a.identityConfirmed||!a.physicalSpaceConfirmed)throw Error('receipt approval incomplete');
 validateAllocation(a.partId,a.quantity,a.allocations,locations);
 if(a.snapshotRevision!==undefined&&(!Number.isSafeInteger(a.snapshotRevision)||a.snapshotRevision<0||!Number.isSafeInteger(a.snapshotRevision+a.allocations.length)))throw Error('invalid receipt revision');
 // Abstract operations, not InvenTree wire payload. Adapter must re-read part/leaf and
 // compare snapshot before each write. New stock item per allocation; preserve batches.
 return {id:a.planId,instanceId:a.instanceId,catalogHash:a.catalogHash,snapshotHash:a.snapshotHash,approvalId:a.approvalId,operations:a.allocations.map((allocation,index)=>({id:a.planId+':'+index,kind:'receive-existing-part',payload:{partId:a.partId,locationId:allocation.locationId,quantity:allocation.quantity,expectedOccupants:[...locations.find(l=>l.id===allocation.locationId)!.occupants],...(a.snapshotRevision!==undefined?{expectedRevision:a.snapshotRevision+index}:{})}}))};
}

// Synthetic revision is checked before a planned step is sent and atomically at the write boundary.
export function assertSyntheticReceiptRevision(operation:Operation,revision:number){
 if(operation.kind!=='receive-existing-part')return;
 if(!Number.isSafeInteger(operation.payload.expectedRevision)||operation.payload.expectedRevision!==revision)throw Error('入库审批已过期或为旧版计划，请停止未发送操作后重新审核。');
}
