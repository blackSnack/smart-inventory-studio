from pathlib import Path
from http.server import ThreadingHTTPServer,SimpleHTTPRequestHandler
from functools import partial
from threading import Thread
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parents[1]/'web'/'dist'
server=ThreadingHTTPServer(('127.0.0.1',0),partial(SimpleHTTPRequestHandler,directory=str(root)))
Thread(target=server.serve_forever,daemon=True).start()
try:
 with sync_playwright() as p:
  b=p.chromium.launch();page=b.new_page(viewport={'width':390,'height':844});errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  seen=[]
  def api(route):
   req=route.request;seen.append((req.method,req.url))
   headers={'access-control-allow-origin':'*','access-control-allow-headers':'authorization,content-type','access-control-allow-methods':'GET, OPTIONS'}
   if req.method=='OPTIONS':route.fulfill(status=204,headers=headers);return
   assert req.method=='GET';assert req.headers.get('authorization')=='Token synthetic-test'
   if '/api/stock/location/' in req.url: data=[{'pk':1,'name':'Cabinet A','parent':None,'structural':True},{'pk':2,'name':'A-01','parent':1,'structural':False}]
   elif '/api/part/' in req.url:data=[{'pk':42,'name':'10k resistor','IPN':'R-01','description':'±1%','category':1},{'pk':43,'name':'10k unknown','IPN':'R-02','description':'Partial','category':1}]
   elif 'part=42' in req.url:data=[{'pk':9,'part':42,'location':2,'quantity':'100'}]
   else:data=[]
   route.fulfill(json=data,headers=headers)
  page.route('https://inventory.example.test/**',api)
  page.goto(f'http://127.0.0.1:{server.server_port}/');page.get_by_role('button',name='设置',exact=True).click();page.get_by_role('button',name='真实库存只读验证').click()
  page.get_by_label('服务地址').fill('https://inventory.example.test');page.get_by_label('只读 API Token').fill('synthetic-test');page.get_by_role('button',name='测试并连接').click()
  page.get_by_text('已连接 · 只读',exact=True).wait_for();page.get_by_label('全局库存搜索').fill('10k');page.get_by_role('button',name='搜索',exact=True).click()
  page.get_by_text('找到 2 种元件').wait_for();page.get_by_text('Cabinet A / A-01',exact=True).wait_for();page.get_by_text('100 件',exact=True).wait_for();page.get_by_text('已建档，暂无库存记录').wait_for()
  page.get_by_role('button',name='首页',exact=True).click();page.get_by_role('button',name='手动录入草稿').click()
  page.get_by_label('元件分类').select_option('resistor.smd');page.get_by_label('元件名称').fill('10k test resistor');page.get_by_label('阻值 · Ω').fill('10kΩ')
  page.get_by_label('已核对草稿和来源',exact=False).check();assert page.get_by_role('button',name='导出审核草稿').is_enabled()
  page.get_by_label('阻值 · Ω').fill('20kΩ');assert page.get_by_role('button',name='导出审核草稿').is_disabled()
  page.get_by_label('已核对草稿和来源',exact=False).check();page.get_by_role('button',name='手动录入草稿').click();assert not page.get_by_label('已核对草稿和来源',exact=False).is_checked()
  assert all(m in ('GET','OPTIONS') for m,u in seen);assert page.evaluate("!Object.values(localStorage).some(v=>v.includes('synthetic-test'))");assert not errors,errors;b.close()
finally:server.shutdown()
print('PASS: explicit read-only connection, global result distribution, zero stock distinction, no credential persistence (mocked network).')
