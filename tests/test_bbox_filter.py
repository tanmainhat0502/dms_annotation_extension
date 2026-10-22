"""BBox-count filter: lazy count loading, navigation, edits, and auto_load_img.

Run: python tests/test_bbox_filter.py
All DMS responses are local fixtures; no live annotation data is changed.
"""
import asyncio
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from playwright.async_api import async_playwright

from test_preload import HTML as CACHE_HTML
from test_sidebar_scroll import HTML as SIDEBAR_HTML

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = (ROOT / "extension/content.js").read_text(encoding="utf-8")
PRELOAD = (ROOT / "extension/preload.js").read_text(encoding="utf-8")
PNG = (ROOT / "extension/icons/icon16.png").read_bytes()
SEGMENT = 100
NO_AUTO_LABEL_SEGMENT = 5
# Native frame cache contract (fkey/getFrame) used by the preloader test.
CACHE = CACHE_HTML[CACHE_HTML.index("function fkey(g)"):CACHE_HTML.index("async function show(g)")]
EXTRA = """
const SEG=%d, NO_AL=%d;
S.sess.segments=Array.from({length:Math.ceil(S.G/SEG)},(_,i)=>({name:'s'+i,n:SEG,al:i!==NO_AL}));
S.al=new Map();
function loc(g){return [Math.floor(g/SEG),g%%SEG];}
function alBoxes(frame,label){return frame[label]||[];}
// Like the native loader: one request per segment, a failed read caches null.
function ensureAL(si){
  if(S.al.has(si))return S.al.get(si);
  if(!S.sess.segments[si].al){S.al.set(si,null);return null;}
  const pending=fetch('/api/al?si='+si).then(r=>r.ok?r.json():null).catch(()=>null)
    .then(data=>{S.al.set(si,data);});
  S.al.set(si,pending);return pending;
}
function edSave(){(S.ledits[ED.key]??={})[ED.lab]=JSON.parse(JSON.stringify(ED.items));}
function playNext(g,step=1){return Math.min(S.G-1,g+step);}
function show(g){S.g=S.shownG=g;ED.key=rvKey(g);ED.lab=S.labelSel;rvMarkLab();}
""" % (SEGMENT, NO_AUTO_LABEL_SEGMENT)


def fixture(count):
    group = count // 4
    html = SIDEBAR_HTML.replace("G:600", f"G:{count}").replace("n:600", f"n:{count}")
    html = html.replace("g/150", f"g/{group}").replace("g%150", f"g%{group}")
    return html.replace("</body>", f"<script>{EXTRA}\n{CACHE}</script></body>")


def box_count(g):
    """Auto-label boxes per frame; the segment without auto-labels has none."""
    return 0 if g // SEGMENT == NO_AUTO_LABEL_SEGMENT else g % 4


class Server:
    def __init__(self, count):
        self.html = fixture(count)
        self.al_calls = []
        self.images = []
        self.active = 0
        self.peak = 0
        self.fail = set()
        self.hold = asyncio.Event()
        self.hold.set()

    async def route(self, route):
        url = urlparse(route.request.url)
        args = parse_qs(url.query)
        if url.path == "/":
            await route.fulfill(body=self.html, content_type="text/html")
        elif url.path == "/api/al":
            segment = int(args["si"][0])
            self.al_calls.append(segment)
            self.active += 1
            self.peak = max(self.peak, self.active)
            try:
                await self.hold.wait()
                await asyncio.sleep(0.02)
                if segment in self.fail:
                    await route.fulfill(status=503, body="{}", content_type="application/json")
                    return
                frames = {str(i): {"body": [{"box": [k, k, k + 5, k + 5]} for k in range(box_count(segment * SEGMENT + i))]}
                          for i in range(SEGMENT)}
                await route.fulfill(json={"frames": frames})
            finally:
                self.active -= 1
        elif url.path == "/api/frame":
            self.images.append((args["seg"][0], int(args["i"][0])))
            await route.fulfill(body=PNG, content_type="image/png")
        else:
            raise AssertionError(f"Unexpected request: {route.request.method} {url.path}")


