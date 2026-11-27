"""Synthetic read-only Part batch and separately injected AI Gateway; no real data or external requests."""
from urllib.parse import urlparse,parse_qs
import json
def exercise_live_enrichment(page,base,capture=None):
 seen=[];requests=[];failed=True;stale=False
 headers={'access-control-allow-origin':'*','access-control-allow-headers':'authorization,content-type','access-control-allow-methods':'GET, OPTIONS, POST'}
 parts=[{'pk':42,'name':'Fixture resistor A','IPN':'R-01','description':'internal A','category':1},{'pk':43,'name':'Fixture resistor B','IPN':'R-02','description':'internal B','category':1}]
 templates=[{'pk':5,'name':'Resistance','units':'Ω','model_type':'part.part','enabled':True,'checkbox':False,'choices':'','selectionlist':None},{'pk':6,'name':'Voltage Rating','units':'V','model_type':'part.part','enabled':True,'checkbox':False,'choices':'','selectionlist':None}]
 schema={'openapi':'3.0.3','paths':{k:{'get':{}} for k in ['/api/part/{id}/','/api/part/category/','/api/part/category/parameters/','/api/parameter/','/api/parameter/template/','/api/company/part/manufacturer/','/api/company/part/','/api/attachment/']}}
 def inventory(route):
  req=route.request;seen.append(req.method)
  if req.method=='OPTIONS':route.fulfill(status=204,headers=headers);return
  assert req.method=='GET';assert req.headers.get('authorization')=='Token fixture-token'
  u=urlparse(req.url);q=parse_qs(u.query);path=u.path
  if path=='/api/schema/':data=schema
  elif path=='/api/stock/location/':data=[]
  elif path=='/api/part/':data=parts
  elif path in ['/api/part/42/','/api/part/43/']:data=next(p for p in parts if str(p['pk'])==path.split('/')[-2])
  elif path=='/api/stock/':data=[]
  elif path=='/api/part/category/':data=[{'pk':1,'name':'Resistors','parent':None}]
  elif path=='/api/part/category/parameters/':data=[{'pk':7,'category':1,'template':5},{'pk':8,'category':1,'template':6}]
  elif path=='/api/parameter/template/':assert q.get('for_model')==['part.part'];data=templates
  elif path=='/api/parameter/':
   assert q.get('model_type')==['part.part'];pk=int(q['model_id'][0]);data=[{'pk':pk+100,'model_type':'part.part','model_id':pk,'template':5,'data':'20kΩ' if stale and pk==42 else '10kΩ','note':'keep'}]
  elif path=='/api/company/part/manufacturer/':
   pk=int(q['part'][0]);data=[{'pk':pk+200,'part':pk,'manufacturer':3,'manufacturer_detail':{'pk':3,'name':'Public Maker'},'MPN':'FIX-'+str(pk)}]
  elif path in ['/api/company/part/','/api/attachment/']:data=[]
  else:raise AssertionError(path)
  route.fulfill(json=data,headers=headers)
 def agent(route):
  nonlocal failed
  req=route.request
  if req.method=='OPTIONS':route.fulfill(status=204,headers=headers);return
  assert req.method=='POST' and req.headers.get('authorization')=='Bearer fixture-ai'
  body=json.loads(req.post_data);data=json.loads(body['messages'][1]['content']);requests.append(data['mpn'])
  assert data['name']=='Public Maker '+data['mpn'];assert data['known']['resistance']=='10kΩ';assert data['known']['rated_voltage'] is None
  assert not any(v in req.post_data for v in ['R-01','R-02','internal A','internal B','fixture-token','partId','locationId'])
  if data['mpn']=='FIX-43' and failed:
   failed=False;route.fulfill(status=429,headers=headers);return
  ev=[{'url':'https://example.test/spec','locator':'page 3'}]
  suggestions=[{'key':'resistance','value':'20kΩ','evidence':ev},{'key':'rated_voltage','value':'25V','evidence':ev}]
  if data['mpn']=='FIX-42':
   assert data['known']['datasheetUrl'] is None
   suggestions.append({'key':'datasheetUrl','value':'https://example.test/spec','evidence':ev})
  route.fulfill(json={'choices':[{'message':{'content':json.dumps({'suggestions':suggestions})}}]},headers=headers)
 page.route('https://batch-inventory.example.test/**',inventory);page.route('https://batch-gateway.example.test/**',agent)
 page.goto(base);page.get_by_role('button',name='设置',exact=True).click();page.get_by_role('button',name='真实库存只读验证').click()
 page.get_by_label('服务地址').fill('https://batch-inventory.example.test');page.get_by_label('只读 API Token').fill('fixture-token');page.get_by_role('button',name='测试并连接').click()
 page.get_by_text('已连接 · 只读',exact=True).wait_for();page.get_by_label('全局库存搜索').fill('fixture');page.get_by_role('button',name='搜索',exact=True).click()
 page.get_by_label('选择 R-01 补全',exact=True).check();page.get_by_label('选择 R-02 补全',exact=True).check();page.get_by_role('button',name='批量补全资料').click()
 page.get_by_role('button',name='读取待审核元件').click()
 for ipn in ['R-01','R-02']:
  row=page.get_by_role('region',name='审核 '+ipn)
  row.get_by_label('标准分类 '+ipn).select_option('resistor.smd')
  if ipn=='R-01':
   row.get_by_text('已有资料与缺项确认',exact=True).click();row.get_by_label('已核对原有资料，缺少数据手册').check()
  row.get_by_label('已核对公开型号、分类及勾选映射').check()
 page.get_by_label('Agent API Base URL').fill('https://batch-gateway.example.test/v1');page.get_by_label('API Key',exact=True).fill('fixture-ai');page.get_by_label('模型或 Agent ID').fill('fixture')
 assert page.get_by_role('button',name='获取资料',exact=True).is_disabled()
 page.get_by_label('允许向已配置 Gateway',exact=False).check();page.get_by_role('button',name='获取资料',exact=True).click()
 page.get_by_role('region',name='审核 R-02').get_by_role('alert').wait_for();page.get_by_label('采用 R-01 额定电压').wait_for()
 assert page.get_by_label('采用 R-01 阻值').is_disabled();assert page.get_by_role('link',name='page 3 · example.test').count()>=1
 page.get_by_label('采用 R-01 额定电压').check();page.get_by_role('button',name='重试失败项').click();page.get_by_label('采用 R-02 额定电压').wait_for();assert requests.count('FIX-42')==1 and requests.count('FIX-43')==2
 assert page.get_by_label('采用 R-01 额定电压').is_checked();page.get_by_label('采用 R-02 额定电压').check();page.get_by_label('采用 R-01 数据手册').check()
 if capture:capture(page,'27-mobile-live-enrichment' if page.viewport_size['width']<768 else '28-desktop-live-enrichment')
 page.get_by_label('已核对选中字段的来源',exact=False).check();page.get_by_role('button',name='生成审核计划（3）').click();page.get_by_text('已生成 3 项待执行操作，未写入库存。').wait_for()
 if capture:capture(page,'29-mobile-live-enrichment-plan' if page.viewport_size['width']<768 else '30-desktop-live-enrichment-plan',page.get_by_role('region',name='审核计划结果'))
 with page.expect_download() as downloaded:page.get_by_role('button',name='导出审核计划').click()
 data=json.loads(downloaded.value.path().read_text());assert data['status']=='reviewed_candidate_not_executable';assert len(data['plan']['operations'])==3
 assert [o['kind'] for o in data['plan']['operations']]==['set-part-parameter','set-part-source','set-part-parameter']
 assert all(o['payload']['value']=='25V' and o['payload']['templateId']=='6' for o in data['plan']['operations'] if o['kind']=='set-part-parameter')
 assert data['plan']['operations'][1]['payload']['url']=='https://example.test/spec'
 stale=True;page.get_by_label('已核对选中字段的来源',exact=False).check();page.get_by_role('button',name='生成审核计划（3）').click();page.get_by_role('alert').filter(has_text='审核计划未生成').wait_for();assert page.get_by_role('button',name='导出审核计划').count()==0
 assert all(m in ('GET','OPTIONS') for m in seen)
 page.get_by_role('button',name='返回元件').click();page.get_by_role('button',name='放弃审核').click();page.get_by_role('button',name='查看 R-01 详情').click();page.get_by_role('dialog').get_by_role('button',name='补全资料',exact=True).click();page.get_by_role('heading',name='批量资料补全 · 只读').wait_for();assert page.get_by_role('region',name='审核 R-02').count()==0
