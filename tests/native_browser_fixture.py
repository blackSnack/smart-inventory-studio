from urllib.parse import urlparse, parse_qs

def exercise_native_browser(page, app_url):
    origin='http://127.0.0.1:8123'
    writes=[]
    stocks=[{'pk':9,'part':42,'location':2,'quantity':'10','batch':'B1','serial':None,'status':10}]
    locations=[{'pk':1,'name':'Cabinet','parent':None,'structural':True},{'pk':2,'name':'A-01','parent':1,'structural':False},{'pk':3,'name':'A-02','parent':1,'structural':False}]
    categories=[{'pk':1,'name':'Root','parent':None,'description':'','structural':True},{'pk':11,'name':'Resistors','parent':1,'description':'','structural':False}]
    templates=[{'pk':5,'name':'Resistance','units':'Ω','description':'','model_type':'part.part','enabled':True,'checkbox':False,'choices':'','selectionlist':None}]
    part={'pk':42,'name':'Fixture resistor','IPN':'R-01','description':'Fixture','category':11,'active':True,'trackable':False,'virtual':False}
    schema={'openapi':'3.0.3','paths':{'/api/part/{id}/':{'get':{}},'/api/part/':{'get':{},'post':{}},'/api/part/category/':{'get':{},'post':{}},'/api/parameter/template/':{'get':{},'post':{}},'/api/stock/location/':{'get':{}},'/api/stock/':{'get':{},'post':{}}}}
    lose=False
    def api(route):
        req=route.request;path=urlparse(req.url).path;q=parse_qs(urlparse(req.url).query)
        headers={'access-control-allow-origin':'*','access-control-allow-headers':'authorization,content-type','access-control-allow-methods':'GET, POST, OPTIONS'}
        if req.method=='OPTIONS':
            route.fulfill(status=204,headers=headers);return
        assert req.headers.get('authorization')=='Token synthetic-native'
        if req.method=='POST':
            body=req.post_data_json;writes.append((path,body));assert path=='/api/stock/'
            row={'pk':100+len(writes),**body,'batch':None,'serial':None,'status':10}
            stocks.append(row)
            if lose:route.abort('failed');return
            route.fulfill(status=201,json=[row],headers=headers);return
        assert req.method=='GET'
        if path=='/api/':data={'server':'InvenTree','version':'1.7.4','apiVersion':570}
        elif path=='/api/user/me/':data={'pk':1}
        elif path=='/api/schema/':data=schema
        elif path=='/api/stock/location/':data=locations
        elif path=='/api/part/category/':data=categories
        elif path=='/api/parameter/template/':data=templates
        elif path=='/api/part/':data=[part]
        elif path=='/api/part/42/':data=part
        elif path=='/api/stock/':data=[x for x in stocks if 'location' not in q or str(x['location'])==q['location'][0]]
        else:raise AssertionError(path)
        route.fulfill(json=data,headers=headers)
    page.route(origin+'/**',api)
    def connect():
        page.goto(app_url)
        page.get_by_role('button',name='设置',exact=True).click()
        page.get_by_role('button',name='真实库存只读验证').click()
        page.get_by_label('连接独立测试实例进行写入验收').check()
        page.get_by_label('服务地址').fill(origin+'/')
        page.get_by_label('隔离实例 API Token').fill('synthetic-native')
        page.get_by_role('button',name='测试并连接').click()
        page.get_by_text('隔离实例 · 待验收',exact=True).wait_for()
        page.get_by_role('button',name='已有元件入库',exact=True).click()
    def prepare(location,quantity):
        page.get_by_label('查找真实元件').fill('R-01')
        page.get_by_role('button',name='搜索',exact=True).click()
        page.get_by_label('元件',exact=True).select_option('42')
        page.get_by_label('总入库数量').fill(str(quantity))
        page.get_by_label('库位',exact=True).select_option(location)
        page.get_by_label('数量',exact=True).fill(str(quantity))
        page.get_by_role('button',name='读取基线并生成审核').click()
        page.get_by_role('heading',name='本次变更审核').wait_for()
        assert page.get_by_role('button',name='确认执行本项').is_disabled()
        for label in ['已确认这是独立的可丢弃测试实例','已核对 Token 权限','已核对元件身份','允许对该测试实例执行']:
            page.get_by_label(label,exact=False).check()
    connect()
    prepare('2',3);assert not writes
    page.get_by_role('button',name='确认执行本项').click()
    page.get_by_text('本项已读回验证。',exact=True).wait_for()
    assert writes==[('/api/stock/',{'part':42,'location':2,'quantity':3})]
    assert page.evaluate("!Object.values(localStorage).some(v=>v.includes('synthetic-native'))")
    prepare('3',2);lose=True
    page.get_by_role('button',name='确认执行本项').click()
    page.get_by_text('写入结果未知，请先恢复读取。').wait_for()
    assert len(writes)==2
    connect()
    page.get_by_role('heading',name='待恢复操作').wait_for()
    assert page.get_by_role('button',name='读取并审核下一项').is_disabled()
    page.get_by_role('button',name='仅重新读回').click()
    page.get_by_text('仍未获得可靠的执行证据，请核对服务端审计。').wait_for()
    assert len(writes)==2
    assert page.get_by_role('button',name='读取并审核下一项').is_disabled()
    print('PASS: browser native receipt prepare/approval/write/readback, durable unresolved recovery and no replay (synthetic only).')
