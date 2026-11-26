from pathlib import Path
from http.server import ThreadingHTTPServer,SimpleHTTPRequestHandler
from functools import partial
from threading import Thread
from tempfile import TemporaryDirectory
import json, shutil, subprocess
from playwright.sync_api import sync_playwright
web=Path(__file__).resolve().parents[1]/'web'
history=web/'release-history.json';pkg=web/'package.json'
old_history=history.read_bytes();old_pkg=pkg.read_bytes()
data=json.loads(old_history);current=data[0]['version'];major,minor,patch=map(int,current.split('.'));new=f'{major}.{minor}.{patch+1}'
with TemporaryDirectory() as tmp:
 tmp=Path(tmp);site=tmp/'site';site.mkdir();path=site/'react-preview';shutil.copytree(web/'dist',path);shutil.copytree(web/'dist',tmp/'original')
 try:
  data.insert(0,{'version':new,'title':'Synthetic update acceptance','changes':['Synthetic release change']})
  history.write_text(json.dumps(data));p=json.loads(old_pkg);p['version']=new;pkg.write_text(json.dumps(p))
  subprocess.run(['npm','run','build'],cwd=web,check=True)
  server=ThreadingHTTPServer(('127.0.0.1',0),partial(SimpleHTTPRequestHandler,directory=str(site)));Thread(target=server.serve_forever,daemon=True).start()
  try:
   with sync_playwright() as pw:
    b=pw.chromium.launch();context=b.new_context(viewport={'width':390,'height':844});page=context.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    url=f'http://127.0.0.1:{server.server_port}/react-preview/'
    page.goto(url);page.get_by_test_id('current-version').get_by_text('v'+current,exact=True).wait_for()
    page.evaluate('navigator.serviceWorker.ready');page.wait_for_function('!!navigator.serviceWorker.controller')
    assert page.evaluate("async()=>!(await caches.match(new URL('version.json',location.href)))")
    page.get_by_role('button',name='检查更新',exact=True).click();page.get_by_text('没有发现更高版本。').wait_for();page.get_by_role('button',name='关闭').click()
    shutil.copytree(web/'dist',path,dirs_exist_ok=True)
    page.clock.install();page.clock.fast_forward(61000);page.get_by_test_id('latest-version').wait_for(timeout=15000)
    assert 'v'+current in page.get_by_test_id('current-version').inner_text()
    page.get_by_role('button',name='查看更新',exact=True).click();page.get_by_text('Synthetic release change',exact=True).wait_for()
    assert page.get_by_role('button',name='更新并重新加载').is_disabled()
    page.get_by_label('已保存需要保留的内容，确认重新加载').check();page.get_by_role('button',name='更新并重新加载').click()
    page.get_by_test_id('current-version').get_by_text('v'+new,exact=True).wait_for(timeout=50000)
    assert page.get_by_test_id('latest-version').count()==0
    context.set_offline(True);page.reload();page.get_by_test_id('current-version').get_by_text('v'+new,exact=True).wait_for();assert not errors,errors
    b.close()
  finally:server.shutdown()
 finally:
  history.write_bytes(old_history);pkg.write_bytes(old_pkg);shutil.rmtree(web/'dist');shutil.copytree(tmp/'original',web/'dist')
print('PASS: actual two-build PWA update, 60-second polling, release diff, confirmation, activated version, project scope and offline reload.')
