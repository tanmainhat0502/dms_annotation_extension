"""Three status filters and source-only clip transitions, with local responses."""
import asyncio
import itertools
import json
from pathlib import Path

from playwright.async_api import async_playwright

from test_sidebar_scroll import HTML as BASE, settle, click_without_scrolling
from test_part_done import Server

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = (ROOT / 'extension/content.js').read_text(encoding='utf-8')
CLIP = '.grp[data-part-name="Phone call"] .nl-clip[data-clip="#02"]'
FILTER = '#nl-status-filters input[data-state="{}"]'
STATES = ['done', 'wip', 'todo']
SETUP = """
const $=id=>document.getElementById(id);
function paint(){}
function labEmptyView(text){window.emptyMessage=text;}
function fsCount(label){
  const counts={done:0,wip:0,todo:0};
  for(const item of Object.values(S.review))if(item.labels.includes(label))counts[fsGet(item.i,label)]++;
  return counts;
}
function playNext(g,step=1){
  const i=Array.from(S.lseq).indexOf(g);return S.lseq[Math.min(S.lseq.length-1,i+step)] ?? g;
}
window.spaceEvents=0;
document.addEventListener('keydown',e=>{if(e.code==='Space')window.spaceEvents++;});
function seed(){
  S.fstat={};
  for(let g=0;g<600;g++)S.fstat[rvKey(g)]={body:{s:['done','wip','todo'][g%3]},eye:{s:'done'}};
  S.review[rvKey(247)].labels=['eye'];
  S.ledits[rvKey(228)]={body:[{box:[1,2,3,4]}]};
}
function buildSeq(){S.lseq=Int32Array.from(Object.values(S.review)
  .filter(it=>(S.mode==='review2' || it.labels.includes(S.labelSel)) &&
    (S.mode!=='label' || !S.onlyTodo || fsGet(it.i)!=='done')).map(it=>it.i));}
function renderProg(){
  const c=fsCount(S.labelSel);
  $('labProg').innerHTML=`<div class="progTop">${c.done} Done · ${c.wip} In progress · ${c.todo} Not checked</div>
    <label><input type="checkbox" id="onlyTodo"> Show only unfinished</label>`;
  $('onlyTodo').onchange=e=>{S.onlyTodo=e.target.checked;buildSeq();renderLabList();};
}
seed();
"""
# Exercise the saved DMS sequence/progress/status functions when available.
native = ROOT.parent / 'NOTA_LABEL/DMS Web Viewer_files/review.js.download'
if native.exists():
    source = native.read_text(encoding='utf-8')
    for name, end in [('buildSeq', '\nfunction setMode'), ('renderProg', '\n// 영상'),
                      ('fsRender', '\n// 왼쪽')]:
        start = source.index('function ' + name + '(')
        SETUP += '\n' + source[start:source.index(end, start)]

HTML = BASE.replace('<div id="labTitle">', '<div id="labProg"></div><div id="labTitle">')
HTML = HTML.replace('function renderLabList(){', 'function renderLabList(){renderProg();')
HTML = HTML.replace('buildSeq();renderLabList();\n</script>', SETUP + '\nbuildSeq();renderLabList();\n</script>')


class StatusServer(Server):
    async def route(self, route):
        if route.request.url == 'https://ntt.dev.nota.ai/':
            await route.fulfill(body=HTML, content_type='text/html')
        else:
            await super().route(route)


async def setup(browser):
    page = await browser.new_page(viewport={'width':1100, 'height':820})
    server, errors = StatusServer(), []
    page.on('pageerror', lambda e: errors.append(str(e)))
    await page.route('**/*', server.route)
    await page.goto('https://ntt.dev.nota.ai/')
    await page.add_script_tag(content=SCRIPT)
    await page.wait_for_selector('#nl-status-filters')
    await page.evaluate('show(228)')
    await settle(page)
    return page, server, errors


async def select_states(page, wanted):
    for state in STATES:
        await page.locator(FILTER.format(state)).set_checked(state in wanted)
    await settle(page)


async def finished(page):
    await page.wait_for_function("!document.querySelector('.nl-clip-status-actions[aria-busy=true]')")
    await settle(page)


