// Pure journal orchestration. Persist with a provider-instance scoped CAS store.
// No API writes are implemented here: the transport must be verified separately.
export interface Operation {id:string;kind:string;payload:Record<string,unknown>}
export interface ApprovedPlan {id:string;instanceId:string;catalogHash:string;snapshotHash:string;approvalId:string;operations:Operation[]}
export type StepState='planned'|'sent'|'verified'|'unknown'|'blocked';
export interface Step {operation:Operation;state:StepState;evidence?:string}
export interface Journal {plan:ApprovedPlan;revision:number;steps:Step[];abandonment?:{firstUnsent:number;evidence:string}}
export interface JournalStore {read(id:string):Promise<Journal>;compareAndSet(id:string,revision:number,next:Journal):Promise<boolean>}
export type Observation={status:'verified'|'unknown'|'blocked';evidence:string};
export interface OperationTransport {send(operation:Operation):Promise<void>;observe(operation:Operation):Promise<Observation>}
const copy=<T>(v:T):T=>structuredClone(v);
export function createJournal(plan:ApprovedPlan):Journal{
 if(!plan.id||!plan.instanceId||!plan.catalogHash||!plan.snapshotHash||!plan.approvalId||!plan.operations.length||plan.operations.some(o=>!o.id||!o.kind)||new Set(plan.operations.map(o=>o.id)).size!==plan.operations.length)throw Error('invalid approved plan');
 return {plan:copy(plan),revision:0,steps:plan.operations.map(operation=>({operation:copy(operation),state:'planned'}))};
}
function assertInstance(j:Journal,instanceId:string){if(j.plan.instanceId!==instanceId)throw Error('wrong inventory instance')}
function transition(j:Journal,index:number,state:StepState,evidence?:string):Journal{
 const next=copy(j);next.revision++;next.steps[index]={...next.steps[index],state,evidence};return next;
}
async function save(store:JournalStore,j:Journal,next:Journal){if(!await store.compareAndSet(j.plan.id,j.revision,next))throw Error('journal revision conflict');return next}
async function observe(t:OperationTransport,o:Operation):Promise<Observation>{try{const r=await t.observe(copy(o));if(!r.evidence?.trim()||!['verified','unknown','blocked'].includes(r.status))return {status:'unknown',evidence:'Invalid observation'};return r}catch{return {status:'unknown',evidence:'Readback unavailable'}}}
export async function executeNext(store:JournalStore,transport:OperationTransport,planId:string,instanceId:string):Promise<Journal>{
 let j=await store.read(planId);assertInstance(j,instanceId);if(j.abandonment)throw Error('remaining operations stopped');const i=j.steps.findIndex(s=>s.state!=='verified');if(i<0)return j;
 const step=j.steps[i];if(step.state!=='planned')throw Error('reconcile or reapprove before continuing');
 // Persist sent BEFORE request; if process dies after this, recovery observes, never resends.
 j=await save(store,j,transition(j,i,'sent'));
 try{await transport.send(copy(step.operation))}catch{return save(store,j,transition(j,i,'unknown','Request outcome ambiguous; readback required'))}
 const r=await observe(transport,step.operation);return save(store,j,transition(j,i,r.status,r.evidence));
}
export async function reconcile(store:JournalStore,transport:OperationTransport,planId:string,instanceId:string):Promise<Journal>{
 const j=await store.read(planId);assertInstance(j,instanceId);if(j.abandonment)throw Error('remaining operations stopped');const i=j.steps.findIndex(s=>s.state!=='verified');if(i<0)return j;const s=j.steps[i];if(s.state!=='sent'&&s.state!=='unknown'&&s.state!=='blocked')throw Error('step not eligible for reconciliation');
 const r=await observe(transport,s.operation);if(s.state===r.status&&s.evidence===r.evidence)return j;return save(store,j,transition(j,i,r.status,r.evidence));
}

// Stop only a never-sent suffix at the reviewed revision. Verified writes are retained.
export async function stopRemaining(store:JournalStore,planId:string,instanceId:string,expectedRevision:number,confirmed:boolean):Promise<Journal>{
 const j=await store.read(planId);assertInstance(j,instanceId);if(confirmed!==true||j.abandonment||j.revision!==expectedRevision)throw Error('stop requires a fresh explicit confirmation');
 const i=j.steps.findIndex(s=>s.state!=='verified');if(i<0||j.steps.slice(i).some(s=>s.state!=='planned'))throw Error('unresolved sent operations require readback before stopping');
 const next=copy(j);next.revision++;next.abandonment={firstUnsent:i,evidence:'Operator confirmed stop of never-sent remainder; verified effects retained'};return save(store,j,next);
}
