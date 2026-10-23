"""Incremental sidebar status repaint, V markers, and seatbelt bulk copy.

Run: python tests/test_sidebar_status.py
All DMS responses are local fixtures; no live annotation data is changed.
"""
import asyncio
from urllib.parse import urlparse

from playwright.async_api import async_playwright

from test_bbox_filter import SCRIPT, fixture

# Counts DOM queries made by one patched fsRender() after a single status change.
COUNT_QUERIES = """(g) => {
  S.fstat[rvKey(g)] = {[S.labelSel]: {s: 'done'}};
  const proto = Element.prototype, one = proto.querySelector, all = proto.querySelectorAll;
  let calls = 0;
  proto.querySelector = function (...args) { calls += 1; return one.apply(this, args); };
  proto.querySelectorAll = function (...args) { calls += 1; return all.apply(this, args); };
  const start = performance.now();
  try { fsRender(); } finally { proto.querySelector = one; proto.querySelectorAll = all; }
  return {calls, ms: performance.now() - start};
}"""
ROW = "#labList li[data-g='{}']"


class Server:
    def __init__(self, count):
        self.html = fixture(count)
        self.label_edits = []
        self.statuses = []

    async def route(self, route):
        path = urlparse(route.request.url).path
        if path == "/":
            await route.fulfill(body=self.html, content_type="text/html")
        elif path == "/api/label_edit":
            self.label_edits.append(route.request.post_data_json)
            await route.fulfill(json={})
        elif path == "/api/frame_status":
            self.statuses.append(route.request.post_data_json)
            await route.fulfill(json={})
        else:
            raise AssertionError(f"Unexpected request: {route.request.method} {path}")


async def open_page(browser, count, current):
    page = await browser.new_page(viewport={"width": 1200, "height": 820})
    server = Server(count)
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    await page.route("**/*", server.route)
    await page.goto("https://ntt.dev.nota.ai/")
    await page.evaluate("localStorage.clear()")
    await page.evaluate(f"show({current})")
    await page.add_script_tag(content=SCRIPT)
    await page.wait_for_selector(".nl-organized")
    return page, server, errors


async def clip_meta(page, g):
    return await page.evaluate(
        f"document.querySelector(\"{ROW.format(g)}\").closest('.nl-clip').querySelector('.nl-clip-meta').textContent")


async def test_status_repaint_is_incremental(browser):
    page, _, errors = await open_page(browser, 12000, 6000)
    # Grouping shortens the list after show(); bring the current row back into view so the
    # measurement covers the repaint, not the off-screen sidebar-anchor scan.
    await page.evaluate("document.querySelector('#labList li.cur').scrollIntoView({block: 'center'})")
    await page.evaluate("fsRender()")  # Warm-up: the first patched render fills the row cache.

    result = await page.evaluate(COUNT_QUERIES, 6010)
    # A full repaint queries every one of the 12,000 rows at least twice.
    assert result["calls"] < 400, result
    assert await page.get_attribute(f"{ROW.format(6010)} > .fs", "class") == "fs done"
    assert "1 xong" in await clip_meta(page, 6010)
    assert await page.locator(f"{ROW.format(6010)} > .nl-checkpoint").count() == 1
    assert await page.evaluate(
        f"document.querySelector(\"{ROW.format(6010)}\").closest('.grp').querySelector('.nl-part-done').indeterminate")
    assert "xong" not in await clip_meta(page, 6100), "Other clips keep their summary"

    await page.evaluate("S.ledits[rvKey(6011)] = {body: []}; fsRender()")
    assert (await page.inner_text(f"{ROW.format(6011)} .tm")).endswith("✎")
    await page.evaluate("delete S.ledits[rvKey(6011)]; fsRender()")
    assert not (await page.inner_text(f"{ROW.format(6011)} .tm")).endswith("✎")

    # Rows rebuilt by the native renderer are cache misses and still update.
    await page.evaluate("renderLabList()")
    await page.evaluate("S.fstat[rvKey(6120)] = {body: {s: 'wip'}}; fsRender()")
    assert await page.get_attribute(f"{ROW.format(6120)} > .fs", "class") == "fs wip"
    assert "1 in progress" in await clip_meta(page, 6120)
    assert await page.get_attribute(f"{ROW.format(6010)} > .fs", "class") == "fs done"
    assert not errors, errors
    await page.close()
    print(f"PASS: one status change at 12k frames: {result['calls']} DOM queries, {result['ms']:.1f} ms")


