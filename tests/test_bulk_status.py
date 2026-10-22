"""Ctrl+B tabs, remembered selection and status-only writes through local DMS fixtures."""
import asyncio
from pathlib import Path

from playwright.async_api import async_playwright

from test_status_controls import setup, select_states, settle, SCRIPT

ROOT = Path(__file__).resolve().parents[1]
DIALOG = 'dialog.nl-bulk-dialog[open]'


async def open_bulk(page, tab=None):
    await page.evaluate('document.activeElement?.blur()')
    await page.keyboard.press('Control+b')
    await page.wait_for_selector(DIALOG)
    if tab:
        await page.locator(DIALOG + f' [data-bulk-tab="{tab}"]').click()


async def choose_status(page, value, direction='after', count='1'):
    await page.locator(DIALOG + f' [data-status-direction="{direction}"]').click()
    await page.locator(DIALOG + f' .nl-status-panel input[value="{value}"]').check()
    if direction != 'marked':
        await page.locator(DIALOG + ' .nl-status-count').fill(count)


async def apply(page):
    await page.locator(DIALOG + ' .nl-status-apply').click()
    await page.wait_for_selector(DIALOG, state='hidden')
    await settle(page)


async def mark(page, frames):
    for g in frames:
        await page.evaluate('g=>show(g)', g)
        await page.evaluate('document.activeElement?.blur()')
        await page.keyboard.press('v')
    await settle(page)


async def test_tabs(browser):
    page, server, errors = await setup(browser)
    await open_bulk(page)
    assert await page.locator(DIALOG + ' [data-bulk-tab="label"]').get_attribute('aria-selected') == 'true'
    await page.locator(DIALOG + ' [data-bulk-tab="status"]').click()
    assert await page.locator(DIALOG + ' .nl-status-panel').is_visible()
    assert not await page.locator(DIALOG + ' .nl-label-panel').is_visible()
    await page.keyboard.press('Escape')
    await open_bulk(page)
    assert await page.locator(DIALOG + ' .nl-status-panel').is_visible()
    await page.reload()
    await page.add_script_tag(content=SCRIPT)
    await page.wait_for_selector('#nl-status-filters')
    await page.evaluate('show(228)')
    await open_bulk(page)
    assert await page.locator(DIALOG + ' .nl-status-panel').is_visible()
    await page.locator(DIALOG + ' [data-bulk-tab="label"]').click()
    await page.keyboard.press('Escape')
    await open_bulk(page)
    assert await page.locator(DIALOG + ' .nl-label-panel').is_visible()
    await page.keyboard.press('Escape')
    # No annotations must not prevent opening status controls, on any label.
    for label in ('nose', 'eye_lmk', 'face_lmk', 'seatbelt', 'hand'):
        await page.evaluate("""label=>{
          S.labelSel=label;S.ledits={};
          for(const item of Object.values(S.review))item.labels=[label];
          buildSeq();renderLabList();show(228);
        }""", label)
        await settle(page)
        await open_bulk(page, 'label')
        await page.locator(DIALOG + ' [data-bulk-tab="status"]').click()
        await choose_status(page, 'done')
        assert await page.locator(DIALOG + ' .nl-status-apply').is_enabled()
        await page.keyboard.press('Escape')
    assert not server.posts
    assert not errors, errors
    await page.close()
    print('PASS: two tabs; both remembered across reopening/reload; status available with empty annotations across bbox/landmark/seatbelt labels')


