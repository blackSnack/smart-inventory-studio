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
  seen=[];detail_enabled=False;detail_fail=False
  def api(route):
   req=route.request;seen.append((req.method,req.url))
   headers={'access-control-allow-origin':'*','access-control-allow-headers':'authorization,content-type','access-control-allow-methods':'GET, OPTIONS'}
   if req.method=='OPTIONS':route.fulfill(status=204,headers=headers);return
   assert req.method=='GET';assert req.headers.get('authorization')=='Token synthetic-test'
   if '/api/schema/' in req.url:
    paths=['/api/parameter/','/api/parameter/template/']
    if detail_enabled:paths+=['/api/part/{id}/','/api/part/category/','/api/part/category/parameters/','/api/company/part/manufacturer/','/api/company/part/','/api/attachment/']
    data={'openapi':'3.0.3','paths':{p:{'get':{}} for p in paths}}
   elif '/api/part/42/' in req.url:
    if detail_fail:route.fulfill(status=403,headers=headers);return
    data={'pk':42,'name':'10k resistor','IPN':'R-01','description':'±1%','category':1}
   elif '/api/company/part/manufacturer/' in req.url:data=[{'pk':21,'part':42,'manufacturer':3,'manufacturer_detail':{'pk':3,'name':'Fixture Maker'},'MPN':'FIX-10K'}]
   elif '/api/company/part/' in req.url:data=[{'pk':22,'part':42,'supplier':9,'supplier_detail':{'pk':9,'name':'Fixture Supplier'},'SKU':'SKU-10K'}]
   elif '/api/attachment/' in req.url:data=[{'pk':31,'model_type':'part','model_id':42,'link':'https://example.test/manual','comment':'Fixture manual'}]
   elif '/api/parameter/template/' in req.url: data=[{'pk':5,'name':'Resistance','units':'Ω','model_type':'part.part','enabled':True}]
   elif '/api/parameter/' in req.url: data=[{'pk':20,'model_id':42,'model_type':'part.part','template':5,'data':'10kΩ'}]
   elif '/api/stock/location/' in req.url: data=[{'pk':1,'name':'Cabinet A','parent':None,'structural':True},{'pk':2,'name':'A-01','parent':1,'structural':False}]
   elif '/api/part/' in req.url:data=[{'pk':42,'name':'10k resistor','IPN':'R-01','description':'±1%','category':1},{'pk':43,'name':'10k unknown','IPN':'R-02','description':'Partial','category':1}]
   elif 'part=42' in req.url:data=[{'pk':9,'part':42,'location':2,'quantity':'100'}]
   else:data=[]
   route.fulfill(json=data,headers=headers)
  page.route('https://inventory.example.test/**',api)
  page.goto(f'http://127.0.0.1:{server.server_port}/');page.get_by_role('button',name='设置',exact=True).click();page.get_by_role('button',name='真实库存只读验证').click()
  page.get_by_label('服务地址').fill('https://inventory.example.test');page.get_by_label('只读 API Token').fill('synthetic-test');page.get_by_role('button',name='测试并连接').click()
  page.get_by_text('已连接 · 只读',exact=True).wait_for();page.get_by_label('全局库存搜索').fill('10k');page.get_by_role('button',name='搜索',exact=True).click()
  page.get_by_text('找到 2 种元件').wait_for();page.get_by_text('Cabinet A / A-01',exact=True).wait_for();page.get_by_text('100 件',exact=True).wait_for();page.get_by_text('已建档，暂无库存记录').wait_for()
  assert not any('/api/schema/' in u for m,u in seen)
  page.get_by_role('button',name='查看 R-01 详情').click();dialog=page.get_by_role('dialog',name='元件详情');dialog.get_by_role('alert').wait_for();assert not any('/api/part/42/' in u for m,u in seen)
  detail_enabled=True;detail_fail=True;dialog.get_by_role('button',name='重试读取').click();dialog.get_by_role('alert').wait_for()
  detail_fail=False;dialog.get_by_role('button',name='重试读取').click();dialog.get_by_text('FIX-10K',exact=True).wait_for();dialog.get_by_text('SKU-10K',exact=True).wait_for();dialog.get_by_text('10kΩ',exact=True).wait_for();assert dialog.get_by_role('link',name='Fixture manual · example.test').get_attribute('href')=='https://example.test/manual'
  assert dialog.evaluate('e=>e.getBoundingClientRect().right<=innerWidth+1&&e.getBoundingClientRect().left>=-1')
  evidence=root.parents[1]/'design-evidence';evidence.mkdir(exist_ok=True);page.screenshot(path=str(evidence/'21-live-part-detail.jpg'),type='jpeg',quality=65)
  dialog.get_by_role('button',name='关闭').click();assert page.get_by_role('dialog').count()==0
  page.get_by_text('技术参数筛选',exact=True).click();page.get_by_role('button',name='读取参数模板').click();page.get_by_label('参数模板').select_option('5');page.get_by_label('数值比较').check();page.get_by_label('参数值').fill('10000');page.get_by_role('button',name='应用参数筛选').click();page.get_by_text('找到 1 种元件').wait_for();page.get_by_text('另有 1 种参数未知，未计入严格匹配。').wait_for();assert page.get_by_text('10k unknown',exact=True).count()==0
  page.get_by_role('button',name='首页',exact=True).click();page.get_by_role('button',name='手动录入草稿').click()
  page.get_by_label('元件分类').select_option('resistor.smd');page.get_by_label('元件名称').fill('10k test resistor');page.get_by_label('阻值 · Ω').fill('10kΩ')
  page.get_by_label('已核对草稿和来源',exact=False).check();assert page.get_by_role('button',name='导出审核草稿').is_enabled()
  page.get_by_label('阻值 · Ω').fill('20kΩ');assert page.get_by_role('button',name='导出审核草稿').is_disabled()
  page.get_by_label('已核对草稿和来源',exact=False).check();page.get_by_role('button',name='手动录入草稿').click();assert not page.get_by_label('已核对草稿和来源',exact=False).is_checked()
  assert all(m in ('GET','OPTIONS') for m,u in seen);assert page.evaluate("!Object.values(localStorage).some(v=>v.includes('synthetic-test'))");assert not errors,errors;b.close()
finally:server.shutdown()
print('PASS: explicit read-only connection, global result distribution, zero stock distinction, no credential persistence (mocked network).')
