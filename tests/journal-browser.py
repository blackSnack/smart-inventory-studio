from pathlib import Path
from http.server import ThreadingHTTPServer,SimpleHTTPRequestHandler
from functools import partial
from threading import Thread
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parents[1]/'dist'
server=ThreadingHTTPServer(('127.0.0.1',0),partial(SimpleHTTPRequestHandler,directory=str(root)))
Thread(target=server.serve_forever,daemon=True).start()
try:
 with sync_playwright() as p:
  b=p.chromium.launch();page=b.new_page();page.goto(f'http://127.0.0.1:{server.server_port}/')
  page.evaluate("""async()=>{const {IndexedDbJournalStore:S}=await import('/indexeddb-journal.js');const {createJournal,executeNext}=await import('/operation-journal.js');
   const a=await S.open('a'),b=await S.open('a'),other=await S.open('b');
   const j=createJournal({id:'p',instanceId:'a',catalogHash:'c',snapshotHash:'s',approvalId:'approval',operations:[{id:'p:0',kind:'receipt',payload:{quantity:2}}]});
   await a.create(j);let duplicate=false;try{await a.create(j)}catch{duplicate=true}if(!duplicate)throw Error('duplicate create');
   let sends=0;const t={send:async()=>{sends++;throw Error('timeout')},observe:async()=>({status:'unknown',evidence:'not confirmed'})};
   const results=await Promise.allSettled([executeNext(a,t,'p','a'),executeNext(b,t,'p','a')]);if(sends!==1||results.filter(x=>x.status==='fulfilled').length!==1)throw Error('CAS race');
   const {reconcile}=await import('/operation-journal.js');await reconcile(a,t,'p','a');const revision=(await a.read('p')).revision;await reconcile(a,t,'p','a');if((await a.read('p')).revision!==revision)throw Error('repeated unchanged observation');if((await a.read('p')).steps[0].state!=='unknown'||(await a.pending()).length!==1||(await other.pending()).length!==0)throw Error('bad scope/state');
   a.close();b.close();other.close();
  }""")
  page.evaluate("""async()=>{const {IndexedDbJournalStore:S}=await import('/indexeddb-journal.js');const {createJournal,executeNext,stopRemaining}=await import('/operation-journal.js');
   const db='admission-fixture',a=await S.open('a',db),b=await S.open('a',db),other=await S.open('b',db);
   const make=(id,instanceId='a')=>createJournal({id,instanceId,catalogHash:'c',snapshotHash:'s',approvalId:'approval',operations:[{id:id+':0',kind:'receipt',payload:{quantity:2}}]});
   const rejected=async(fn,label)=>{let failed=false;try{await fn()}catch{failed=true}if(!failed)throw Error(label)};
   const forged=make('forged');forged.steps[0].operation.payload.quantity=99;await rejected(()=>a.create(forged),'changed approved payload accepted');
   const wrongKind=make('wrong-kind');wrongKind.steps[0].operation.kind='different';await rejected(()=>a.create(wrongKind),'changed operation kind accepted');
   const plans=[make('left'),make('right')],result=await Promise.allSettled([a.create(plans[0]),b.create(plans[1])]);
   if(result.filter(x=>x.status==='fulfilled').length!==1||(await a.pending()).length!==1)throw Error('different plan admission race');
   const winner=result[0].status==='fulfilled'?0:1,loser=1-winner;
   await other.create(make('other','b'));if((await other.pending()).length!==1)throw Error('unrelated instance blocked');
   await rejected(()=>a.create(plans[loser]),'pending plan did not block new admission');
   await stopRemaining(a,plans[winner].plan.id,'a',0,true);
   await b.create(plans[loser]);const t={send:async()=>{},observe:async()=>({status:'verified',evidence:'fixture readback'})};await executeNext(b,t,plans[loser].plan.id,'a');
   const next=make('next'),pending=a.create(next);next.plan.operations[0].payload.quantity=77;next.steps[0].operation.payload.quantity=77;await pending;
   if((await a.read('next')).steps[0].operation.payload.quantity!==2)throw Error('caller mutated queued approval');
   await rejected(()=>a.create(make('after-next')),'new pending plan not enforced');a.close();b.close();other.close();
  }""")
  page.evaluate("""async()=>{const {IndexedDbJournalStore:S}=await import('/indexeddb-journal.js');const {createJournal,executeNext}=await import('/operation-journal.js');
   const s=await S.open('integrity','journal-exact-integrity'),make=()=>createJournal({id:'p',instanceId:'integrity',catalogHash:'c',snapshotHash:'s',approvalId:'a',operations:[{id:'p:0',kind:'receipt',payload:{quantity:2,unknown:null,optional:undefined}}]});
   const rejected=async(fn)=>{let failed=false;try{await fn()}catch{failed=true}if(!failed)throw Error('lossy snapshot accepted')};
   for(const bad of [NaN,Infinity,new Date(0),new Map(),[,,]]){const j=make();j.plan.operations[0].payload.unknown=bad;j.steps[0].operation.payload.unknown=bad;await rejected(()=>s.create(j))}
   const mismatch=make();delete mismatch.steps[0].operation.payload.optional;await rejected(()=>s.create(mismatch));
   const j=make();await s.create(j);
   const mutate=await s.read('p');mutate.revision++;mutate.steps[0].state='sent';delete mutate.plan.operations[0].payload.optional;delete mutate.steps[0].operation.payload.optional;await rejected(()=>s.compareAndSet('p',0,mutate));
   const forged=await s.read('p');forged.revision++;forged.steps[0].state='sent';forged.plan.operations[0].payload.unknown=NaN;forged.steps[0].operation.payload.unknown=NaN;await rejected(()=>s.compareAndSet('p',0,forged));
   if((await s.read('p')).revision!==0)throw Error('failed CAS changed stored data');
   const done=await executeNext(s,{send:async o=>{if(!Object.hasOwn(o.payload,'optional')||o.payload.unknown!==null)throw Error('approved snapshot lost')},observe:async()=>({status:'verified',evidence:'fixture'})},'p','integrity');if(done.steps[0].state!=='verified')throw Error('valid optional field rejected');s.close()
  }""")
  page.reload()
  page.evaluate("""async()=>{const {IndexedDbJournalStore:S}=await import('/indexeddb-journal.js');const {executeNext,reconcile}=await import('/operation-journal.js');const s=await S.open('a');let sends=0;const t={send:async()=>{sends++},observe:async()=>({status:'verified',evidence:'synthetic readback'})};let blocked=false;try{await executeNext(s,t,'p','a')}catch{blocked=true}if(!blocked||sends!==0)throw Error('replay after reload');await reconcile(s,t,'p','a');if((await s.pending()).length!==0||sends!==0)throw Error('bad recovery');s.close()}""")
  page.evaluate("""async()=>{const {SyntheticInventoryStore:S,DEMO_INSTANCE,demoLocations}=await import('/synthetic-inventory.js');const {IndexedDbJournalStore:J}=await import('/indexeddb-journal.js');const {createJournal,executeNext}=await import('/operation-journal.js');const {planExistingPartReceipt}=await import('/receiving-plan.js');
   const seed=[{id:'p',name:'test',spec:'10k',partial:false,stock:{A:10}},{id:'q',name:'other',spec:'20k',partial:false,stock:{C:1}}],ids=['A','B','C'];const s=await S.open(seed,ids,'test-synthetic'),j=await J.open(DEMO_INSTANCE,'test-synthetic-journal');const before=await s.snapshot();
   const plan=planExistingPartReceipt({planId:'r',instanceId:DEMO_INSTANCE,catalogHash:'test',snapshotHash:'0',approvalId:'approval',partId:'p',identityConfirmed:true,physicalSpaceConfirmed:true,quantity:10,allocations:[{locationId:'A',quantity:4},{locationId:'B',quantity:6}]},demoLocations(before.parts,ids));await j.create(createJournal(plan));
   const fault={send:async op=>{await s.send(op);throw Error('response lost after atomic write')},observe:op=>s.observe(op)};const result=await executeNext(j,fault,'r',DEMO_INSTANCE);if(result.steps[0].state!=='unknown'||(await s.snapshot()).parts[0].stock.A!==14)throw Error('postcommit fault not captured');s.close();j.close()
  }""")
  page.reload()
  page.evaluate("""async()=>{const {SyntheticInventoryStore:S,DEMO_INSTANCE}=await import('/synthetic-inventory.js');const {IndexedDbJournalStore:J}=await import('/indexeddb-journal.js');const {reconcile,executeNext}=await import('/operation-journal.js');
   const seed=[{id:'p',name:'test',spec:'10k',partial:false,stock:{A:10}},{id:'q',name:'other',spec:'20k',partial:false,stock:{C:1}}],ids=['A','B','C'];const s=await S.open(seed,ids,'test-synthetic'),j=await J.open(DEMO_INSTANCE,'test-synthetic-journal');await reconcile(j,s,'r',DEMO_INSTANCE);const done=await executeNext(j,s,'r',DEMO_INSTANCE);const a=await s.snapshot();if(!done.steps.every(x=>x.state==='verified')||a.parts[0].stock.A!==14||a.parts[0].stock.B!==6||a.receipts.length!==2)throw Error('receipt conservation failed');
   await s.send(done.steps[0].operation);if((await s.snapshot()).parts[0].stock.A!==14)throw Error('duplicate applied');let blocked=false;try{await s.send({id:'bad',kind:'receive-existing-part',payload:{partId:'p',locationId:'C',quantity:1,expectedOccupants:['q']}})}catch{blocked=true}if(!blocked)throw Error('mixed stock accepted');s.close();j.close()
  }""")
  page.evaluate("""async()=>{const {SyntheticInventoryStore:S,DEMO_INSTANCE}=await import('/synthetic-inventory.js');const {IndexedDbJournalStore:J}=await import('/indexeddb-journal.js');const {createJournal,executeNext}=await import('/operation-journal.js');
   const seed=[{id:'p',name:'test',spec:'10k',partial:false,stock:{A:10}}],ids=['A'];const s=await S.open(seed,ids,'batch-synthetic'),j=await J.open(DEMO_INSTANCE,'batch-synthetic-journal');
   const part=id=>({id,name:id,spec:'unknown',partial:true,stock:{},details:{identity:{id,mode:'partial',category:'resistor.smd',sourceGroup:id,fields:{}},draft:{name:id},catalogVersion:'test'}});
   const plan={id:'batch',instanceId:DEMO_INSTANCE,catalogHash:'test',snapshotHash:'0',approvalId:'approval',operations:[0,1].map(i=>({id:'batch:'+i,kind:'create-demo-catalog-part',payload:{part:part('new'+i),expectedRevision:i,row:i+2}}))};
   await j.create(createJournal(plan));const fault={send:async op=>{await s.send(op);throw Error('response lost after commit')},observe:op=>s.observe(op)};
   const result=await executeNext(j,fault,'batch',DEMO_INSTANCE);if(result.steps[0].state!=='unknown'||(await s.snapshot()).parts.length!==2)throw Error('batch ambiguity not captured');s.close();j.close()
  }""")
  page.reload()
  page.evaluate("""async()=>{const {SyntheticInventoryStore:S,DEMO_INSTANCE}=await import('/synthetic-inventory.js');const {IndexedDbJournalStore:J}=await import('/indexeddb-journal.js');const {reconcile,executeNext}=await import('/operation-journal.js');
   const s=await S.open([{id:'p',name:'test',spec:'10k',partial:false,stock:{A:10}}],['A'],'batch-synthetic'),j=await J.open(DEMO_INSTANCE,'batch-synthetic-journal');
   await reconcile(j,s,'batch',DEMO_INSTANCE);const done=await executeNext(j,s,'batch',DEMO_INSTANCE);const snap=await s.snapshot();if(!done.steps.every(x=>x.state==='verified')||snap.parts.length!==3||snap.parts[0].stock.A!==10||snap.parts.slice(1).some(p=>Object.keys(p.stock).length))throw Error('batch recovery changed stock or duplicated identity');
   await s.send(done.steps[0].operation);if((await s.snapshot()).parts.length!==3)throw Error('duplicate batch operation');s.close();j.close()
  }""")
  page.evaluate("""async()=>{const {SyntheticInventoryStore:S,DEMO_INSTANCE}=await import('/synthetic-inventory.js');const {IndexedDbJournalStore:J}=await import('/indexeddb-journal.js');const {createJournal,executeNext,reconcile}=await import('/operation-journal.js');const {seedWarehouse,planCabinetSave,warehouseIds}=await import('/warehouse-state.js');const {expandCabinet}=await import('/cabinet-layout.js');
   const w=seedWarehouse([{id:'A',rows:1,cols:1}]),seed=[{id:'p',name:'test',spec:'10k',partial:false,stock:{'A-01':10}}],ids=warehouseIds(w);const s=await S.open(seed,ids,'warehouse-synthetic',indexedDB,w),j=await J.open(DEMO_INSTANCE,'warehouse-synthetic-journal');const draft=expandCabinet(w.cabinets[0].layout,{layers:1,rows:1,cols:2},'A');await j.create(createJournal(planCabinetSave('layout',DEMO_INSTANCE,0,w,draft,seed,true)));const fault={send:async op=>{await s.send(op);throw Error('lost response')},observe:op=>s.observe(op)};const unknown=await executeNext(j,fault,'layout',DEMO_INSTANCE);if(unknown.steps[0].state!=='unknown')throw Error('layout ambiguity not captured');s.close();j.close()
  }""")
  page.reload()
  page.evaluate("""async()=>{const {SyntheticInventoryStore:S,DEMO_INSTANCE}=await import('/synthetic-inventory.js');const {IndexedDbJournalStore:J}=await import('/indexeddb-journal.js');const {reconcile}=await import('/operation-journal.js');const {seedWarehouse,warehouseIds}=await import('/warehouse-state.js');const w=seedWarehouse([{id:'A',rows:1,cols:1}]);const s=await S.open([{id:'p',name:'test',spec:'10k',partial:false,stock:{'A-01':10}}],warehouseIds(w),'warehouse-synthetic',indexedDB,w),j=await J.open(DEMO_INSTANCE,'warehouse-synthetic-journal');const done=await reconcile(j,s,'layout',DEMO_INSTANCE),snap=await s.snapshot();if(done.steps[0].state!=='verified'||warehouseIds(snap.warehouse).length!==2||snap.parts[0].stock['A-01']!==10)throw Error('layout recovery integrity');await s.send(done.steps[0].operation);if((await s.snapshot()).revision!==1)throw Error('layout replay');s.close();j.close()
  }""")
  page.evaluate("""async()=>{const {SyntheticInventoryStore:S,DEMO_INSTANCE}=await import('/synthetic-inventory.js');const {IndexedDbJournalStore:J}=await import('/indexeddb-journal.js');const {createJournal,executeNext}=await import('/operation-journal.js');const {seedWarehouse,planCabinetSave,warehouseIds,previewCabinetRelocation}=await import('/warehouse-state.js');const {replaceDrawer}=await import('/cabinet-layout.js');const {splitCompartment}=await import('/storage-layout.js');const w=seedWarehouse([{id:'A',rows:1,cols:1}]),seed=[{id:'p',name:'R',spec:'10k',partial:false,stock:{'A-01':10}}],s=await S.open(seed,warehouseIds(w),'occupied-layout',indexedDB,w),j=await J.open(DEMO_INSTANCE,'occupied-layout-journal'),cell=w.cabinets[0].layout.cells[0],draft=replaceDrawer(w.cabinets[0].layout,cell.id,splitCompartment(cell.drawer,cell.drawer.compartments[0].id,'vertical',[4,8],['x','y'])),[x,y]=previewCabinetRelocation(w,draft,seed).sources[0].preferred;const moves=[{partId:'p',sourceId:'A-01',targetId:x,quantity:4},{partId:'p',sourceId:'A-01',targetId:y,quantity:6}];await j.create(createJournal(planCabinetSave('occupied',DEMO_INSTANCE,0,w,draft,seed,true,moves)));const fault={send:async op=>{await s.send(op);throw Error('response lost')},observe:op=>s.observe(op)};const unknown=await executeNext(j,fault,'occupied',DEMO_INSTANCE);if(unknown.steps[0].state!=='unknown')throw Error('occupied relocation ambiguity');s.close();j.close()}""")
  page.reload()
  page.evaluate("""async()=>{const {SyntheticInventoryStore:S,DEMO_INSTANCE}=await import('/synthetic-inventory.js');const {IndexedDbJournalStore:J}=await import('/indexeddb-journal.js');const {reconcile}=await import('/operation-journal.js');const {seedWarehouse,warehouseIds}=await import('/warehouse-state.js');const w=seedWarehouse([{id:'A',rows:1,cols:1}]),s=await S.open([{id:'p',name:'R',spec:'10k',partial:false,stock:{'A-01':10}}],warehouseIds(w),'occupied-layout',indexedDB,w),j=await J.open(DEMO_INSTANCE,'occupied-layout-journal');const done=await reconcile(j,s,'occupied',DEMO_INSTANCE),snap=await s.snapshot(),ids=warehouseIds(snap.warehouse);if(done.steps[0].state!=='verified'||ids.length!==2||snap.parts[0].stock[ids[0]]!==4||snap.parts[0].stock[ids[1]]!==6||Object.hasOwn(snap.parts[0].stock,'A-01'))throw Error('occupied relocation integrity');await s.send(done.steps[0].operation);if((await s.snapshot()).revision!==1)throw Error('occupied relocation replay');s.close();j.close()}""")
  page.evaluate("""async()=>{const {IndexedDbJournalStore:J}=await import('/indexeddb-journal.js');const {createJournal,executeNext,stopRemaining}=await import('/operation-journal.js');const j=await J.open('stop-fixture','stop-test-journal');const plan={id:'stop',instanceId:'stop-fixture',catalogHash:'c',snapshotHash:'s',approvalId:'approval',operations:[{id:'stop:0',kind:'receipt',payload:{}},{id:'stop:1',kind:'receipt',payload:{}}]};await j.create(createJournal(plan));let sent=0;const t={send:async()=>{sent++},observe:async()=>({status:'verified',evidence:'fixture readback'})};const r=await executeNext(j,t,'stop','stop-fixture');const done=await stopRemaining(j,'stop','stop-fixture',r.revision,true);if(done.abandonment.firstUnsent!==1||sent!==1||(await j.pending()).length!==0||(await j.stopped()).length!==1)throw Error('stop failed');let blocked=false;try{await executeNext(j,t,'stop','stop-fixture')}catch{blocked=true}if(!blocked||sent!==1)throw Error('stopped suffix sent');j.close()}""")
  page.reload()
  page.evaluate("""async()=>{const {IndexedDbJournalStore:J}=await import('/indexeddb-journal.js');const j=await J.open('stop-fixture','stop-test-journal'),a=await j.read('stop');if(!a.abandonment||a.steps[0].state!=='verified'||a.steps[1].state!=='planned'||(await j.pending()).length!==0)throw Error('stopped suffix not persistent');const altered=structuredClone(a);altered.revision++;delete altered.abandonment;altered.steps[1].state='sent';let rejected=false;try{await j.compareAndSet('stop',a.revision,altered)}catch{rejected=true}if(!rejected)throw Error('stopped plan revived');j.close()}""")
  b.close()
finally:server.shutdown()
print('PASS: real Chromium IndexedDB atomic CAS, instance isolation, duplicate rejection and reload recovery; synthetic transport plus atomic postcommit-timeout recovery; zero-stock batch interruption/reload and idempotent readback; no real backend.')
