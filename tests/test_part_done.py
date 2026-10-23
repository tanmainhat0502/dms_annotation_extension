"""Part-wide Done checkbox: full scope, sticky layout, progress and failures."""
import asyncio
import json
import os
from pathlib import Path

from playwright.async_api import async_playwright

from _ext import read_organizer_script
from test_sidebar_scroll import HTML, settle, click_without_scrolling

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = read_organizer_script()
PART = '.grp[data-part-name="Phone call"]'
CHECK = PART + ' .nl-part-done'


class Server:
    def __init__(self):
        self.gate = asyncio.Event()
        self.gate.set()
        self.posts = []
        self.fail = set()
        self.active = self.peak = 0
        self.image_calls = []

    async def route(self, route):
        if route.request.url.endswith('/api/frame_status'):
            data = route.request.post_data_json
            self.posts.append(data)
            self.active += 1
            self.peak = max(self.peak, self.active)
            try:
                await self.gate.wait()
                await asyncio.sleep(.005)
                failed = data['i'] in self.fail
                await route.fulfill(status=503 if failed else 200,
                                    body=json.dumps({'detail': 'Test save failure'} if failed else {}),
                                    content_type='application/json')
            finally:
                self.active -= 1
        elif '/api/frame?' in route.request.url:
            from urllib.parse import urlparse, parse_qs
            self.image_calls.append(int(parse_qs(urlparse(route.request.url).query)['i'][0]))
            await route.fulfill(body=(ROOT/'extension/icons/icon16.png').read_bytes(), content_type='image/png')
        elif route.request.url == 'https://ntt.dev.nota.ai/':
            await route.fulfill(body=HTML, content_type='text/html')
        else:
            await route.abort()


async def setup(browser):
    page = await browser.new_page(viewport={'width':1100, 'height':820})
    server, errors = Server(), []
    page.on('pageerror', lambda error: errors.append(str(error)))
    await page.route('**/*', server.route)
    await page.goto('https://ntt.dev.nota.ai/')
    await page.add_script_tag(content=SCRIPT)
    await page.wait_for_selector(CHECK, state='attached')
    await page.evaluate("""()=>{
      document.querySelectorAll('.nl-clip').forEach(el=>el.open=true);
      show(228);
    }""")
    await settle(page)
    return page, server, errors


async def finished(page):
    await page.wait_for_function("!document.querySelector('.nl-part-tools[aria-busy=true]')")
    await settle(page)


async def assert_visible(page):
    assert await page.locator(CHECK).evaluate("""el=>{
      const r=el.getBoundingClientRect(),p=document.querySelector('#labPane').getBoundingClientRect();
      const t=document.querySelector('#nota-labeling-organizer-v1').getBoundingClientRect();
      return r.top>=t.bottom && r.bottom<=p.bottom &&
        document.elementFromPoint(r.left+r.width/2,r.top+r.height/2)===el;
    }"""), 'Part checkbox must remain visible and clickable'


async def test_done_reopen_and_sticky(browser):
    page, server, errors = await setup(browser)
    await page.evaluate("""()=>{
      S.fstat['segment:150']={body:{s:'done'},eye:{s:'done'}};
      S.fstat['segment:151']={body:{s:'wip'}};fsRender();
      document.querySelector('.grp[data-part-name="Phone call"] .nl-clip').open=false;
    }""")
    assert await page.locator(CHECK).evaluate('el=>el.indeterminate')
    assert await page.locator(PART+' .nl-part-total').inner_text() == '150 frames'
    for fraction in (.2, .75, .4):
        await page.locator(PART).evaluate("""(row,fraction)=>{
          const pane=document.querySelector('#labPane'),toolbar=document.querySelector('#nota-labeling-organizer-v1');
          pane.scrollTop+=row.getBoundingClientRect().top-toolbar.getBoundingClientRect().bottom+row.offsetHeight*fraction;
        }""", fraction)
        await settle(page)
        await assert_visible(page)
    if os.environ.get('NOTA_TEST_SCREENSHOT'):
        await page.screenshot(path=os.environ['NOTA_TEST_SCREENSHOT'])
    old_top = await page.evaluate('document.querySelector("#labPane").scrollTop')
    server.gate.clear()
    await click_without_scrolling(page, CHECK)
    await page.wait_for_function('document.querySelector(".nl-part-tools[aria-busy=true]")')
    assert await page.locator(CHECK).is_disabled()
    assert await page.locator(PART+' .nl-part-total').inner_text() == '0/149'
    await asyncio.sleep(.1)
    assert len(server.posts) == 4 and server.peak <= 4, server.posts
    assert await page.evaluate('fsGet(152)') == 'todo', 'Do not optimistically mark unsaved frames Done'
    assert await page.locator(PART+' .nl-clip button[data-state="done"]').first.is_disabled()
    server.gate.set()
    await finished(page)
    assert sorted(p['i'] for p in server.posts) == list(range(151,300))
    assert all(p['label']=='body' and p['state']=='done' for p in server.posts)
    assert await page.locator(CHECK).is_checked()
    assert not await page.locator(CHECK).evaluate('el=>el.indeterminate')
    assert await page.evaluate('Array.from({length:150},(_,i)=>fsGet(i+150)).every(s=>s==="done")')
    assert await page.evaluate('fsGet(149)') == 'todo'
    assert await page.evaluate('fsGet(300)') == 'todo'
    assert await page.evaluate('fsGet(150,"eye")') == 'done'
    assert abs(await page.evaluate('document.querySelector("#labPane").scrollTop') - old_top) <= 1
    assert await page.evaluate('S.shownG') == 228
    await assert_visible(page)
    server.posts.clear()
    await click_without_scrolling(page, CHECK)
    await finished(page)
    assert len(server.posts)==150 and all(p['state']=='wip' for p in server.posts)
    assert await page.evaluate('Array.from({length:150},(_,i)=>fsGet(i+150)).every(s=>s==="wip")')
    assert not await page.locator(CHECK).is_checked()
    assert not await page.locator(CHECK).evaluate('el=>el.indeterminate')
    assert await page.evaluate('fsGet(150,"eye")')=='done'
    await page.evaluate('renderLabList()')
    await settle(page)
    assert await page.locator('.nl-part-done').count()==4
    assert not await page.locator(CHECK).is_checked()
    # Keyboard Space must toggle the checkbox, not playback.
    server.posts.clear()
    await page.evaluate("window.spaceEvents=0;document.addEventListener('keydown',e=>{if(e.code==='Space')window.spaceEvents++;})")
    await page.locator(CHECK).evaluate('el=>el.focus({preventScroll:true})')
    await page.keyboard.press('Space')
    await finished(page)
    assert await page.locator(CHECK).is_checked()
    assert await page.evaluate('window.spaceEvents')==0
    await page.set_viewport_size({'width':1100,'height':650})
    await page.evaluate('show(228)')
    await settle(page)
    await assert_visible(page)
    assert not errors, errors
    await page.close()
    print('PASS: whole part Done/In progress, mixed state, collapsed clips, 4-request limit, single-label scope, sticky scroll/resize and keyboard')


