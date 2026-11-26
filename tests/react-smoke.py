from pathlib import Path
from http.server import ThreadingHTTPServer,SimpleHTTPRequestHandler,BaseHTTPRequestHandler
import json
from functools import partial
from threading import Thread
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parents[1]/'web'/'dist'
server=ThreadingHTTPServer(('127.0.0.1',0),partial(SimpleHTTPRequestHandler,directory=str(root)))
Thread(target=server.serve_forever,daemon=True).start()
requests=[]
class Gateway(BaseHTTPRequestHandler):
 def cors(self):
  self.send_header('Access-Control-Allow-Origin','*');self.send_header('Access-Control-Allow-Methods','POST, OPTIONS');self.send_header('Access-Control-Allow-Headers','authorization,content-type')
 def do_OPTIONS(self):
  self.send_response(204);self.cors();self.end_headers()
 def do_POST(self):
  try:
   body=json.loads(self.rfile.read(int(self.headers['Content-Length'])))
   assert self.path=='/v1/chat/completions' and self.headers.get('Authorization')=='Bearer fixture-key'
   assert body['model']=='fixture-model' and body['messages'][1]['content'][1]['image_url']['url'].startswith('data:image/jpeg;base64,')
   requests.append('valid-photo-post')
   if len(requests)==1:
    self.send_response(503);self.cors();self.end_headers();return
   draft={'name':'AI 33k resistor','manufacturer':None,'mpn':None,'supplier':None,'sku':None,'category':'resistor.smd','parameters':{'resistance':'33kΩ','tolerance':'±1%','package':'0603'},'sourceUrls':[],'datasheetUrl':None,'imageUrl':None}
   response=json.dumps({'choices':[{'message':{'content':json.dumps(draft)}}]}).encode()
   self.send_response(200);self.cors();self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(response)));self.end_headers();self.wfile.write(response)
  except Exception:
   requests.append('invalid-request');self.send_response(400);self.cors();self.end_headers()
