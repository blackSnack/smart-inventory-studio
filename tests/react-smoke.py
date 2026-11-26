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
  page.get_by_text('技术参数筛选',exact=True).click();page.get_by_label('筛选分类').select_option('resistor.smd');page.get_by_label('技术参数',exact=True).select_option('tolerance');page.get_by_label('参数值').fill('1%');page.get_by_role('button',name='添加筛选条件').click();page.get_by_text('全仓库 · 1 种严格匹配元件').wait_for();assert page.get_by_text('RES-002',exact=False).count()==0
  page.get_by_role('button',name='清除参数筛选').click();page.get_by_role('textbox',name='全局搜索').fill('10µF');page.get_by_role('button',name='搜索',exact=True).click()
  if not page.get_by_label('筛选分类').is_visible():page.get_by_text('技术参数筛选',exact=True).click()
  page.get_by_label('筛选分类').select_option('capacitor.ceramic');page.get_by_label('技术参数',exact=True).select_option('tolerance');page.get_by_label('参数值').fill('10%');page.get_by_role('button',name='添加筛选条件').click();page.get_by_text('待确认候选 · 1 种',exact=False).wait_for();page.get_by_text('CAP-002',exact=False).wait_for();page.get_by_label('显示参数未知的待确认候选').uncheck();assert page.get_by_text('CAP-002',exact=False).count()==0
  page.get_by_role('button',name='清除参数筛选').click()
  page.get_by_role('button',name='仓储',exact=True).click();page.get_by_role('button',name='A-01 有库存').click();page.get_by_role('dialog').get_by_text('RES-001',exact=False).wait_for();page.get_by_role('button',name='关闭').click()
  page.get_by_role('button',name='批量建库').click();batch=page.get_by_role('dialog');batch.get_by_role('button',name='生成批量预览').click();batch.get_by_text('1 条草稿',exact=False).wait_for();batch.get_by_label('已核对草稿资料',exact=False).check();assert batch.get_by_role('button',name='导出已核对草稿（1）').is_enabled();batch.get_by_role('button',name='关闭').click()
  page.get_by_role('button',name='编辑布局').click();dialog=page.get_by_role('dialog');dialog.get_by_label('行数').fill('10');dialog.get_by_label('列数').fill('10');dialog.get_by_role('button',name='扩库 / 补齐').click();dialog.get_by_text('100',exact=True).wait_for();dialog.get_by_text('80',exact=True).wait_for()
  dialog.get_by_role('button',name='A-L1-R1-C1 有库存',exact=True).click();dialog.get_by_role('button',name='子格 1').click();dialog.get_by_role('button',name='拆分所选格').click();dialog.get_by_role('alert').get_by_text('该抽屉有库存',exact=False).wait_for()
  dialog.get_by_role('button',name='A-L1-R1-C4 已绑定空闲',exact=True).click();dialog.get_by_role('button',name='子格 1').click();dialog.get_by_role('button',name='拆分所选格').click();dialog.get_by_role('button',name='子格 2').wait_for();dialog.get_by_role('button',name='子格 1').click();dialog.get_by_role('button',name='子格 2').click();dialog.get_by_role('button',name='合并相邻格').click();assert dialog.get_by_role('button',name='子格 3').count()==0
  dialog.get_by_role('button',name='预览命名迁移').click();dialog.get_by_text('20 项重命名',exact=False).wait_for();dialog.get_by_role('button',name='关闭').click()
  page.get_by_role('button',name='首页',exact=True).click();page.get_by_role('button',name='手动录入').click();page.get_by_label('选择已确认相同元件').select_option('RES-001');page.get_by_label('A-01 数量').fill('40');page.get_by_label('A-04 数量').fill('60');page.get_by_label('已确认实际容量及元件身份').check();page.get_by_role('button',name='确认模拟入库').click();page.get_by_text('600',exact=True).wait_for()
  page.get_by_role('button',name='手动录入').click();page.get_by_role('button',name='新建元件入库').click()
  page.get_by_label('元件分类').select_option('resistor.smd');page.get_by_label('元件名称').fill('Historical 22k resistor');page.get_by_label('阻值 · Ω').fill('22kΩ')
  page.get_by_label('已核对草稿和来源',exact=False).check();page.get_by_role('button',name='审核并检索已有库存').click()
  page.get_by_label('新元件数量',exact=True).fill('20');page.get_by_label('A-05 新元件数量').fill('20');page.get_by_label('已确认独立身份、候选差异及实际存放空间').check();page.get_by_role('button',name='确认新建并入库').click();page.get_by_text('620',exact=True).wait_for()
  page.evaluate('navigator.serviceWorker.ready');page.wait_for_function('!!navigator.serviceWorker.controller');context.set_offline(True);page.reload();page.get_by_role('heading',name='我的工作室').wait_for();page.get_by_text('620',exact=True).wait_for();assert not errors,errors
  b.close()
finally: server.shutdown()
print('PASS: React navigation, search, strict specification filters, unknown candidates, matrix, split receipt, persistent synthetic receipt and offline shell (synthetic data).')
