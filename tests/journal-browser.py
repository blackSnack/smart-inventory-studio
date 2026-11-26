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
   if((await a.read('p')).steps[0].state!=='unknown'||(await a.pending()).length!==1||(await other.pending()).length!==0)throw Error('bad scope/state');
   a.close();b.close();other.close();
  }""")
  page.reload()
  page.evaluate("""async()=>{const {IndexedDbJournalStore:S}=await import('/indexeddb-journal.js');const {executeNext,reconcile}=await import('/operation-journal.js');const s=await S.open('a');let sends=0;const t={send:async()=>{sends++},observe:async()=>({status:'verified',evidence:'synthetic readback'})};let blocked=false;try{await executeNext(s,t,'p','a')}catch{blocked=true}if(!blocked||sends!==0)throw Error('replay after reload');await reconcile(s,t,'p','a');if((await s.pending()).length!==0||sends!==0)throw Error('bad recovery');s.close()}""")
  b.close()
finally:server.shutdown()
print('PASS: real Chromium IndexedDB atomic CAS, instance isolation, duplicate rejection and reload recovery; synthetic transport only.')