async def marked_frames(page):
    return await page.evaluate("""() => [...document.querySelectorAll('#labList .nl-frame-mark')]
      .map(marker => [Number(marker.closest('li').dataset.g), marker.textContent,
                      marker.closest('li').classList.contains('nl-marked-frame')])""")


async def test_frame_markers(browser):
    page, _, errors = await open_page(browser, 600, 100)
    await page.keyboard.press("v")
    await page.evaluate("show(101)")
    await page.keyboard.press("v")
    assert await marked_frames(page) == [[100, "◆ V", True], [101, "◆ V", True]]

    await page.evaluate("renderLabList()")
    assert await marked_frames(page) == [[100, "◆ V", True], [101, "◆ V", True]], "Markers follow rebuilt rows"
    await page.keyboard.press("v")
    assert await marked_frames(page) == [[100, "◆ V", True]]
    assert await page.locator("#labList li.nl-marked-frame").count() == 1

    # Switching to a non-bbox label swaps marker sets; marks survive status changes and reset on label change.
    await page.evaluate("S.labelSel = 'seatbelt'; S.fstat[rvKey(105)] = {seatbelt: {s: 'done'}}; show(105); renderLabList()")
    assert await marked_frames(page) == []
    await page.keyboard.press("v")
    assert await marked_frames(page) == [[105, "✓ V", True]]
    await page.evaluate("S.fstat[rvKey(105)] = {seatbelt: {s: 'wip'}}; fsRender()")
    assert await marked_frames(page) == [[105, "✓ V", True]]
    await page.evaluate("S.labelSel = 'hand'; renderLabList()")
    assert await marked_frames(page) == []
    assert await page.locator("#labList li.nl-marked-frame").count() == 0
    assert not errors, errors
    await page.close()
    print("PASS: V markers add/remove per frame, survive native rebuilds, and reset on mode change")


async def test_seatbelt_bulk_skips_unchanged(browser):
    page, server, errors = await open_page(browser, 600, 10)
    await page.evaluate("""() => {
      S.labelSel = 'seatbelt';
      S.sess.src_w = 4; S.sess.src_h = 2; S.ts = [];
      const mask = counts => ({seatbelt: [{rle: {size: [2, 4], counts}}]});
      S.ledits[rvKey(10)] = mask([2, 2, 4]);
      S.ledits[rvKey(11)] = mask([2, 2, 4]);  // Already contains the source mask.
      S.ledits[rvKey(12)] = mask([8]);
      show(10);
    }""")
    await page.keyboard.press("Control+b")
    await page.wait_for_selector("#nl-seatbelt-bulk[open]")
    await page.fill("#nl-seatbelt-bulk .nl-count", "2")
    await page.click("#nl-seatbelt-bulk .nl-apply")
    await page.wait_for_selector("#nl-seatbelt-bulk", state="hidden")

    assert [edit["i"] for edit in server.label_edits] == [12], server.label_edits
    assert server.label_edits[0]["items"][0]["rle"]["counts"] == [2, 2, 4]
    assert [(status["i"], status["state"]) for status in server.statuses] == [(12, "wip")], server.statuses
    assert await page.evaluate("fsGet(11)") == "todo", "Unchanged frames keep their status"
    assert not errors, errors
    await page.close()
    print("PASS: seatbelt bulk copy saves only frames whose mask changes")


async def main():
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        try:
            await test_status_repaint_is_incremental(browser)
            await test_frame_markers(browser)
            await test_seatbelt_bulk_skips_unchanged(browser)
        finally:
            await browser.close()


if __name__ == "__main__":
    asyncio.run(main())