async def open_page(browser, count=600, current=250, preload=False):
    page = await browser.new_page(viewport={"width": 1200, "height": 820})
    server = Server(count)
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    await page.route("**/*", server.route)
    await page.goto("https://ntt.dev.nota.ai/")
    await page.evaluate("localStorage.clear()")
    await page.evaluate(f"show({current})")
    await page.add_script_tag(content=SCRIPT)
    if preload:
        await page.add_script_tag(content=PRELOAD)
    await page.wait_for_selector(".nl-organized")
    return page, server, errors


async def counts_ready(page):
    await page.wait_for_function("""() => {
      const text=document.querySelector('.nl-bbox-status').textContent;
      return /frames/.test(text) && !text.includes('loading');
    }""")
    await page.wait_for_timeout(260)  # Let the throttled refresh after the last load run.


async def visible_frames(page):
    return await page.evaluate("""() => [...document.querySelectorAll('#labList > .grp:not([hidden]) li[data-g]')]
      .filter(li => !li.hidden && !li.closest('.nl-clip').hidden).map(li => Number(li.dataset.g))""")


async def set_counts(page, value):
    await page.fill("#nl-bbox-counts", value)


async def test_filter_and_loading(browser):
    page, server, errors = await open_page(browser)
    assert await visible_frames(page) == list(range(600)), "No BBox filter: every frame visible"
    assert not server.al_calls, "Counts load only when a BBox filter is set"

    await set_counts(page, "0, 2")
    await counts_ready(page)
    expected = [g for g in range(600) if box_count(g) in (0, 2)]
    assert await visible_frames(page) == expected
    status = await page.locator(".nl-bbox-status").inner_text()
    assert status == f"{len(expected)}/600 frames", status
    # One request per auto-labeled segment, the current frame's first, at most 2 at once.
    assert server.al_calls[0] == 2, server.al_calls
    assert sorted(server.al_calls) == [0, 1, 2, 3, 4], server.al_calls
    assert server.peak <= 2, server.peak
    assert await page.evaluate("localStorage.getItem('nota-labeling-organizer-bbox-filter-v2')") == "[0,2]"

    # Changing counts reuses cached auto-label counts: no new requests.
    await set_counts(page, "3")
    await page.wait_for_timeout(100)
    assert await visible_frames(page) == [g for g in range(600) if box_count(g) == 3]
    assert len(server.al_calls) == 5

    await page.fill("#nl-bbox-counts", "2,x")
    assert await page.get_attribute("#nl-bbox-counts", "aria-invalid") == "true"
    assert await visible_frames(page) == [g for g in range(600) if box_count(g) == 3], "Invalid input keeps the last filter"
    await page.locator("#nl-bbox-counts").blur()
    assert await page.input_value("#nl-bbox-counts") == "3"

    await page.click(".nl-bbox-all")
    assert await visible_frames(page) == list(range(600))
    assert await page.evaluate("document.querySelectorAll('#labList li[hidden], #labList .nl-clip[hidden]').length") == 0
    assert not errors, errors
    await page.close()
    print("PASS: exact-count filter, current-segment-first loading, <=2 concurrent, cached counts, invalid input, All")


async def test_part_search_limits_loading(browser):
    page, server, errors = await open_page(browser)
    await page.fill(".nl-search", "Bottle")  # Frames 300-449: segments 3 and 4.
    await set_counts(page, "1")
    await counts_ready(page)
    assert sorted(server.al_calls) == [3, 4], server.al_calls
    assert await visible_frames(page) == [g for g in range(300, 450) if box_count(g) == 1]
    assert await page.locator(".nl-status").inner_text() == "1/4 part"

    server.fail.add(1)
    await page.fill(".nl-search", "")
    await counts_ready(page)
    # Segment 1 could not be read: its frames stay visible as unknown, without retries.
    visible = await visible_frames(page)
    assert all(g in visible for g in range(100, 200))
    assert "100 unknown" in await page.locator(".nl-bbox-status").inner_text()
    await page.evaluate("renderLabList()")
    await page.wait_for_timeout(300)
    assert server.al_calls.count(1) == 1, server.al_calls
    assert not errors, errors
    await page.close()
    print("PASS: part search limits count requests; unreadable segments stay visible once, without retry")


