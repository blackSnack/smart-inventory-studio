from pathlib import Path
import os
from playwright.sync_api import sync_playwright
p=Path(__file__).resolve().parents[1]
with sync_playwright() as w:
 b=w.chromium.launch(executable_path=os.environ.get('CHROMIUM_EXECUTABLE') or None, args=['--no-sandbox'])
 page=b.new_page(viewport={'width':390,'height':844}); errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 html=(p/'index.html').read_text(); page.set_content(html.replace('<script>','<script>Object.defineProperty(window,"localStorage",{value:{getItem:()=>null,setItem:()=>{}}});',1))
 assert page.get_by_text('我的工作室').is_visible()
 page.screenshot(path=str(p/'tests/home-mobile.png'),full_page=True)
 page.locator('input[name=q]').fill('10k');page.locator('form.search button').click();assert page.get_by_text('2 种元件').is_visible()
 page.locator('#bottom').get_by_text('仓储').click();page.get_by_text('电子元件柜 B',exact=True).click();page.get_by_text('扩库 / 补齐',exact=True).click();page.locator('#cr').fill('5');page.get_by_text('确认模拟创建').click();assert page.locator('#app .matrix .cell').count()==25,(page.locator('#app .matrix .cell').count(),page.locator('body').inner_text(),errors)
 page.locator('#app .matrix .cell').nth(1).click();page.get_by_text('编辑分隔').click();page.locator('#pn').select_option('3');page.get_by_text('确认模拟变更').click();assert page.get_by_text('3 子格').is_visible()
 page.locator('#bottom').get_by_text('首页').click();page.get_by_text('手动录入').click();page.locator('#en').fill('10k');page.get_by_text('确认同一元件').first.click();page.locator('input[aria-label="A-01 数量"]').fill('40');page.locator('input[aria-label="A-04 数量"]').fill('60');page.locator('#physical').check();page.get_by_text('审核入库').click();page.get_by_text('确认模拟入库').click();assert page.get_by_text('600',exact=True).is_visible() # initial 500 + 100
 page.locator('#bottom').get_by_text('设置').click();assert page.get_by_text('库存 Provider').is_visible();page.locator('#bottom').get_by_text('首页').click();assert page.get_by_text('600',exact=True).is_visible()
 assert not errors,errors
 page.set_viewport_size({'width':1280,'height':900});page.screenshot(path=str(p/'tests/home-desktop.png'),full_page=True)
 b.close()
print('PASS: mobile layout, search, expansion, split, multi-location receipt, settings; storage mocked; no JS page errors. Desktop screenshot captured.')
