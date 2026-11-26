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
  b.close()
finally:server.shutdown()
print('PASS: real Chromium IndexedDB atomic CAS, instance isolation, duplicate rejection and reload recovery; synthetic transport plus atomic postcommit-timeout recovery; zero-stock batch interruption/reload and idempotent readback; no real backend.')
