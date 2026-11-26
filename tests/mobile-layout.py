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
  b=p.chromium.launch()
  for width in (320,375,390,430,768,1280):
   context=b.new_context(viewport={'width':width,'height':844},is_mobile=width<768,has_touch=width<768,device_scale_factor=1)
   page=context.new_page();page.goto(f'http://127.0.0.1:{server.server_port}/');page.get_by_role('heading',name='Studio Workspace').wait_for()
   def fit():
    assert page.evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth+1'), f'horizontal page overflow {width}'
    for el in page.locator('input:not([type=checkbox]):not([type=radio]),select,textarea').all():
     if el.is_visible():assert float(el.evaluate('e=>parseFloat(getComputedStyle(e).fontSize)'))>=16, f'focus font size {width}'
   fit()
   assert page.get_by_test_id('current-version').bounding_box()['x']>width/2
   assert not page.get_by_text('我的工作室',exact=True).count()
   assert not page.get_by_text('元件种类',exact=True).count()
   search=page.get_by_role('textbox',name='全局搜索');search.fill('10k');fit();search.blur()
   for label in ('拍照录入','手动录入'):
    action=page.get_by_role('button',name=label,exact=True);assert action.bounding_box()['height']>=108
   page.get_by_role('button',name='手动录入').click();page.get_by_role('heading',name='查找已有元件').wait_for();fit()
   assert page.get_by_role('dialog').count()==0
   page.get_by_label('搜索已有元件').fill('RES-001');page.get_by_role('button',name='选择 RES-001').click()
   page.get_by_label('本次入库数量').focus();fit()
   page.set_viewport_size({'width':width,'height':480});page.wait_for_function("document.documentElement.style.getPropertyValue('--studio-vv-height')==='480px'");fit()
   page.get_by_role('button',name='取消录入').click();page.set_viewport_size({'width':width,'height':844})
   page.get_by_role('button',name='仓储',exact=True).click();fit()
   page.get_by_role('button',name='编辑布局').click();dialog=page.get_by_role('dialog');dialog.wait_for();fit()
   title=dialog.get_by_role('heading');close=dialog.get_by_role('button',name='关闭');t=title.bounding_box();c=close.bounding_box()
   assert t['x']+t['width']<=c['x']+1 and c['width']>=43.9 and c['height']>=43.9
   assert dialog.evaluate('e=>e.getBoundingClientRect().right<=innerWidth+1 && e.getBoundingClientRect().left>=-1')
   page.set_viewport_size({'width':width,'height':480});page.wait_for_function("document.documentElement.style.getPropertyValue('--studio-vv-height')==='480px'");fit()
   assert dialog.evaluate('e=>e.getBoundingClientRect().bottom<=window.visualViewport.height+1')
   page.set_viewport_size({'width':width,'height':844})
   dialog.get_by_label('行数').fill('10');dialog.get_by_label('列数').fill('10');dialog.get_by_role('button',name='扩库 / 补齐').click();dialog.get_by_text('100',exact=True).wait_for();fit()
   assert dialog.evaluate('e=>e.getBoundingClientRect().right<=innerWidth+1')
   dialog.get_by_role('button',name='关闭').click()
   page.get_by_role('button',name='设置',exact=True).click();fit()
   context.close()
  b.close()
finally:server.shutdown()
print('PASS: responsive 320/375/390/430/768/1280 widths, 16px form text, version placement, modal title/close geometry, reduced viewport and contained matrix. Chromium only; physical iOS pending.')
