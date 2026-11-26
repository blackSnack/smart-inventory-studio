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
  b=p.chromium.launch();context=b.new_context(viewport={'width':390,'height':844});page=context.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  page.goto(f'http://127.0.0.1:{server.server_port}/');page.get_by_role('heading',name='我的工作室').wait_for()
  page.get_by_role('textbox',name='全局搜索').fill('10k');page.get_by_role('button',name='搜索',exact=True).click();page.get_by_text('全仓库 · 2 种元件').wait_for()
  page.get_by_role('button',name='仓储',exact=True).click();page.get_by_role('button',name='A-01 有库存').click();page.get_by_role('dialog').get_by_text('RES-001',exact=False).wait_for();page.get_by_role('button',name='关闭').click()
  page.get_by_role('button',name='首页',exact=True).click();page.get_by_role('button',name='手动录入').click();page.get_by_label('选择已确认相同元件').select_option('RES-001');page.get_by_label('A-01 数量').fill('40');page.get_by_label('A-04 数量').fill('60');page.get_by_label('已确认实际容量及元件身份').check();page.get_by_role('button',name='确认模拟入库').click();page.get_by_text('600',exact=True).wait_for()
  page.evaluate('navigator.serviceWorker.ready');page.wait_for_function('!!navigator.serviceWorker.controller');context.set_offline(True);page.reload();page.get_by_role('heading',name='我的工作室').wait_for();assert not errors,errors
  b.close()
finally: server.shutdown()
print('PASS: React navigation, search, matrix, split receipt, service worker offline shell (synthetic data).')