async def transition(page, source, target):
    trigger = page.locator(CLIP + f' button[data-state="{source}"]')
    # Finish scrolling before opening the menu: scroll events dismiss menus.
    await trigger.scroll_into_view_if_needed()
    await settle(page)
    await trigger.click()
    await page.locator(f'#nl-clip-status-menu button[data-target-state="{target}"]').click()
    await finished(page)


async def test_filters(browser):
    page, server, errors = await setup(browser)
    assert await page.locator('#onlyTodo').count() == 0
    for flags in itertools.product([False, True], repeat=3):
        wanted = [s for s, checked in zip(STATES, flags) if checked]
        await select_states(page, wanted)
        actual = await page.evaluate('Array.from(S.lseq)')
        expected = [g for g in range(600) if g != 247 and STATES[g % 3] in wanted]
        assert actual == expected, (wanted, len(actual), len(expected))
        rows = await page.locator('#labList li[data-g]').evaluate_all('els=>els.map(el=>Number(el.dataset.g))')
        assert rows == expected
        if not wanted:
            assert 'No frames match' in await page.locator('#labList').inner_text()
            assert await page.evaluate('playNext(S.shownG,1)===S.shownG')
        elif expected:
            assert await page.evaluate('S.lseq.includes(S.shownG)')
    await select_states(page, ['wip'])
    await page.locator('.nl-search').fill('Phone call')
    await settle(page)
    await page.evaluate('show(226)')
    await page.locator('.nl-search').blur()
    await page.keyboard.press('d')
    assert await page.evaluate('S.shownG') == 229
    assert await page.evaluate('playNext(229,1)') == 232
    assert await page.evaluate('playNext(298,1)') == 298
    await page.evaluate("S.fstat[rvKey(229)].body={s:'done'};fsRender()")
    assert await page.locator('li[data-g="229"]').count() == 0
    await page.evaluate("S.fstat[rvKey(229)].body={s:'wip'};fsRender()")
    assert await page.locator('li[data-g="229"]').count() == 1
    assert not server.posts, 'Visibility controls must not save status'
    await page.reload()
    await page.add_script_tag(content=SCRIPT)
    await page.wait_for_selector('#nl-status-filters')
    assert await page.locator(FILTER.format('wip')).is_checked()
    assert not await page.locator(FILTER.format('done')).is_checked()
    assert not await page.locator(FILTER.format('todo')).is_checked()
    assert await page.evaluate('Array.from(S.lseq).every(g=>fsGet(g)==="wip")')
    await page.evaluate("S.mode='review2';buildSeq()")
    assert await page.evaluate('S.lseq.length') == 600, 'Do not apply labeling filters in Review'
    assert not errors, errors
    await page.close()
    print('PASS: all 8 filter combinations, empty state, navigation/playback, search, status refresh, persistence and Review isolation')


