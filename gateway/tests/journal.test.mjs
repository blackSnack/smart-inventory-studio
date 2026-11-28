import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createJournal,reconcile,stopRemaining} from '../../dist/operation-journal.js';
import {snapshotKey} from '../../dist/approved-snapshot.js';
import {GatewayStore} from '../src/gateway-store.mjs';

async function fixture(t) {
  const directory=await mkdtemp(join(tmpdir(),'gateway-journal-'));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  const store=await GatewayStore.open(directory);
  t.after(()=>{try{store.close()}catch{}});
  return {directory,store};
}
function plan(id,operationId,instanceId='inventree-a') {
  return {id,instanceId,catalogHash:'catalog-v1',snapshotHash:'snapshot-v1',approvalId:'approval-v1',
    operations:[{id:operationId,kind:'receive-existing-part',payload:{quantity:2,optional:undefined,negativeZero:-0}}]};
}

test('SQLite journal preserves exact snapshots and recovers sent operations after restart',async t=>{
  const f=await fixture(t),journals=f.store.journalStore('inventree-a');
  const initial=createJournal(plan('plan-1','op-1'));
  journals.create(initial);
  const persisted=journals.read('plan-1');
  assert.equal(snapshotKey(persisted.plan),snapshotKey(initial.plan));
  const sent=structuredClone(persisted);sent.revision=1;sent.steps[0]={...sent.steps[0],state:'sent'};
  assert.equal(journals.compareAndSet('plan-1',0,sent),true);
  const stale=structuredClone(persisted);stale.revision=1;stale.steps[0]={...stale.steps[0],state:'sent'};
  assert.equal(journals.compareAndSet('plan-1',0,stale),false);
  assert.equal((await journals.pending()).length,1);
  f.store.close();

  const reopened=await GatewayStore.open(f.directory),recovered=reopened.journalStore('inventree-a');
  const afterRestart=recovered.read('plan-1');
  assert.equal(afterRestart.steps[0].state,'sent');
  let writes=0,observations=0;
  const result=await reconcile(recovered,{send:async()=>{writes++},observe:async()=>{observations++;return {status:'verified',evidence:'synthetic exact readback'}}},'plan-1','inventree-a');
  assert.equal(result.steps[0].state,'verified');
  assert.equal(writes,0);
  assert.equal(observations,1);
  assert.equal((await recovered.pending()).length,0);
  assert.throws(()=>recovered.create(createJournal(plan('plan-2','op-1'))),/operation ID already used/);
  reopened.close();
});

test('journal admission serializes pending operations and stop is durable',async t=>{
  const f=await fixture(t),journals=f.store.journalStore('inventree-a');
  journals.create(createJournal(plan('plan-1','op-1')));
  assert.throws(()=>journals.create(createJournal(plan('plan-2','op-2'))),/another operation is pending/);
  const stopped=await stopRemaining(journals,'plan-1','inventree-a',0,true);
  assert.ok(stopped.abandonment);
  assert.equal((await journals.stopped()).length,1);
  journals.create(createJournal(plan('plan-2','op-2')));
  assert.equal((await journals.pending()).length,1);
});

test('journal state is isolated by inventory instance',async t=>{
  const f=await fixture(t);
  f.store.journalStore('inventree-a').create(createJournal(plan('plan-a','op-1','inventree-a')));
  assert.throws(()=>f.store.journalStore('inventree-b').read('plan-a'),/journal not found/);
  f.store.journalStore('inventree-b').create(createJournal(plan('plan-b','op-1','inventree-b')));
});
