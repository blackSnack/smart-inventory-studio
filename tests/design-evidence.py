"""Capture the real built React application; no external services or real stock."""
from pathlib import Path
from http.server import ThreadingHTTPServer,SimpleHTTPRequestHandler
from functools import partial
from threading import Thread
from base64 import b64encode
from playwright.sync_api import sync_playwright
from live_metadata_fixture import cabinet_response
from live_enrichment_fixture import exercise_live_enrichment
root=Path(__file__).resolve().parents[1]
out=root/'design-evidence';out.mkdir(exist_ok=True)
server=ThreadingHTTPServer(('127.0.0.1',0),partial(SimpleHTTPRequestHandler,directory=str(root/'web'/'dist')))
Thread(target=server.serve_forever,daemon=True).start()
def capture(page,name,anchor=None):
 page.evaluate('document.fonts.ready')
 if anchor is None:page.evaluate('window.scrollTo(0,0)')
 else:anchor.evaluate("e=>e.scrollIntoView({block:'start'})")
 page.wait_for_timeout(120)
 assert page.evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth+1'),name
 for group in page.locator('.studio-search-group').all():
  if group.is_visible():
   assert group.evaluate("e=>{const i=e.querySelector('input').getBoundingClientRect(),s=e.querySelector('.studio-icon').getBoundingClientRect(),b=e.querySelector('button')?.getBoundingClientRect();return i.left>=s.right+4&&(!b||i.right<=b.left+1)}"), 'search icon overlaps text'
 for row in page.locator('.studio-allocation-row').all():
  assert row.evaluate("e=>{const a=e.querySelector('[data-testid=allocation-label]').getBoundingClientRect(),i=e.querySelector('input').getBoundingClientRect(),b=e.querySelector('button').getBoundingClientRect();return a.width>=80&&i.width>=70&&i.width<=96&&a.right<=i.left&&i.right<=b.left}"), 'allocation row squeezed'
 data=page.screenshot(type='jpeg',quality=52,animations='disabled')
 (out/(name+'.jpg')).write_bytes(data)
 print('DESIGN_IMAGE:'+name+':'+b64encode(data).decode('ascii'),flush=True)