async def test_ranges(browser):
    page, server, errors = await setup(browser)
    for source, direction, count, value, candidates in [
        (225, 'after', '4', 'todo', list(range(225, 229))),
        (240, 'after', '200', 'wip', [g for g in range(240, 250) if g != 247]),
        (245, 'after', 'end', 'done', [245, 246, 248, 249]),
        (205, 'before', '200', 'todo', list(range(200, 206))),
        (204, 'before', 'end', 'wip', list(range(200, 205))),
    ]:
        await page.evaluate('g=>{seed();buildSeq();renderLabList();show(g);}', source)
        await settle(page)
        before = await page.evaluate('JSON.stringify(S.ledits)')
        states = await page.evaluate('Array.from({length:600},(_,g)=>fsGet(g))')
        await open_bulk(page, 'status')
        await choose_status(page, value, direction, count)
        server.posts.clear()
        await apply(page)
        expected = [g for g in candidates if states[g] != value]
        assert sorted(p['i'] for p in server.posts) == sorted(expected)
        assert all(p['label'] == 'body' and p['state'] == value for p in server.posts)
        assert await page.evaluate('JSON.stringify(S.ledits)') == before
        assert await page.evaluate('Array.from({length:600},(_,g)=>fsGet(g))') == [value if g in expected else s for g, s in enumerate(states)]
        assert await page.evaluate('Array.from({length:600},(_,g)=>fsGet(g,"eye")).every(s=>s==="done")')
    await open_bulk(page)
    for bad in ('', '0', '-1', '1.5', 'abc'):
        await choose_status(page, 'done', 'after', bad)
        assert await page.locator(DIALOG + ' .nl-status-apply').is_disabled()
    await page.keyboard.press('Escape')
    # A visible unfinished-only range still includes hidden Done targets.
    await page.evaluate('seed();buildSeq();renderLabList();show(241)')
    await select_states(page, ['wip', 'todo'])
    await page.evaluate('show(241)')
    await open_bulk(page, 'status')
    await choose_status(page, 'wip', 'after', 'end')
    server.posts.clear()
    await apply(page)
    assert {p['i'] for p in server.posts} == {242, 243, 245, 246, 248, 249}
    assert server.peak <= 4
    assert not errors, errors
    await page.close()
    print('PASS: 3 destination statuses, numeric/end bounds in both directions, source included in the count, hidden Done included, no annotation writes or duplicate saves')


async def test_marks(browser):
    for label in ('body', 'nose', 'seatbelt', 'eye_lmk'):
        page, server, errors = await setup(browser)
        await page.evaluate("""label=>{
          S.labelSel=label;
          for(const item of Object.values(S.review))item.labels=[label];
          for(let g=0;g<600;g++)S.fstat[rvKey(g)][label]={s:['done','wip','todo'][g%3]};
          buildSeq();renderLabList();show(228);
        }""", label)
        await settle(page)
        await mark(page, [201, 202, 350])
        assert await page.locator('#nl-marked-frames').get_attribute('data-count') == '3'
        await select_states(page, ['wip', 'todo'])
        await page.evaluate('show(350)')
        if label == 'body':
            await select_states(page, [])
        await open_bulk(page, 'status')
        await choose_status(page, 'todo', 'marked')
        assert await page.locator(DIALOG + ' .nl-status-count').is_disabled()
        await apply(page)
        assert sorted(p['i'] for p in server.posts) == [201, 202]
        assert await page.locator('#nl-marked-frames').get_attribute('data-count') == '3'
        server.posts.clear()
        # Include the current frame when it is explicitly marked, even across clips.
        await open_bulk(page)
        await choose_status(page, 'done', 'marked')
        await apply(page)
        assert sorted(p['i'] for p in server.posts) == [201, 202, 350]
        assert all(p['label'] == label for p in server.posts)
        # Marked selections survive a destination status change and hidden rows.
        await open_bulk(page)
        await choose_status(page, 'wip', 'marked')
        await apply(page)
        assert await page.evaluate('fsGet(350)') == 'wip'
        await page.evaluate("S.labelSel='hand';buildSeq();renderLabList()")
        await settle(page)
        assert await page.locator('#nl-marked-frames').get_attribute('data-count') == '0'
        await page.evaluate('label=>{S.labelSel=label;buildSeq();renderLabList();}', label)
        await settle(page)
        assert await page.locator('#nl-marked-frames').get_attribute('data-count') == '0', 'Returning to a label must not restore stale marks'
        assert not errors, errors
        await page.close()
    print('PASS: V marks all statuses and labels, cross-clip and hidden marked targets, current-frame inclusion, reusable marks and label scope reset')