async def test_filter_scroll_anchor(browser):
    page, server, errors = await setup(browser)
    await page.evaluate("""() => {
      for(let g=0;g<600;g++)S.fstat[rvKey(g)].body={s:g<150?'done':'wip'};
      buildSeq();renderLabList();show(500);
    }""")
    await select_states(page, ['wip', 'todo'])
    await page.evaluate("""() => {
      const pane=document.querySelector('#labPane');
      const part=document.querySelector('.grp[data-part-name="Bottle"]');
      const toolbar=document.querySelector('#nota-labeling-organizer-v1');
      pane.scrollTop += part.getBoundingClientRect().top-pane.getBoundingClientRect().top-toolbar.offsetHeight-12;
    }""")
    await settle(page)
    part = '.grp[data-part-name="Bottle"]'
    assert await page.locator('#nl-status-filters').evaluate("el=>el.getBoundingClientRect().bottom<=document.querySelector('#labPane').getBoundingClientRect().top")
    before = (await page.locator(part).bounding_box())['y']
    await page.locator(FILTER.format('done')).evaluate("""input=>{
      input.checked=true;input.dispatchEvent(new Event('change',{bubbles:true}));
    }""")
    await settle(page)
    after = (await page.locator(part).bounding_box())['y']
    assert abs(after - before) <= 1, f'Visible part jumped after showing Done: {before} -> {after}'
    assert await page.evaluate('S.shownG') == 500
    await page.locator(FILTER.format('done')).evaluate("""input=>{
      input.checked=false;input.dispatchEvent(new Event('change',{bubbles:true}));
    }""")
    await settle(page)
    restored = (await page.locator(part).bounding_box())['y']
    assert abs(restored - before) <= 1, f'Visible part jumped after hiding Done: {before} -> {restored}'
    # DMS may keep showing a Done image even while its sidebar row is hidden.
    # Showing Done again must retain the browsed part instead of jumping to it.
    await page.evaluate("""() => {
      S.g=S.shownG=50;
      document.querySelectorAll('#labList li.cur').forEach(item=>item.classList.remove('cur'));
    }""")
    before_hidden_current = (await page.locator(part).bounding_box())['y']
    await page.locator(FILTER.format('done')).evaluate("""input=>{
      input.checked=true;input.dispatchEvent(new Event('change',{bubbles:true}));
    }""")
    await settle(page)
    after_hidden_current = (await page.locator(part).bounding_box())['y']
    assert abs(after_hidden_current - before_hidden_current) <= 1, (
        f'Showing the hidden current frame moved the browsed part: '
        f'{before_hidden_current} -> {after_hidden_current}')
    assert await page.evaluate('S.shownG') == 50
    assert not server.posts
    assert not errors, errors
    await page.close()
    print('PASS: status filters preserve the visible part while groups are inserted/removed or the hidden current frame reappears')


async def test_transitions(browser):
    page, server, errors = await setup(browser)
    for source, target in itertools.permutations(STATES, 2):
        await page.evaluate('seed();buildSeq();renderLabList();show(228)')
        await settle(page)
        before = await page.evaluate('JSON.stringify(S.ledits)')
        server.posts.clear()
        trigger = page.locator(CLIP + f' button[data-state="{source}"]')
        await trigger.hover()
        assert await page.locator('#nl-clip-status-menu button').count() == 2
        assert await page.locator(f'#nl-clip-status-menu button[data-target-state="{source}"]').count() == 0
        assert not server.posts, 'Hover only opens the menu'
        await transition(page, source, target)
        expected = [g for g in range(200, 250) if g != 247 and STATES[g % 3] == source]
        assert sorted(p['i'] for p in server.posts) == expected
        assert all(p['state'] == target and p['label'] == 'body' for p in server.posts)
        statuses = await page.evaluate('Array.from({length:600},(_,g)=>fsGet(g))')
        assert statuses == [target if g in expected else STATES[g % 3] for g in range(600)]
        assert await page.evaluate('Array.from({length:600},(_,g)=>fsGet(g,"eye")).every(s=>s==="done")')
        assert await page.evaluate('JSON.stringify(S.ledits)') == before
        assert await page.locator(CLIP + f' button[data-state="{source}"]').is_disabled()
    # Complete clip: Done is an enabled source; other states have no targets.
    await page.evaluate("for(let g=200;g<250;g++)S.fstat[rvKey(g)].body={s:'done'};fsRender()")
    assert await page.locator(CLIP + ' button[data-state="done"]').is_enabled()
    assert await page.locator(CLIP + ' button[data-state="todo"]').is_disabled()
    await page.locator(CLIP + ' button[data-state="done"]').focus()
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Escape')
    assert await page.locator('#nl-clip-status-menu').count() == 0
    assert await page.locator(CLIP + ' button[data-state="done"]').evaluate('el=>el===document.activeElement')
    await page.keyboard.press('Space')
    assert await page.locator('#nl-clip-status-menu').count() == 1
    assert await page.evaluate('window.spaceEvents') == 0
    await page.keyboard.press('Escape')
    assert server.peak <= 4
    assert not errors, errors
    await page.close()
    print('PASS: all 6 source-only transitions, full-clip source availability, no annotation/other-label changes, hover and keyboard menus')


