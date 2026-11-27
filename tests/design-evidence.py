"""Capture the real built React application; no external services or real stock."""
from pathlib import Path
from http.server import ThreadingHTTPServer,SimpleHTTPRequestHandler
from functools import partial
from threading import Thread
from base64 import b64encode
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parents[1]
out=root/'design-evidence';out.mkdir(exist_ok=True)
server=ThreadingHTTPServer(('127.0.0.1',0),partial(SimpleHTTPRequestHandler,directory=str(root/'web'/'dist')))
Thread(target=server.serve_forever,daemon=True).start()
def capture(page,name):
 page.evaluate('document.fonts.ready')
 page.evaluate('window.scrollTo(0,0)')
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
  page.get_by_role('button',name='拍照录入').click();page.get_by_role('heading',name='采集元件照片').wait_for();capture(page,'02-mobile-photo')
  page.get_by_role('button',name='取消录入').click()
  page.get_by_role('button',name='手动录入').click();page.get_by_label('搜索已有元件').fill('10k');page.get_by_role('button',name='选择 RES-001').wait_for();capture(page,'03-mobile-candidates')
  page.get_by_role('button',name='选择 RES-001').click();page.get_by_label('本次入库数量').fill('100');page.get_by_role('button',name='添加存放位置').click();page.get_by_role('button',name='选择库位 A-01').click();page.get_by_label('A-01 数量').fill('40');capture(page,'04-mobile-putaway')
  page.get_by_role('button',name='取消录入').click();page.get_by_role('dialog').get_by_role('button',name='放弃录入',exact=True).click()
  page.get_by_role('button',name='仓储',exact=True).click();capture(page,'05-mobile-storage')
  page.get_by_role('button',name='编辑布局').click();page.get_by_role('dialog').wait_for();capture(page,'06-mobile-dialog')
  page.get_by_role('dialog').get_by_role('button',name='关闭').click()
  page.get_by_role('button',name='设置',exact=True).click();capture(page,'07-mobile-settings')
  page.get_by_role('button',name='元件',exact=True).click();page.get_by_role('textbox',name='全局搜索').fill('RES-001');page.get_by_role('button',name='查看 RES-001').click();page.get_by_role('dialog').wait_for();capture(page,'09-mobile-part-detail');page.get_by_role('dialog').get_by_role('button',name='关闭').click()
  page.get_by_role('button',name='仓储',exact=True).click();page.get_by_role('button',name='批量建库').click();page.get_by_role('dialog').get_by_role('button',name='生成批量预览').click();page.get_by_text('1 条草稿',exact=False).wait_for();capture(page,'10-mobile-batch-preview');page.get_by_role('dialog').get_by_role('button',name='关闭').click()
  page.get_by_role('button',name='首页',exact=True).click();page.get_by_role('button',name='手动录入').click();page.get_by_role('button',name='新建元件',exact=True).click();page.get_by_label('元件分类').select_option('resistor.smd');page.get_by_label('元件名称').fill('fixture');page.get_by_label('阻值 · Ω').fill('10kΩ');capture(page,'11-mobile-draft-review')
  page.get_by_role('button',name='取消录入').click();page.get_by_role('dialog').get_by_role('button',name='放弃录入',exact=True).click()
  page.get_by_role('button',name='仓储',exact=True).click();page.get_by_role('button',name='编辑布局').click();dialog=page.get_by_role('dialog');dialog.get_by_label('行数').fill('10');dialog.get_by_label('列数').fill('10');dialog.get_by_role('button',name='扩库 / 补齐').click();dialog.get_by_label('已确认实际柜体',exact=False).check();dialog.get_by_role('button',name='保存布局',exact=True).click();dialog.wait_for(state='hidden');page.get_by_role('button',name='A-L1-R10-C10 空闲',exact=True).wait_for();capture(page,'12-expanded-warehouse')
  page.get_by_role('button',name='编辑布局').click();dialog=page.get_by_role('dialog');dialog.get_by_role('button',name='A-L1-R1-C1 有库存',exact=True).click();dialog.get_by_role('button',name='子格 1').click();dialog.get_by_role('button',name='拆分所选格').click();dialog.get_by_role('button',name='添加迁移目标',exact=True).click();dialog.get_by_role('button',name='迁移 A-01 至 A-L1-R1-C1-S1',exact=True).click();dialog.get_by_label('A-01 → A-L1-R1-C1-S1 数量').fill('80');dialog.get_by_role('button',name='添加迁移目标',exact=True).click();dialog.get_by_role('button',name='迁移 A-01 至 A-L1-R1-C1-S2',exact=True).click();dialog.get_by_role('heading',name='库存迁移').evaluate("e=>e.scrollIntoView({block:'start'})");capture(page,'13-mobile-relocation')
  context.close()
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
  desktop.close();b.close()
finally:server.shutdown()
print('PASS: actual browser captures, local font load, icon dimensions and desktop focus visibility. Visual inspection is separate.')