async def test_failure_and_scope(browser):
    page, server, errors = await setup(browser)
    await page.evaluate('show(201)')
    await open_bulk(page, 'status')
    await choose_status(page, 'done', 'after', 'end')
    server.fail = {203}
    await page.locator(DIALOG + ' .nl-status-apply').click()
    await page.wait_for_function("document.querySelector('dialog[open] .nl-status-preview').textContent.includes('Stopped on error')")
    assert await page.evaluate('fsGet(203)') != 'done'
    successful = {p['i'] for p in server.posts if p['i'] != 203}
    server.fail.clear()
    server.posts.clear()
    await apply(page)
    expected = {g for g in range(202, 250) if g != 247 and g % 3 != 0} - successful
    assert {p['i'] for p in server.posts} == expected
    assert not errors, errors
    await page.close()
    for change in ('S.gen++;S.sess={...S.sess};S.fstat={}', "S.labelSel='eye'", "S.mode='review'"):
        page, server, errors = await setup(browser)
        await open_bulk(page, 'status')
        await choose_status(page, 'done', 'after', 'end')
        server.gate.clear()
        await page.locator(DIALOG + ' .nl-status-apply').click()
        await asyncio.sleep(.08)
        assert len(server.posts) == 4
        assert await page.locator(DIALOG + ' [data-bulk-tab="label"]').is_disabled()
        await page.keyboard.press('Escape')
        assert await page.locator(DIALOG).count() == 1
        await page.evaluate(change)
        server.gate.set()
        await page.wait_for_function("document.querySelector('dialog[open] .nl-status-preview').textContent.includes('Stopped on error')")
        assert len(server.posts) == 4
        assert await page.locator(DIALOG + ' .nl-status-apply').is_disabled()
        if 'S.gen++' in change:
            assert await page.evaluate('Object.keys(S.fstat).length') == 0
        assert not errors, errors
        await page.close()
    print('PASS: partial failure/retry, disabled controls during saving, session/label/mode guards and stale-response isolation')


async def test_label_action_isolation(browser):
    for label in ('eye_lmk', 'seatbelt'):
        page, server, errors = await setup(browser)
        label_posts = []

        async def save_label(route):
            label_posts.append(route.request.post_data_json)
            await route.fulfill(body='{}', content_type='application/json')

        await page.route('**/api/label_edit', save_label)
        await page.evaluate("""label=>{
          S.labelSel=label;S.sess.src_w=2;S.sess.src_h=2;S.ts=Array(600).fill(0);
          for(const item of Object.values(S.review))item.labels=[label];
          for(let g=0;g<600;g++){
            S.ledits[rvKey(g)]={[label]:[]};S.fstat[rvKey(g)]={[label]:{s:'wip'}};
          }
          S.ledits[rvKey(228)][label]=label==='eye_lmk'
            ? [{pts:Array.from({length:15},(_,i)=>[i,i+1])}]
            : [{rle:{size:[2,2],counts:[1,2,1]}}];
          buildSeq();renderLabList();show(228);
        }""", label)
        await settle(page)
        await open_bulk(page, 'status')
        await page.locator(DIALOG + ' [data-bulk-tab="label"]').click()
        await page.locator(DIALOG + ' .nl-count').fill('1')
        await page.locator(DIALOG + ' .nl-apply').click()
        await page.wait_for_selector(DIALOG, state='hidden')
        assert len(label_posts) == 1 and label_posts[0]['i'] == 229 and label_posts[0]['label'] == label
        assert not server.posts
        assert await page.evaluate('label=>JSON.stringify(S.ledits[rvKey(228)][label])===JSON.stringify(S.ledits[rvKey(229)][label])', label)
        await open_bulk(page, 'status')
        await choose_status(page, 'done', 'after', '1')
        await page.locator(DIALOG + ' .nl-status-count').focus()
        await page.keyboard.press('Enter')
        await page.wait_for_selector(DIALOG, state='hidden')
        assert len(label_posts) == 1, 'Status Enter must not invoke the label action'
        assert len(server.posts) == 1 and server.posts[0]['i'] == 228 and server.posts[0]['state'] == 'done'
        assert not errors, errors
        await page.close()
    print('PASS: eye/seatbelt label copying survives tab changes; Enter on status saves status only')


async def main():
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        try:
            await test_tabs(browser)
            await test_ranges(browser)
            await test_marks(browser)
            await test_failure_and_scope(browser)
            await test_label_action_isolation(browser)
        finally:
            await browser.close()


if __name__ == '__main__':
    asyncio.run(main())
