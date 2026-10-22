"""Mouse/keyboard filtering in the scrolling DMS sidebar, including preloader UI."""
import asyncio

from playwright.async_api import async_playwright

from test_sidebar_scroll import PRELOAD, settle, click_without_scrolling
from test_status_controls import HTML, SCRIPT, StatusServer, FILTER

LAYOUT = """
#side {width:340px; background:#1e2126;}
#menu {display:flex; margin-bottom:8px; flex:none;}
#menu button {width:100%; padding:7px;}
#clipSess {font-weight:600; margin:4px 0 2px;}
#labBack {margin-bottom:8px; padding:7px;}
#labTitle {font-weight:600; margin-bottom:6px;}
#labProg {margin-bottom:6px; padding:6px 8px; background:#23272e;
  border:1px solid #30343b; border-radius:4px;}
#side label {display:block; color:#9aa0a8; margin-bottom:6px;}
#labProg .progBar {display:flex; height:6px; background:#3a3f47; margin:5px 0 6px;}
"""
PAGE = HTML.replace('</style>', LAYOUT + '</style>')
PAGE = PAGE.replace('<div id="labPane">', '<nav id="menu"><button>List</button></nav>'
                    '<div id="clipSess">Local test session</div><div id="labPane">'
                    '<button id="labBack">Session list</button>')
PAGE = PAGE.replace('<div id="labProg"></div><div id="labTitle">Labeling · body</div>',
                    '<div id="labTitle">Labeling · body</div><div id="labProg"></div>')


class LayoutServer(StatusServer):
    async def route(self, route):
        if route.request.url == 'https://ntt.dev.nota.ai/':
            await route.fulfill(body=PAGE, content_type='text/html')
        else:
            await super().route(route)


async def setup(browser, width=340):
    page = await browser.new_page(viewport={'width':1100, 'height':820})
    server, errors = LayoutServer(), []
    page.on('pageerror', lambda e: errors.append(str(e)))
    await page.route('**/*', server.route)
    await page.goto('https://ntt.dev.nota.ai/')
    await page.add_style_tag(content=f'#side {{width:{width}px}}')
    await page.evaluate("""() => {
      for(let g=0;g<600;g++)S.fstat[rvKey(g)].body={s:g<150?'done':'wip'};
      localStorage.setItem('nota-labeling-organizer-status-filter-v1',
        JSON.stringify({done:false,wip:true,todo:true}));
      show(500);
    }""")
    await page.add_script_tag(content=SCRIPT)
    await page.add_script_tag(content=PRELOAD)
    await page.wait_for_selector('#start_auto_load')
    await settle(page)
    return page, server, errors


async def snapshot(page):
    return await page.evaluate("""() => ({
      pane:document.querySelector('#labPane').scrollTop,
      side:document.querySelector('#side').scrollTop,
      top:document.querySelector('#nl-status-filters').getBoundingClientRect().top,
      shown:S.shownG,
      window:window.scrollY
    })""")


async def test_controls_stay_in_view(browser):
    for width in (340, 315):
        page, server, errors = await setup(browser, width)
        # Include collapsed clips and a partly scrolled header, as in DMS.
        for collapsed, scroll in ((False, 0), (True, 0), (True, 40)):
            if collapsed:
                await page.evaluate("show(500)")
                await settle(page)
                current_clip = page.locator('.nl-clip.nl-current')
                if await current_clip.evaluate('el=>el.open'):
                    await current_clip.locator('summary').click(position={'x':10, 'y':10})
                assert not await current_clip.evaluate('el=>el.open')
            await page.evaluate('y=>document.querySelector("#labPane").scrollTop=y', scroll)
            await settle(page)
            before = await snapshot(page)
            for value in (True, False, True, False):
                await click_without_scrolling(page, FILTER.format('done'))
                await page.wait_for_timeout(150)
                after = await snapshot(page)
                assert abs(after['top'] - before['top']) <= 1, (collapsed, before, after)
                assert abs(after['pane'] - before['pane']) <= 1, (before, after)
                assert after['side'] == before['side'] and after['window'] == before['window']
                assert after['shown'] == before['shown']
                assert await page.locator(FILTER.format('done')).is_checked() == value
            await page.wait_for_timeout(550)  # Include delayed observer/preloader paints.
            assert abs((await snapshot(page))['top'] - before['top']) <= 1
        assert not server.posts
        assert not errors, errors
        await page.close()
    print('PASS: clicking Show done on/off keeps filters visible at both sidebar widths')


async def test_filter_navigation(browser):
    page, server, errors = await setup(browser)
    await page.evaluate("""() => {
      for(let g=150;g<300;g++)S.fstat[rvKey(g)].body={s:'todo'};
      buildSeq();renderLabList();show(500);
      document.querySelector('#labPane').scrollTop=0;
      // Model DMS show(): paint/highlight occurs after the image has loaded.
      show=async function(g){
        S.g=g;
        await new Promise(resolve=>{window.completeImage=resolve;});
        if(S.g!==g)return;
        S.shownG=g;rvMarkLab();
      };
    }""")
    await settle(page)
    before = await snapshot(page)
    await click_without_scrolling(page, FILTER.format('done'))
    await click_without_scrolling(page, FILTER.format('wip'))
    await page.evaluate('window.completeImage()')
    await settle(page)
    assert await page.evaluate('S.shownG') == 0
    assert abs((await snapshot(page))['top'] - before['top']) <= 1
    # Each status filter must be usable in place, including an empty result.
    for state in ('done', 'todo', 'wip'):
        await click_without_scrolling(page, FILTER.format(state))
        await page.evaluate('window.completeImage()')
        await settle(page)
        assert abs((await snapshot(page))['top'] - before['top']) <= 1
    assert await page.evaluate('S.lseq.includes(S.shownG)')
    # A real subsequent navigation still reveals the destination frame.
    await page.evaluate('show(550);window.completeImage()')
    await settle(page)
    assert await page.locator('li[data-g="550"]').evaluate("""el=>{
      const row=el.getBoundingClientRect(),pane=document.querySelector('#labPane').getBoundingClientRect();
      return row.bottom>pane.top && row.top<pane.bottom;
    }""")
    assert not server.posts
    assert not errors, errors
    await page.close()
    print('PASS: all status checkboxes, empty results, delayed replacement images and subsequent deliberate navigation')


async def test_keyboard_and_hidden_current(browser):
    page, server, errors = await setup(browser)
    await page.evaluate("""() => {
      S.g=S.shownG=50;
      document.querySelectorAll('li.cur').forEach(el=>el.classList.remove('cur'));
      document.querySelector('#labPane').scrollTop=0;
    }""")
    await settle(page)
    before = await snapshot(page)
    await page.locator(FILTER.format('done')).focus()
    await page.keyboard.press('Space')
    await settle(page)
    assert await page.evaluate('S.shownG') == 50
    assert abs((await snapshot(page))['top'] - before['top']) <= 1
    # Later native repaints must not undo the restored viewport.
    await page.evaluate('rvMarkLab();renderLabList();rvMarkLab()')
    await settle(page)
    after = await snapshot(page)
    assert abs(after['top'] - before['top']) <= 1, (before, after)
    assert await page.evaluate('window.spaceEvents') == 0
    assert not server.posts
    assert not errors, errors
    await page.close()
    print('PASS: keyboard checkbox, hidden current frame reappearing and later native repaints')


async def main():
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        try:
            await test_controls_stay_in_view(browser)
            await test_filter_navigation(browser)
            await test_keyboard_and_hidden_current(browser)
        finally:
            await browser.close()


if __name__ == '__main__':
    asyncio.run(main())