async def test_hidden_failure_and_scope(browser):
    page, server, errors = await setup(browser)
    await select_states(page, ['wip', 'todo'])
    await page.evaluate('show(229)')
    server.fail = {204}
    await transition(page, 'done', 'wip')
    assert await page.evaluate('fsGet(204)') == 'done'
    assert 'stopped on error' in await page.evaluate('window.lastMessage')
    successful = {p['i'] for p in server.posts if p['i'] != 204}
    server.fail.clear()
    server.posts.clear()
    await transition(page, 'done', 'wip')
    expected = {g for g in range(200, 250) if g % 3 == 0} - successful
    assert {p['i'] for p in server.posts} == expected
    assert await page.evaluate('fsGet(198)') == 'done'
    assert await page.evaluate('fsGet(252)') == 'done'
    assert not errors, errors
    await page.close()
    for change in ('S.gen++;S.sess={...S.sess};S.fstat={}', "S.labelSel='eye'", "S.mode='review'"):
        page, server, errors = await setup(browser)
        server.gate.clear()
        await page.locator(CLIP + ' button[data-state="todo"]').click()
        await page.locator('#nl-clip-status-menu button[data-target-state="done"]').click()
        await page.wait_for_function('document.querySelector(".nl-clip-status-actions[aria-busy=true]")')
        await asyncio.sleep(.08)
        assert len(server.posts) == 4
        await page.evaluate(change)
        server.gate.set()
        await asyncio.sleep(.2)
        assert len(server.posts) == 4
        if 'S.gen++' in change:
            assert await page.evaluate('Object.keys(S.fstat).length') == 0
        assert not errors, errors
        await page.close()
    print('PASS: hidden source frames, partial failure/retry, 4-request limit and stopping on session/label/mode changes')


async def test_filtered_part_and_menu_lifecycle(browser):
    page, server, errors = await setup(browser)
    await select_states(page, ['wip', 'todo'])
    part = '.grp[data-part-name="Phone call"]'
    await page.evaluate('show(229)')
    assert await page.locator(part + ' .nl-part-total').inner_text() == '149 frames'
    await page.locator(part + ' .nl-part-done').scroll_into_view_if_needed()
    await settle(page)
    await click_without_scrolling(page, part + ' .nl-part-done')
    await page.wait_for_function("!document.querySelector('.nl-part-tools[aria-busy=true]')")
    assert await page.locator(part).count() == 0
    assert all(p['i'] != 247 and 150 <= p['i'] < 300 for p in server.posts)
    await select_states(page, ['done'])
    await page.evaluate('show(228)')
    assert await page.locator(part + ' .nl-part-done').is_checked()
    await page.locator(part + ' .nl-part-done').scroll_into_view_if_needed()
    await settle(page)
    await click_without_scrolling(page, part + ' .nl-part-done')
    await page.wait_for_function("!document.querySelector('.nl-part-tools[aria-busy=true]')")
    assert await page.locator(part).count() == 0
    assert await page.evaluate('Array.from({length:150},(_,i)=>i+150).filter(g=>g!==247).every(g=>fsGet(g)==="wip")')
    await select_states(page, STATES)
    await page.evaluate('seed();buildSeq();renderLabList();show(228)')
    server.posts.clear()
    await page.locator(CLIP + ' button[data-state="todo"]').click()
    # A menu detached by a native rebuild must not save into the replacement list.
    await page.evaluate("window.staleOption=document.querySelector('#nl-clip-status-menu button');renderLabList();window.staleOption.click()")
    assert await page.locator('#nl-clip-status-menu').count() == 0
    assert not server.posts
    await page.locator(CLIP + ' button[data-state="done"]').hover()
    await page.evaluate("document.querySelector('#labPane').scrollTop+=20")
    await settle(page)
    assert await page.locator('#nl-clip-status-menu').count() == 0
    await page.locator(CLIP + ' button[data-state="done"]').hover()
    await page.locator('#view').click()
    assert await page.locator('#nl-clip-status-menu').count() == 0
    assert not server.posts
    assert not errors, errors
    await page.close()
    print('PASS: Done all across hidden statuses, reopening filtered parts, detached menu guards, scroll/outside dismissal')


async def main():
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        try:
            await test_filters(browser)
            await test_filter_scroll_anchor(browser)
            await test_transitions(browser)
            await test_hidden_failure_and_scope(browser)
            await test_filtered_part_and_menu_lifecycle(browser)
        finally:
            await browser.close()


if __name__ == '__main__':
    asyncio.run(main())