async def test_navigation_and_edits(browser):
    page, server, errors = await open_page(browser, current=1)
    await set_counts(page, "1")
    await counts_ready(page)
    await page.locator("#nl-bbox-counts").blur()
    await page.keyboard.press("d")
    assert await page.evaluate("S.shownG") == 5
    await page.keyboard.press("Shift+d")
    assert await page.evaluate("S.shownG") == 45
    await page.keyboard.press("a")
    assert await page.evaluate("S.shownG") == 41
    assert await page.evaluate("playNext(5,1)") == 9
    assert await page.evaluate("playNext(5,3)") == 17
    assert await page.evaluate("playNext(497,1)") == 497, "Last matching frame ends playback"

    # Editing the current frame to 2 boxes hides it after the throttled refresh.
    await page.evaluate("show(9);ED.items=[{box:[0,0,5,5]},{box:[9,9,20,20]}];edSave()")
    await page.wait_for_function("document.querySelector('#labList li[data-g=\"9\"]').hidden")
    # A hidden current frame resumes at its nearest visible neighbor.
    assert await page.evaluate("playNext(9,1)") == 13
    await page.keyboard.press("a")
    assert await page.evaluate("S.shownG") == 5
    await page.evaluate("show(9)")
    await page.keyboard.press("d")
    assert await page.evaluate("S.shownG") == 13
    # An explicit empty edit counts as 0 boxes and wins over auto-labels.
    await set_counts(page, "0")
    await page.evaluate("S.ledits[rvKey(1)]={body:[]};edSave()")
    await page.wait_for_function("!document.querySelector('#labList li[data-g=\"1\"]').hidden")
    assert len(server.al_calls) == 5
    # Non-bbox labels disable the filter without losing the saved value.
    await page.evaluate("S.labelSel='seatbelt';S.gen++;renderLabList()")
    await page.wait_for_timeout(100)
    assert await page.locator("#nl-bbox-counts").is_disabled()
    assert await visible_frames(page) == list(range(600))
    assert await page.input_value("#nl-bbox-counts") == "0"
    assert not errors, errors
    await page.close()
    print("PASS: A/D, Shift+D and Space follow the filter; edits refresh counts; hidden current resumes; label scope")


async def test_auto_load_with_filter(browser):
    page, server, errors = await open_page(browser, current=0, preload=True)
    server.hold.clear()
    await set_counts(page, "2")
    await page.click("#start_auto_load")
    await page.wait_for_function("document.querySelector('.nl-load-count').textContent.includes('awaiting BBox counts')")
    await page.wait_for_timeout(200)
    assert not server.images, "Frames with unknown counts are not downloaded yet"

    server.hold.set()
    await page.wait_for_function("document.querySelector('.nl-load-count').textContent === 'Ready 75 / 75 images'")
    wanted = {g for g in range(300) if box_count(g) == 2}  # Current part + next part.
    downloaded = {int(seg[1:]) * SEGMENT + i for seg, i in server.images}
    assert downloaded == wanted and len(server.images) == len(wanted), sorted(downloaded ^ wanted)

    await set_counts(page, "2,3")
    await page.wait_for_function("document.querySelector('.nl-load-count').textContent === 'Ready 150 / 150 images'")
    assert len(server.images) == 150, "Already downloaded frames are not requested again"

    # Done on every matching frame of part 1 advances the window to parts 2 + 3.
    await page.evaluate("""() => {
      for (let g=0; g<150; g++) if ([2,3].includes(g%4)) S.fstat[rvKey(g)]={body:{s:'done'}};
    }""")
    await page.wait_for_function("document.querySelector('.nl-load-parts').textContent === 'Phone call + Bottle'")
    await page.wait_for_function("document.querySelector('.nl-load-count').textContent === 'Ready 150 / 150 images'")
    assert {int(seg[1:]) * SEGMENT + i for seg, i in server.images[150:]} == \
        {g for g in range(300, 450) if box_count(g) in (2, 3)}
    assert not errors, errors
    await page.close()
    print("PASS: auto_load_img downloads only filtered frames, waits for counts, reuses images, advances on filtered Done")


