from photo_intake_fixture import label_png,response_label,gateway_route
from pathlib import Path
from http.server import ThreadingHTTPServer,SimpleHTTPRequestHandler
from functools import partial
from threading import Thread
from playwright.sync_api import sync_playwright
from live_metadata_fixture import cabinet_response
from live_enrichment_fixture import exercise_live_enrichment
from native_browser_fixture import exercise_native_browser
root=Path(__file__).resolve().parents[1]/'web'/'dist'
server=ThreadingHTTPServer(('127.0.0.1',0),partial(SimpleHTTPRequestHandler,directory=str(root)))
Thread(target=server.serve_forever,daemon=True).start()
try:
 with sync_playwright() as p:
  b=p.chromium.launch();page=b.new_page(viewport={'width':390,'height':844});errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  seen=[];detail_enabled=False;detail_fail=False;label_fail=False;metadata_enabled=False;metadata_mode='valid';stock_mode='positive';identity_fail=False
  def api(route):
   req=route.request;seen.append((req.method,req.url))
   headers={'access-control-allow-origin':'*','access-control-allow-headers':'authorization,content-type','access-control-allow-methods':'GET, OPTIONS'}
   if req.method=='OPTIONS':route.fulfill(status=204,headers=headers);return
   assert req.method=='GET';assert req.headers.get('authorization')=='Token synthetic-test'
   if '/api/schema/' in req.url:
    paths=['/api/parameter/','/api/parameter/template/']
    if detail_enabled:paths+=['/api/part/{id}/','/api/part/category/','/api/part/category/parameters/','/api/company/part/manufacturer/','/api/company/part/','/api/attachment/']
    if metadata_enabled:paths+=['/api/stock/location/','/api/metadata/{model}/{id}/','/api/stock/']
    data={'openapi':'3.0.3','paths':{p:{'get':{}} for p in paths}}
   elif '/api/metadata/stocklocation/1/' in req.url:
    if metadata_mode=='denied':route.fulfill(status=403,headers=headers);return
    data=cabinet_response() if metadata_mode=='valid' else {'metadata':{}}
   elif '/api/part/42/' in req.url:
    if detail_fail:route.fulfill(status=403,headers=headers);return
    data={'pk':42,'name':'10k resistor','IPN':'R-01','description':'±1%','category':1}
   elif '/api/company/part/manufacturer/' in req.url and identity_fail:route.fulfill(status=403,headers=headers);return
   elif '/api/company/part/manufacturer/' in req.url:data=[{'pk':21,'part':42,'manufacturer':3,'manufacturer_detail':{'pk':3,'name':'Fixture Maker'},'MPN':'FIX-10K'}]
   elif '/api/company/part/' in req.url:data=[{'pk':22,'part':42,'supplier':9,'supplier_detail':{'pk':9,'name':'Fixture Supplier'},'SKU':'SKU-10K'}]
   elif '/api/attachment/' in req.url:data=[{'pk':31,'model_type':'part','model_id':42,'link':'https://example.test/manual','comment':'Fixture manual'}]
   elif '/api/parameter/template/' in req.url:
    if label_fail:route.fulfill(status=403,headers=headers);return
    data=[{'pk':5,'name':'Resistance','units':'Ω','model_type':'part.part','enabled':True}]
   elif '/api/parameter/' in req.url: data=[{'pk':20,'model_id':42,'model_type':'part.part','template':5,'data':'10kΩ'}]
   elif '/api/stock/location/' in req.url: data=[{'pk':1,'name':'Cabinet A','parent':None,'structural':True},{'pk':2,'name':'A-01','parent':1,'structural':False}]
   elif '/api/part/' in req.url:data=[{'pk':42,'name':'10k resistor','IPN':'R-01','description':'±1%','category':1},{'pk':43,'name':'10k unknown','IPN':'R-02','description':'Partial','category':1}]
   elif '/api/stock/' in req.url and 'location=2' in req.url:
    assert 'cascade=false' in req.url
    if stock_mode=='denied':route.fulfill(status=403,headers=headers);return
    data=[{'pk':9,'part':42,'location':2,'quantity':'100'}] if stock_mode=='positive' else []
   elif 'part=42' in req.url:
    assert 'include_variants=false' in req.url
    data=[{'pk':9,'part':42,'location':2,'quantity':'100'}]
   else:data=[]
   route.fulfill(json=data,headers=headers)
  page.route('https://inventory.example.test/**',api)
  page.goto(f'http://127.0.0.1:{server.server_port}/');page.get_by_role('button',name='设置',exact=True).click();page.evaluate("window.__studioShell=document.querySelector('[data-workspace-shell]')");page.get_by_role('button',name='配置 InvenTree').click();assert page.evaluate("window.__studioShell===document.querySelector('[data-workspace-shell]')");assert page.get_by_role('heading',name='设置',exact=True).count()==1
  page.get_by_label('服务地址').fill('https://inventory.example.test');page.get_by_label('只读 API Token').fill('synthetic-test');page.get_by_role('button',name='测试并连接').click()
  page.get_by_text('已连接 · 只读',exact=True).wait_for();assert page.get_by_role('heading',name='设置',exact=True).is_visible();assert page.locator('[data-workspace-source]').inner_text()=='当前库存：InvenTree（只读）';assert page.evaluate("window.__studioShell===document.querySelector('[data-workspace-shell]')");page.get_by_role('button',name='首页',exact=True).click();page.get_by_label('全局库存搜索').fill('10k');page.get_by_role('button',name='搜索',exact=True).click()
  page.get_by_text('找到 2 种元件').wait_for();page.get_by_text('Cabinet A / A-01',exact=True).wait_for();page.get_by_text('100 件',exact=True).wait_for();page.get_by_text('已建档，暂无库存记录').wait_for()
  assert not any('/api/schema/' in u for m,u in seen)
  page.get_by_role('button',name='查看 R-01 详情').click();dialog=page.get_by_role('dialog',name='元件详情');dialog.get_by_role('alert').wait_for();assert not any('/api/part/42/' in u for m,u in seen)
  detail_enabled=True;detail_fail=True;dialog.get_by_role('button',name='重试读取').click();dialog.get_by_role('alert').wait_for()
  detail_fail=False;dialog.get_by_role('button',name='重试读取').click();dialog.get_by_text('FIX-10K',exact=True).wait_for();dialog.get_by_text('SKU-10K',exact=True).wait_for();dialog.get_by_text('10kΩ',exact=True).wait_for();dialog.get_by_text('Resistance · Ω',exact=True).wait_for();assert dialog.get_by_role('link',name='Fixture manual · example.test').get_attribute('href')=='https://example.test/manual'
  assert dialog.evaluate('e=>e.getBoundingClientRect().right<=innerWidth+1&&e.getBoundingClientRect().left>=-1')
  dialog.get_by_role('button',name='关闭').click();assert page.get_by_role('dialog').count()==0
  label_fail=True;page.get_by_role('button',name='查看 R-01 详情').click();dialog.get_by_text('参数 5',exact=True).wait_for();dialog.get_by_text('10kΩ',exact=True).wait_for();dialog.get_by_role('button',name='关闭').click();label_fail=False
  page.get_by_text('技术参数筛选',exact=True).click();page.get_by_role('button',name='读取参数模板').click();page.get_by_label('参数模板').select_option('5');page.get_by_label('数值比较').check();page.get_by_label('参数值').fill('10000');page.get_by_role('button',name='应用参数筛选').click();page.get_by_text('找到 1 种元件').wait_for();page.get_by_role('button',name='技术参数筛选',exact=True).click();page.get_by_label('参数值').fill('100');page.get_by_role('button',name='取消',exact=True).click();page.get_by_text('找到 1 种元件').wait_for();page.get_by_text('另有 1 种参数未知，未计入严格匹配。').wait_for();assert page.get_by_text('10k unknown',exact=True).count()==0
  page.get_by_role('button',name='首页',exact=True).click();page.get_by_role('button',name='手动录入草稿').click()
  page.get_by_label('元件分类').select_option('resistor.smd');page.get_by_label('元件名称').fill('10k test resistor');page.get_by_label('阻值 · Ω').fill('10kΩ')
  page.get_by_label('已核对草稿和来源',exact=False).check();assert page.get_by_role('button',name='导出审核草稿').is_enabled()
  page.get_by_label('阻值 · Ω').fill('20kΩ');assert page.get_by_role('button',name='导出审核草稿').is_disabled()
  page.get_by_label('已核对草稿和来源',exact=False).check();page.get_by_role('button',name='手动录入草稿').click();assert not page.get_by_label('已核对草稿和来源',exact=False).is_checked()
  page.get_by_role('button',name='仓储',exact=True).click();page.get_by_text('读取柜体布局',exact=True).click();page.get_by_label('Metadata 模型标识').fill('stocklocation');page.get_by_label('柜体根库位').select_option('1');page.get_by_role('button',name='读取布局',exact=True).click();page.get_by_role('alert').wait_for()
  metadata_enabled=True;metadata_mode='denied';page.get_by_role('button',name='读取布局',exact=True).click();page.get_by_role('alert').wait_for()
  metadata_mode='empty';page.get_by_role('button',name='读取布局',exact=True).click();page.get_by_text('该库位没有已保存的柜体布局。').wait_for()
  metadata_mode='valid';page.get_by_role('button',name='读取布局',exact=True).click();matrix=page.get_by_role('region',name='仓储矩阵');matrix.wait_for();matrix.get_by_text('库存未知',exact=True).wait_for();matrix.get_by_text('未绑定',exact=True).wait_for();matrix.get_by_text('未定义',exact=True).wait_for();assert matrix.get_by_text('空闲',exact=True).count()==0
  matrix.get_by_role('button',name='A-01 库存未知').click();drawer=page.get_by_role('dialog',name='A-01');drawer.get_by_text('1 · 库位 2',exact=True).wait_for();drawer.get_by_role('button',name='关闭').click()
  page.get_by_role('button',name='读取库存记录').click();matrix.get_by_text('有正量',exact=True).wait_for();matrix.get_by_role('button',name='A-01 有正量').click();drawer.get_by_text('有正量',exact=True).wait_for();drawer.get_by_role('button',name='关闭').click()
  stock_mode='empty';page.get_by_role('button',name='读取库存记录').click();matrix.get_by_text('无正量',exact=True).wait_for();assert matrix.get_by_text('空闲',exact=True).count()==0
  stock_mode='denied';page.get_by_role('button',name='读取库存记录').click();page.get_by_text('部分库位读取失败，库存状态保持未知。').wait_for();matrix.get_by_text('库存未知',exact=True).wait_for()
  page.get_by_label('Metadata 模型标识').fill('changed');assert matrix.count()==0
  # Switch sources without leaving settings or losing the shared Gateway configuration.
  page.get_by_role('button',name='设置',exact=True).click();page.get_by_text('AI Gateway · 未配置',exact=True).click();page.get_by_label('Agent API Base URL').fill('https://gateway.example.test/v1');page.get_by_label('API Key',exact=True).fill('session-only-key');page.get_by_label('模型或 Agent ID').fill('fixture');page.get_by_role('button',name='保存配置').click()
  page.route('https://gateway.example.test/**',lambda route:gateway_route(route,response_label()))
  page.get_by_role('button',name='首页',exact=True).click();page.get_by_test_id('receipt-album').set_input_files({'name':'synthetic-label.png','mimeType':'image/png','buffer':label_png()});page.get_by_role('button',name='发送照片并获取草稿').click();page.get_by_text('包装标记数量：15 件 · 待确认',exact=True).wait_for();page.get_by_role('button',name='全部确认',exact=True).click();page.get_by_role('button',name='核对已有库存',exact=True).click();match=page.get_by_role('region',name='库存匹配结果');match.get_by_role('heading',name='已找到相同身份').wait_for();match.get_by_text('10k resistor',exact=True).wait_for();assert match.get_by_role('button',name='使用该元件入库').count()==0
  page.get_by_label('SKU',exact=True).fill('OTHER-SKU');assert match.count()==0;page.get_by_role('button',name='全部确认',exact=True).click();page.get_by_role('button',name='核对已有库存',exact=True).click();match.get_by_role('heading',name='发现可能匹配的元件').wait_for()
  page.get_by_label('MPN',exact=True).fill('OTHER-MPN');identity_fail=True;page.get_by_role('button',name='全部确认',exact=True).click();page.get_by_role('button',name='核对已有库存',exact=True).click();page.get_by_text('库存身份查询失败或接口不完整，不能判定为新元件。请重试。',exact=True).wait_for();assert match.count()==0;identity_fail=False;page.get_by_role('button',name='核对已有库存',exact=True).click();match.get_by_role('heading',name='未找到关联身份 · 建议新建').wait_for();match.get_by_text('当前库存只读，不能创建元件或写入库存。',exact=True).wait_for();assert match.get_by_role('button',name='新建元件并入库').count()==0
  page.get_by_role('button',name='设置',exact=True).click();page.get_by_role('button',name='使用演示库存',exact=True).click();assert page.evaluate("window.__studioShell===document.querySelector('[data-workspace-shell]')");assert page.locator('[data-workspace-source]').inner_text()=='当前库存：演示库存';assert page.get_by_role('heading',name='设置',exact=True).is_visible();page.get_by_text('AI Gateway · 已配置 · 未验证',exact=True).click();assert page.get_by_label('模型或 Agent ID').input_value()=='fixture';assert page.get_by_label('API Key',exact=True).input_value()=='session-only-key';page.get_by_role('button',name='取消',exact=True).click();assert page.evaluate("!Object.values(localStorage).some(v=>v.includes('session-only-key'))")
  assert all(m in ('GET','OPTIONS') for m,u in seen);assert page.evaluate("!Object.values(localStorage).some(v=>v.includes('synthetic-test'))");assert not errors,errors
  batch=b.new_page(viewport={'width':390,'height':844});batch.on('pageerror',lambda e:errors.append(str(e)));exercise_live_enrichment(batch,f'http://127.0.0.1:{server.server_port}/');assert not errors,errors
  native=b.new_page(viewport={'width':390,'height':844});native.on('pageerror',lambda e:errors.append(str(e)));exercise_native_browser(native,f'http://127.0.0.1:{server.server_port}/');assert not errors,errors;b.close()
finally:server.shutdown()
print('PASS: explicit read-only connection, global result distribution, zero stock distinction, no credential persistence (mocked network).')