async def test_hidden_and_failed(browser):
    page, server, errors = await setup(browser)
    await page.evaluate("""()=>{
      for(let g=150;g<160;g++)S.fstat[rvKey(g)]={body:{s:'done'}};
      S.review[rvKey(299)].labels=['eye'];
      S.onlyTodo=true;buildSeq();renderLabList();show(228);
    }""")
    await settle(page)
    assert await page.locator(PART+' .nl-part-total').inner_text()=='149 frames'
    assert await page.locator(CHECK).evaluate('el=>el.indeterminate')
    server.fail={160}
    await click_without_scrolling(page, CHECK)
    await finished(page)
    assert len(server.posts)<=7, len(server.posts)
    assert await page.evaluate('fsGet(160)')=='todo'
    assert await page.locator(CHECK).evaluate('el=>el.indeterminate')
    assert 'stopped on error' in await page.evaluate('window.lastMessage')
    assert not await page.locator(CHECK).is_disabled()
    server.fail.clear(); server.posts.clear()
    await click_without_scrolling(page, CHECK)
    await finished(page)
    assert all(160<=p['i']<299 for p in server.posts)
    assert await page.evaluate('Array.from({length:149},(_,i)=>fsGet(i+150)).every(s=>s==="done")')
    assert await page.evaluate('fsGet(299)')=='todo', 'Do not modify frames without this label'
    await page.evaluate('S.onlyTodo=false;buildSeq();renderLabList();show(228)')
    await settle(page)
    assert await page.locator(CHECK).is_checked()
    server.posts.clear()
    await click_without_scrolling(page, CHECK)
    await finished(page)
    assert sorted(p['i'] for p in server.posts)==list(range(150,299))
    assert all(p['state']=='wip' for p in server.posts)
    assert not errors, errors
    await page.close()
    print('PASS: hidden Done frames, label authorization, partial failure, retry missing saves and reopening all frames')


async def test_scope_changes(browser):
    for change in ('S.gen++;S.sess={...S.sess};S.fstat={}', "S.labelSel='eye'", "S.mode='review'"):
        page, server, errors = await setup(browser)
        server.gate.clear()
        await click_without_scrolling(page, CHECK)
        await page.wait_for_function('document.querySelector(".nl-part-tools[aria-busy=true]")')
        await asyncio.sleep(.08)
        assert len(server.posts)==4
        await page.evaluate(change)
        server.gate.set()
        await asyncio.sleep(.2)
        assert len(server.posts)==4, 'Stop scheduling saves after a scope change'
        if 'S.gen++' in change:
            assert await page.evaluate('Object.keys(S.fstat).length')==0, 'Old responses must not enter the new session'
        assert all(p['label']=='body' for p in server.posts)
        assert not errors, errors
        await page.close()
    print('PASS: session/label/mode changes stop queued writes; stale responses cannot update another session')


async def test_preloader_transition(browser):
    page, server, errors = await setup(browser)
    await page.add_script_tag(content=(ROOT/'extension/preload.js').read_text(encoding='utf-8'))
    await page.wait_for_selector('#start_auto_load')
    await page.locator('#start_auto_load').click()
    await page.wait_for_function("document.querySelector('.nl-load-parts').textContent==='Phone call + Bottle'")
    server.gate.clear()
    await click_without_scrolling(page, CHECK)
    await asyncio.sleep(.65)
    assert await page.locator('.nl-load-parts').inner_text()=='Phone call + Bottle'
    server.gate.set()
    await finished(page)
    await asyncio.sleep(.65)
    assert await page.locator('.nl-load-parts').inner_text()=='Phone call + Bottle'
    assert await page.locator(CHECK).is_checked()
    await page.evaluate('S.onlyTodo=true;fsRender()')
    await page.wait_for_function("document.querySelector('.nl-load-parts').textContent==='Bottle + Acting'")
    assert not errors, errors
    await page.close()
    print('PASS: preloader retains Done parts visible in sidebar and advances when hidden from sidebar')


async def main():
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        await test_done_reopen_and_sticky(browser)
        await test_hidden_and_failed(browser)
        await test_scope_changes(browser)
        await test_preloader_transition(browser)
        await browser.close()


if __name__=='__main__':
    asyncio.run(main())