async def test_large_list(browser):
    page, server, errors = await open_page(browser, count=12000, current=6000)
    await set_counts(page, "1")
    await counts_ready(page)
    expected = [si for si in range(120) if si != NO_AUTO_LABEL_SEGMENT]
    assert sorted(server.al_calls) == expected and server.peak <= 2, (sorted(server.al_calls), server.peak)
    assert server.al_calls[0] == 60
    result = await page.evaluate("""() => {
      const times=[];
      for (let i=0; i<10; i++) {
        const start=performance.now();
        document.querySelector('#nl-bbox-counts').dispatchEvent(new Event('input'));
        times.push(performance.now()-start);
      }
      return times.sort((a,b)=>a-b)[5];
    }""")
    visible = await page.evaluate("document.querySelectorAll('#labList li[data-g]:not([hidden])').length")
    assert visible == sum(1 for g in range(12000) if box_count(g) == 1)
    assert await page.evaluate("playNext(6001,1)") == 6005
    assert not errors, errors
    await page.close()
    print(f"PASS: 12,000 frames, 120 segments loaded once (<=2 concurrent); median filter pass {result:.1f} ms")


async def test_preload_outside_search(browser):
    """F1: preloaded parts hidden by part search still get counts, so loading finishes."""
    page, server, errors = await open_page(browser, current=0, preload=True)
    await page.fill(".nl-search", "Other")  # Frames 0-149; the preloaded next part (150-299) is hidden.
    await set_counts(page, "2")
    await page.click("#start_auto_load")
    await page.wait_for_function("document.querySelector('.nl-load-count').textContent === 'Ready 75 / 75 images'",
                                 timeout=5000)
    assert sorted(server.al_calls) == [0, 1, 2], server.al_calls
    assert not errors, errors
    await page.close()
    print("PASS: F1 auto_load_img finishes for a next part hidden by part search")


async def test_hidden_frame_after_last_match(browser):
    """F3: from a hidden frame past the last match, forward steps stay put instead of moving back."""
    page, server, errors = await open_page(browser, current=550)  # Segment 5: 0 boxes, hidden by "1".
    await set_counts(page, "1")
    await counts_ready(page)
    await page.locator("#nl-bbox-counts").blur()
    assert await page.evaluate("playNext(550,1)") == 550
    await page.keyboard.press("d")
    assert await page.evaluate("S.shownG") == 550
    await page.keyboard.press("a")
    assert await page.evaluate("S.shownG") == 497
    assert not errors, errors
    await page.close()
    print("PASS: F3 hidden frame after the last match does not move backward on D/Space")


async def test_auto_load_window_follows_filter(browser):
    """The two-part window skips parts without matching frames and is re-chosen when the filter changes."""
    page, server, errors = await open_page(browser, current=0, preload=True)
    # Every "Phone call" frame (150-299) is edited to 0 boxes.
    await page.evaluate("for (let g=150; g<300; g++) S.ledits[rvKey(g)]={body:[]}")
    await set_counts(page, "1")
    await counts_ready(page)
    await page.click("#start_auto_load")
    await page.wait_for_function("document.querySelector('.nl-load-parts').textContent === 'Other + Bottle'")
    await page.wait_for_function("document.querySelector('.nl-load-count').textContent === 'Ready 76 / 76 images'")

    await set_counts(page, "0,1")
    await page.wait_for_function("document.querySelector('.nl-load-parts').textContent === 'Other + Phone call'",
                                 timeout=5000)
    await page.wait_for_function("document.querySelector('.nl-load-count').textContent === 'Ready 226 / 226 images'")
    part_one = {int(seg[1:]) * SEGMENT + i for seg, i in server.images if 150 <= int(seg[1:]) * SEGMENT + i < 300}
    assert part_one == set(range(150, 300)), len(part_one)
    assert not errors, errors
    await page.close()
    print("PASS: auto_load_img window skips parts without matches and follows filter changes")


async def main():
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        try:
            await test_auto_load_window_follows_filter(browser)
            await test_preload_outside_search(browser)
            await test_hidden_frame_after_last_match(browser)
            await test_filter_and_loading(browser)
            await test_part_search_limits_loading(browser)
            await test_navigation_and_edits(browser)
            await test_auto_load_with_filter(browser)
            await test_large_list(browser)
        finally:
            await browser.close()


if __name__ == "__main__":
    asyncio.run(main())