try:
 with sync_playwright() as p:
  b=p.chromium.launch()
  context=b.new_context(viewport={'width':390,'height':844},is_mobile=True,has_touch=True,device_scale_factor=1)
  page=context.new_page()
  page.goto(f'http://127.0.0.1:{server.server_port}/')
  page.get_by_role('heading',name='Studio Workspace').wait_for()
  page.evaluate('document.fonts.ready')
  assert page.evaluate("document.fonts.check('16px Geist Variable') && getComputedStyle(document.body).fontFamily.includes('Geist Variable')")
  assert page.locator('.studio-icon svg').count()>0
  assert page.locator('.studio-icon svg').first.evaluate('e=>e.getBoundingClientRect().width===18 && e.parentElement.getBoundingClientRect().width===24')
  capture(page,'01-mobile-home')
  page.get_by_role('button',name='元件',exact=True).click();capture(page,'31-mobile-parts')
  page.get_by_text('技术参数筛选',exact=True).click();capture(page,'32-mobile-filter');page.get_by_label('筛选分类').select_option('resistor.smd');page.get_by_label('技术参数',exact=True).select_option('tolerance');page.get_by_label('参数值').fill('1%');page.get_by_role('button',name='添加筛选条件').click();capture(page,'41-mobile-filter-conditions');page.get_by_role('button',name='取消',exact=True).click();page.get_by_role('button',name='首页',exact=True).click()
  page.get_by_role('button',name='拍照录入').click();page.get_by_role('heading',name='采集元件照片').wait_for();capture(page,'02-mobile-photo')
  page.get_by_role('button',name='取消录入').click()
  page.get_by_role('button',name='手动录入').click();page.get_by_label('搜索已有元件').fill('10k');page.get_by_role('button',name='选择 RES-001').wait_for();capture(page,'03-mobile-candidates')
  page.get_by_role('button',name='选择 RES-001').click();page.get_by_label('本次入库数量').fill('100');page.get_by_role('button',name='添加存放位置').click();page.get_by_role('button',name='选择库位 A-01').click();page.get_by_label('A-01 数量').fill('40');capture(page,'04-mobile-putaway')
  page.get_by_role('button',name='取消录入').click();page.get_by_role('dialog').get_by_role('button',name='放弃录入',exact=True).click()
  page.get_by_role('button',name='仓储',exact=True).click();capture(page,'05-mobile-storage')
  page.get_by_role('button',name='编辑布局').click();page.get_by_role('dialog').wait_for();capture(page,'06-mobile-dialog')
  page.get_by_role('dialog').get_by_role('button',name='关闭').click()
  page.get_by_role('button',name='设置',exact=True).click();capture(page,'07-mobile-settings');page.get_by_text('AI Gateway · 未配置',exact=True).click();capture(page,'40-mobile-gateway');page.get_by_role('button',name='取消',exact=True).click();page.get_by_role('button',name='软件更新',exact=True).click();capture(page,'42-mobile-update');page.get_by_role('dialog').get_by_role('button',name='关闭').click()
  page.get_by_role('button',name='元件',exact=True).click();page.get_by_role('textbox',name='全局搜索').fill('RES-001');page.get_by_role('button',name='查看 RES-001').click();page.get_by_role('dialog').wait_for();capture(page,'09-mobile-part-detail');page.get_by_role('dialog').get_by_role('button',name='补全资料',exact=True).click();page.get_by_role('heading',name='资料补全').wait_for();capture(page,'16-mobile-enrichment');page.get_by_role('button',name='返回元件').click()
  page.get_by_role('button',name='仓储',exact=True).click();page.get_by_role('button',name='批量建库').click();assert page.get_by_label('CSV 内容').evaluate('e=>e.getBoundingClientRect().height>=160');capture(page,'20-mobile-batch-input');page.get_by_role('dialog').get_by_role('button',name='生成批量预览').click();page.get_by_text('1 条草稿',exact=False).wait_for();capture(page,'10-mobile-batch-preview');page.get_by_role('dialog').get_by_role('button',name='关闭').click()
  page.get_by_role('button',name='首页',exact=True).click();page.get_by_role('button',name='手动录入').click();page.get_by_role('button',name='新建元件',exact=True).click();page.get_by_label('元件分类').select_option('resistor.smd');page.get_by_label('元件名称').fill('fixture');page.get_by_label('阻值 · Ω').fill('10kΩ');capture(page,'11-mobile-draft-review');page.get_by_label('已核对草稿和来源',exact=False).check();page.get_by_role('button',name='核对已有库存').click();capture(page,'43-mobile-identity-review')
  page.get_by_role('button',name='取消录入').click();page.get_by_role('dialog').get_by_role('button',name='放弃录入',exact=True).click()
  page.get_by_role('button',name='仓储',exact=True).click();page.get_by_role('button',name='编辑布局').click();dialog=page.get_by_role('dialog');dialog.get_by_label('行数').fill('10');dialog.get_by_label('列数').fill('10');dialog.get_by_role('button',name='扩库 / 补齐').click();dialog.get_by_label('已确认实际柜体',exact=False).check();dialog.get_by_role('button',name='保存布局',exact=True).click();dialog.wait_for(state='hidden');page.get_by_role('button',name='A-L1-R10-C10 空闲',exact=True).wait_for();capture(page,'12-expanded-warehouse')
  page.get_by_role('button',name='编辑布局').click();dialog=page.get_by_role('dialog');dialog.get_by_role('button',name='A-L1-R1-C1 有库存',exact=True).click();dialog.get_by_role('button',name='子格 1').click();dialog.get_by_role('button',name='拆分所选格').click();dialog.get_by_role('button',name='添加迁移目标',exact=True).click();dialog.get_by_role('button',name='迁移 A-01 至 A-L1-R1-C1-S1',exact=True).click();dialog.get_by_label('A-01 → A-L1-R1-C1-S1 数量').fill('80');dialog.get_by_role('button',name='添加迁移目标',exact=True).click();dialog.get_by_role('button',name='迁移 A-01 至 A-L1-R1-C1-S2',exact=True).click();dialog.get_by_role('heading',name='库存迁移').evaluate("e=>e.scrollIntoView({block:'start'})");capture(page,'13-mobile-relocation')
  dialog.get_by_role('button',name='关闭').click();page.get_by_role('button',name='编辑布局').click();dialog=page.get_by_role('dialog');dialog.get_by_label('编号前缀').fill('NEW');dialog.get_by_role('button',name='命名迁移预览',exact=True).click();dialog.get_by_role('heading',name='命名迁移预览').evaluate("e=>e.scrollIntoView({block:'start'})");capture(page,'14-mobile-rename')
  dialog.get_by_role('button',name='关闭').click();page.get_by_role('button',name='首页',exact=True).click();page.get_by_role('button',name='手动录入').click();page.get_by_label('搜索已有元件').fill('RES-001');page.get_by_role('button',name='选择 RES-001').click();page.get_by_label('本次入库数量').fill('10');page.get_by_role('button',name='添加存放位置').click();page.get_by_role('button',name='按矩阵选择',exact=True).click();page.get_by_role('region',name='仓储矩阵').evaluate("e=>e.scrollIntoView({block:'start'})");page.evaluate('document.fonts.ready');page.wait_for_timeout(120);data=page.screenshot(type='jpeg',quality=52,animations='disabled');(out/'15-mobile-matrix-putaway.jpg').write_bytes(data);print('DESIGN_IMAGE:15-mobile-matrix-putaway:'+b64encode(data).decode('ascii'),flush=True)
  context.close()
  recovery=b.new_context(viewport={'width':390,'height':844},is_mobile=True,has_touch=True,device_scale_factor=1)
  page=recovery.new_page();page.goto(f'http://127.0.0.1:{server.server_port}/');page.get_by_role('heading',name='Studio Workspace').wait_for()
  page.get_by_role('button',name='设置',exact=True).click();page.get_by_text('无未完成操作',exact=True).wait_for()
  # Isolated fixture: the pending plan is created only in this test context.
  page.evaluate("""async()=>{const db=await new Promise((ok,fail)=>{const r=indexedDB.open('smart-inventory-journal-v1',1);r.onsuccess=()=>ok(r.result);r.onerror=()=>fail(r.error)});const plan={id:'ui-stop-fixture',instanceId:'studio-synthetic-v1',catalogHash:'test',snapshotHash:'test',approvalId:'test',operations:[{id:'ui-stop:0',kind:'receive-existing-part',payload:{}},{id:'ui-stop:1',kind:'receive-existing-part',payload:{}}]};await new Promise((ok,fail)=>{const tx=db.transaction('operations','readwrite');tx.oncomplete=ok;tx.onabort=()=>fail(tx.error);tx.objectStore('operations').add({instanceId:plan.instanceId,planId:plan.id,journal:{plan,revision:0,steps:plan.operations.map(operation=>({operation,state:'planned'}))}})});db.close()}""")
  page.reload();page.get_by_role('button',name='设置',exact=True).click();page.get_by_role('button',name='停止剩余操作',exact=True).wait_for()
  assert page.get_by_role('button',name='继续操作',exact=True).is_disabled()
  capture(page,'17-recovery-pending')
  page.get_by_role('button',name='停止剩余操作',exact=True).click();page.get_by_role('dialog',name='停止剩余操作？').wait_for();capture(page,'18-recovery-stop')
  page.get_by_role('button',name='确认停止',exact=True).click();page.get_by_text('无未完成操作',exact=True).wait_for();page.get_by_text('已停止操作（1）',exact=True).click();page.get_by_text('已执行并核对 0 项 · 未发送 2 项',exact=True).wait_for();capture(page,'19-recovery-history')
  page.reload();page.get_by_role('button',name='设置',exact=True).click();page.get_by_text('已停止操作（1）',exact=True).wait_for();assert page.get_by_role('button',name='继续操作',exact=True).count()==0
  recovery.close()
  desktop=b.new_context(viewport={'width':1100,'height':760},device_scale_factor=1)
  page=desktop.new_page();page.goto(f'http://127.0.0.1:{server.server_port}/');page.get_by_role('heading',name='Studio Workspace').wait_for();capture(page,'08-desktop-home')
  page.get_by_role('button',name='手动录入').click();page.get_by_label('搜索已有元件').fill('RES-001');page.get_by_role('button',name='选择 RES-001').click()
  page.get_by_label('本次入库数量').fill('10');page.get_by_role('button',name='添加存放位置').click();page.get_by_role('button',name='选择库位 A-01').click()
  action=page.get_by_role('button',name='移除 A-01')
  page.mouse.move(0,0);page.get_by_label('本次入库数量').focus()
  page.wait_for_timeout(160)
  assert float(action.evaluate('e=>getComputedStyle(e).opacity'))==0
  action.focus();page.wait_for_timeout(160)
  assert float(action.evaluate('e=>getComputedStyle(e).opacity'))==1
  page.get_by_role('button',name='取消录入').click();page.get_by_role('dialog').get_by_role('button',name='放弃录入',exact=True).click()
  page.get_by_role('button',name='元件',exact=True).click();capture(page,'33-desktop-parts');page.get_by_role('button',name='查看 RES-001').click();capture(page,'34-desktop-detail');page.get_by_role('button',name='查看 RES-002').click();page.get_by_role('dialog').get_by_text('RES-002',exact=False).first.wait_for();page.get_by_role('dialog').get_by_role('button',name='关闭').click()
  page.get_by_role('button',name='仓储',exact=True).click();page.get_by_role('button',name='编辑布局').click();capture(page,'35-desktop-workbench');page.get_by_role('dialog').get_by_role('button',name='关闭').click()
  page.get_by_role('button',name='批量建库').click();page.get_by_role('button',name='生成批量预览').click();capture(page,'44-desktop-batch-review');page.get_by_role('dialog').get_by_role('button',name='关闭').click()
  desktop.close()
  tablet=b.new_context(viewport={'width':820,'height':1180},is_mobile=True,has_touch=True,device_scale_factor=1)
  page=tablet.new_page();page.goto(f'http://127.0.0.1:{server.server_port}/');page.get_by_role('heading',name='Studio Workspace').wait_for();capture(page,'36-tablet-home')
  page.get_by_role('button',name='元件',exact=True).click();capture(page,'37-tablet-parts');page.get_by_role('button',name='仓储',exact=True).click();capture(page,'38-tablet-storage');page.get_by_role('button',name='编辑布局').click();capture(page,'39-tablet-workbench');tablet.close()
  # Read-only detail capture uses a separate synthetic network fixture, no real inventory.
  def live_detail_api(route):
   req=route.request;headers={'access-control-allow-origin':'*','access-control-allow-headers':'authorization,content-type','access-control-allow-methods':'GET, OPTIONS'}
   if req.method=='OPTIONS':route.fulfill(status=204,headers=headers);return
   assert req.method=='GET'
   from urllib.parse import urlparse
   path=urlparse(req.url).path
   data={
    '/api/schema/':{'openapi':'3.0.3','paths':{k:{'get':{}} for k in ['/api/part/{id}/','/api/part/category/','/api/part/category/parameters/','/api/parameter/','/api/parameter/template/','/api/company/part/manufacturer/','/api/company/part/','/api/attachment/','/api/stock/location/','/api/metadata/{model}/{id}/','/api/stock/']}},
    '/api/stock/location/':[{'pk':1,'name':'Cabinet A','parent':None,'structural':True},{'pk':2,'name':'A-01','parent':1,'structural':False}],
    '/api/metadata/stocklocation/1/':cabinet_response(),
    '/api/part/':[{'pk':42,'name':'10k resistor','IPN':'R-01','description':'±1%','category':1}],
    '/api/part/42/':{'pk':42,'name':'10k resistor','IPN':'R-01','description':'±1%','category':1},
    '/api/stock/':[{'pk':9,'part':42,'location':2,'quantity':'100'}],
    '/api/parameter/template/':[{'pk':5,'name':'Resistance','units':'Ω','model_type':'part.part','enabled':True}],
    '/api/parameter/':[{'pk':20,'model_id':42,'model_type':'part.part','template':5,'data':'10kΩ'}],
    '/api/company/part/manufacturer/':[{'pk':21,'part':42,'manufacturer':3,'manufacturer_detail':{'pk':3,'name':'Fixture Maker'},'MPN':'FIX-10K'}],
    '/api/company/part/':[{'pk':22,'part':42,'supplier':9,'supplier_detail':{'pk':9,'name':'Fixture Supplier'},'SKU':'SKU-10K'}],
    '/api/attachment/':[{'pk':31,'model_type':'part','model_id':42,'link':'https://example.test/manual','comment':'Fixture manual'}]
   }
   assert path in data,path
   route.fulfill(json=data[path],headers=headers)
  for width,height,label in [(390,844,'21-mobile-live-detail'),(1100,760,'22-desktop-live-detail')]:
   live=b.new_context(viewport={'width':width,'height':height},is_mobile=width<768,has_touch=width<768,device_scale_factor=1)
   page=live.new_page();page.route('https://inventory.example.test/**',live_detail_api);page.goto(f'http://127.0.0.1:{server.server_port}/')
   page.get_by_role('button',name='设置',exact=True).click();page.get_by_role('button',name='真实库存只读验证').click()
   page.get_by_label('服务地址').fill('https://inventory.example.test');page.get_by_label('只读 API Token').fill('synthetic-test');page.get_by_role('button',name='测试并连接').click()
   page.get_by_text('已连接 · 只读',exact=True).wait_for();page.get_by_label('全局库存搜索').fill('10k');page.get_by_role('button',name='搜索',exact=True).click()
   page.get_by_role('button',name='查看 R-01 详情').click();dialog=page.get_by_role('dialog',name='元件详情');dialog.get_by_text('FIX-10K',exact=True).wait_for();dialog.get_by_text('Resistance · Ω',exact=True).wait_for();capture(page,label)
   dialog.get_by_role('button',name='关闭').click();page.get_by_role('button',name='仓储',exact=True).click();page.get_by_text('读取柜体布局',exact=True).click();page.get_by_label('Metadata 模型标识').fill('stocklocation');page.get_by_label('柜体根库位').select_option('1');page.get_by_role('button',name='读取布局',exact=True).click()
   matrix=page.get_by_role('region',name='仓储矩阵');matrix.get_by_text('库存未知',exact=True).wait_for();matrix.get_by_text('未绑定',exact=True).wait_for();matrix.get_by_text('未定义',exact=True).wait_for();capture(page,'23-mobile-live-layout' if width<768 else '24-desktop-live-layout')
   page.get_by_role('button',name='读取库存记录').click();matrix.get_by_text('有正量',exact=True).wait_for();capture(page,'25-mobile-live-stock' if width<768 else '26-desktop-live-stock')
   live.close()
  for width,height in [(390,844),(1100,760)]:
   ctx=b.new_context(viewport={'width':width,'height':height},is_mobile=width<768,has_touch=width<768,device_scale_factor=1)
   exercise_live_enrichment(ctx.new_page(),f'http://127.0.0.1:{server.server_port}/',capture)
   ctx.close()
  b.close()
finally:server.shutdown()
print('PASS: actual browser captures, local font load, icon dimensions and desktop focus visibility. Visual inspection is separate.')