gateway_server=ThreadingHTTPServer(('127.0.0.1',0),Gateway)
Thread(target=gateway_server.serve_forever,daemon=True).start()
try:
 with sync_playwright() as p:
  b=p.chromium.launch();context=b.new_context(viewport={'width':390,'height':844});page=context.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  page.goto(f'http://127.0.0.1:{server.server_port}/');page.get_by_role('heading',name='Studio Workspace').wait_for()
  page.get_by_role('textbox',name='全局搜索').fill('10k 0603');page.get_by_role('button',name='搜索',exact=True).click();page.get_by_text('全仓库 · 2 种元件').wait_for();page.get_by_role('button',name='清除全局搜索').click();page.get_by_text('全仓库 · 4 种元件').wait_for();page.get_by_label('全局搜索').fill('10k 0603');page.get_by_text('全仓库 · 2 种元件').wait_for()
  page.get_by_text('技术参数筛选',exact=True).click();page.get_by_label('筛选分类').select_option('resistor.smd');page.get_by_label('技术参数',exact=True).select_option('tolerance');page.get_by_label('参数值').fill('1%');page.get_by_role('button',name='添加筛选条件').click();page.get_by_text('全仓库 · 1 种严格匹配元件').wait_for();assert page.get_by_text('RES-002',exact=False).count()==0;page.locator('summary').filter(has_text='技术参数筛选').click();assert not page.get_by_label('筛选分类').is_visible();page.locator('summary').filter(has_text='技术参数筛选').click();assert page.get_by_label('筛选分类').is_visible()
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
  page.get_by_role('button',name='首页',exact=True).click();page.get_by_role('button',name='手动录入').click()
  page.get_by_role('heading',name='查找已有元件').wait_for();assert page.get_by_role('dialog').count()==0;assert page.locator('input[type=file]').count()==0
  page.get_by_label('搜索已有元件').fill('10k 0603');page.get_by_role('button',name='选择 RES-001').wait_for();page.get_by_role('button',name='选择 RES-002').wait_for()
  page.get_by_text('技术参数筛选',exact=True).click();page.get_by_label('筛选分类').select_option('resistor.smd');page.get_by_label('技术参数',exact=True).select_option('tolerance');page.get_by_label('参数值').fill('1%');page.get_by_role('button',name='添加筛选条件').click();assert page.get_by_role('button',name='选择 RES-002').count()==0
  page.get_by_role('button',name='选择 RES-001').click();page.get_by_role('heading',name='数量与存放位置').wait_for()
  page.get_by_label('本次入库数量').fill('100');page.get_by_role('button',name='添加存放位置').click();assert page.get_by_role('button',name='选择库位 A-02').count()==0
  page.get_by_role('button',name='选择库位 A-01').click();assert page.get_by_label('A-01 数量').input_value()=='100';page.get_by_label('A-01 数量').fill('40');page.get_by_text('还需分配 60 件',exact=True).wait_for()
  page.get_by_role('button',name='添加存放位置').click();page.get_by_role('button',name='选择库位 A-04').click();assert page.get_by_label('A-04 数量').input_value()=='60';page.get_by_role('button',name='上一步').click();page.get_by_role('button',name='选择 RES-001').click();assert page.get_by_label('A-04 数量').input_value()=='60'
  assert page.get_by_role('button',name='确认入库',exact=True).is_disabled();page.get_by_label('已核对元件身份',exact=False).check();page.get_by_role('button',name='确认入库',exact=True).click()
  page.get_by_role('button',name='元件',exact=True).click();page.get_by_role('textbox',name='全局搜索').fill('RES-001');page.get_by_text('300 件',exact=True).wait_for();page.get_by_role('button',name='首页',exact=True).click()
  page.get_by_role('button',name='手动录入').click();page.get_by_role('button',name='新建元件',exact=True).click()
  page.get_by_label('元件分类').select_option('resistor.smd');page.get_by_label('元件名称').fill('Historical 22k resistor');page.get_by_label('阻值 · Ω').fill('22kΩ')
  page.get_by_label('已核对草稿和来源',exact=False).check();page.get_by_role('button',name='核对已有库存').click();page.get_by_role('button',name='确认独立建档').click()
  page.get_by_label('本次入库数量').fill('20');page.get_by_role('button',name='添加存放位置').click();page.get_by_label('搜索空闲或同元件库位').fill('A-05');page.get_by_role('button',name='选择库位 A-05').click();page.get_by_label('已确认独立档案及实际存放空间',exact=False).check();page.get_by_role('button',name='确认入库',exact=True).click()
  page.get_by_role('button',name='元件',exact=True).click();page.get_by_role('textbox',name='全局搜索').fill('Historical 22k');page.get_by_text('20 件',exact=True).wait_for();page.get_by_role('button',name='首页',exact=True).click()
  # All image sources have independent file inputs; only the camera requests capture.
  page.get_by_role('button',name='拍照录入').click();page.get_by_role('heading',name='采集元件照片').wait_for()
  assert page.get_by_test_id('receipt-camera').get_attribute('capture')=='environment'
  assert page.get_by_test_id('receipt-album').get_attribute('capture') is None
  assert page.get_by_test_id('receipt-file').get_attribute('capture') is None
  import struct,zlib
  def chunk(t,d):return struct.pack('!I',len(d))+t+d+struct.pack('!I',zlib.crc32(t+d)&0xffffffff)
  png=b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('!2I5B',1,1,8,2,0,0,0))+chunk(b'IDAT',zlib.compress(b'\x00\x33\x66\x99'))+chunk(b'IEND',b'')
  # Check actual activation of the distinct file controls; cancellation must not advance.
  for button,control in [('拍照','receipt-camera'),('从相册选择','receipt-album'),('选择文件','receipt-file')]:
   with page.expect_file_chooser() as fc:page.get_by_role('button',name=button,exact=True).click()
   assert fc.value.element.get_attribute('data-testid')==control
   fc.value.set_files([])
   assert page.get_by_role('heading',name='采集元件照片').is_visible()
  page.get_by_test_id('receipt-album').set_input_files({'name':'album.png','mimeType':'image/png','buffer':png});page.get_by_text('album.png',exact=True).wait_for();assert page.get_by_role('button',name='识别元件',exact=True).is_disabled()
  page.get_by_test_id('receipt-file').set_input_files({'name':'local.png','mimeType':'image/png','buffer':png});page.get_by_text('local.png',exact=True).wait_for();page.once('dialog',lambda d:d.dismiss());page.get_by_role('button',name='取消录入').click();page.get_by_text('local.png',exact=True).wait_for();page.once('dialog',lambda d:d.accept());page.get_by_role('button',name='取消录入').click()
  # Explicit mock gateway test; no user credentials or external network.
  page.get_by_role('button',name='设置',exact=True).click();page.get_by_text('AI Gateway · 未配置',exact=True).click()
  page.get_by_label('Agent API Base URL').fill(f'http://127.0.0.1:{gateway_server.server_port}/v1');page.get_by_label('API Key',exact=True).fill('fixture-key');page.get_by_label('模型或 Agent ID').fill('fixture-model')
  page.get_by_role('button',name='首页',exact=True).click();page.get_by_role('button',name='拍照录入').click();page.get_by_test_id('receipt-camera').set_input_files({'name':'photo.png','mimeType':'image/png','buffer':png});page.get_by_alt_text('待识别元件照片').wait_for();page.wait_for_function("document.querySelector('img[alt=\"待识别元件照片\"]').naturalWidth===1");assert requests==[];page.get_by_role('button',name='识别元件',exact=True).click();page.get_by_text('识别失败，可重试或手动录入。',exact=True).wait_for();assert requests==['valid-photo-post'], requests;page.get_by_role('button',name='识别元件',exact=True).click()
  page.get_by_role('heading',name='核对元件资料').wait_for();page.get_by_alt_text('原始元件照片',exact=True).wait_for();assert page.get_by_label('元件名称').input_value()=='AI 33k resistor';assert requests==['valid-photo-post','valid-photo-post'], requests
  page.get_by_label('已核对草稿和来源',exact=False).check();page.get_by_role('button',name='核对已有库存').click();page.get_by_role('button',name='确认独立建档').click()
  page.get_by_label('本次入库数量').fill('7');page.get_by_role('button',name='添加存放位置').click();page.get_by_label('搜索空闲或同元件库位').fill('B-02');page.get_by_role('button',name='选择库位 B-02').click();page.get_by_label('已确认独立档案及实际存放空间',exact=False).check();page.get_by_role('button',name='确认入库',exact=True).click()
  page.get_by_role('button',name='元件',exact=True).click();page.get_by_role('textbox',name='全局搜索').fill('AI 33k');page.get_by_text('7 件',exact=True).wait_for();page.get_by_role('button',name='首页',exact=True).click()
  assert page.evaluate("!Object.values(localStorage).some(v=>v.includes('fixture-key'))")
  page.evaluate('navigator.serviceWorker.ready');page.wait_for_function('!!navigator.serviceWorker.controller');context.set_offline(True);page.reload();page.get_by_role('heading',name='Studio Workspace').wait_for();page.get_by_role('button',name='元件',exact=True).click();page.get_by_role('textbox',name='全局搜索').fill('Historical 22k');page.get_by_text('20 件',exact=True).wait_for();page.get_by_role('button',name='首页',exact=True).click();assert not errors,errors
  b.close()
finally: server.shutdown();gateway_server.shutdown()
print('PASS: React navigation, search, strict specification filters, unknown candidates, matrix, split receipt, persistent synthetic receipt, independent camera/album/file inputs, mocked AI review and offline shell (synthetic data).')
