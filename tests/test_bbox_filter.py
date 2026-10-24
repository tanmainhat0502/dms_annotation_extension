"""BBox-count filter: lazy count loading, navigation, edits, and auto_load_img.

Run: python tests/test_bbox_filter.py
All DMS responses are local fixtures; no live annotation data is changed.
"""
import asyncio
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from playwright.async_api import async_playwright

from _ext import read_organizer_script
from test_preload import HTML as CACHE_HTML
from test_sidebar_scroll import HTML as SIDEBAR_HTML

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = read_organizer_script()
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
    def __init__(self, count, boxes_fn=None):
        self.html = fixture(count)
        self.boxes_fn = boxes_fn
        self.al_calls = []
        self.images = []
        self.active = 0
        self.peak = 0
        self.fail = set()
        self.posts = []  # Frame status saves: (g, label, state).
        self.label_edits = []  # Label edits: (g, label, items).
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
                if self.boxes_fn is not None:
                    frames = {str(i): {"body": [{"box": b} for b in self.boxes_fn(segment * SEGMENT + i)]}
                              for i in range(SEGMENT)}
                else:
                    frames = {str(i): {"body": [{"box": [k, k, k + 5, k + 5]} for k in range(box_count(segment * SEGMENT + i))]}
                              for i in range(SEGMENT)}
                await route.fulfill(json={"frames": frames})
            finally:
                self.active -= 1
        elif url.path == "/api/autolabel":
            # auto_load_img stores the production raw auto-label response on
            # disk independently of the fixture's /api/al count-filter loader.
            segment = int(args["seg"][0][1:])
            if self.boxes_fn is not None:
                frames = {str(i): {"body": [{"box": b} for b in self.boxes_fn(segment * SEGMENT + i)]}
                          for i in range(SEGMENT)}
            else:
                frames = {str(i): {"body": [{"box": [k, k, k + 5, k + 5]}
                                             for k in range(box_count(segment * SEGMENT + i))]}
                          for i in range(SEGMENT)}
            await route.fulfill(json={"frames": frames})
        elif url.path == "/api/frame":
            self.images.append((args["seg"][0], int(args["i"][0])))
            await route.fulfill(body=PNG, content_type="image/png")
        elif url.path == "/api/frame_status":
            data = route.request.post_data_json
            self.posts.append((int(data["seg"][1:]) * SEGMENT + data["i"], data["label"], data["state"]))
            await route.fulfill(json={})
        elif url.path == "/api/label_edit":
            data = route.request.post_data_json
            self.label_edits.append((int(data["seg"][1:]) * SEGMENT + data["i"], data["label"], data["items"]))
            await route.fulfill(json={})
        else:
            raise AssertionError(f"Unexpected request: {route.request.method} {url.path}")


async def open_page(browser, count=600, current=250, preload=False, boxes_fn=None):
    page = await browser.new_page(viewport={"width": 1200, "height": 820})
    server = Server(count, boxes_fn=boxes_fn)
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
    await page.wait_for_function("S.shownG === 5")
    assert await page.evaluate("S.shownG") == 5
    await page.keyboard.press("Shift+d")
    await page.wait_for_function("S.shownG === 45")
    assert await page.evaluate("S.shownG") == 45
    await page.keyboard.press("a")
    await page.wait_for_function("S.shownG === 41")
    assert await page.evaluate("S.shownG") == 41
    assert await page.evaluate("playNext(5,1)") == 9
    assert await page.evaluate("playNext(5,3)") == 17
    assert await page.evaluate("playNext(497,1)") == 497, "Last matching frame ends playback"

    # Editing the current frame to 2 boxes hides it after the throttled refresh.
    await page.evaluate("async()=>{await show(9);ED.items=[{box:[0,0,5,5]},{box:[9,9,20,20]}];edSave()}")
    await page.wait_for_function("document.querySelector('#labList li[data-g=\"9\"]').hidden")
    # A hidden current frame resumes at its nearest visible neighbor.
    assert await page.evaluate("playNext(9,1)") == 13
    await page.keyboard.press("a")
    await page.wait_for_function("S.shownG === 5")
    assert await page.evaluate("S.shownG") == 5
    await page.evaluate("show(9)")
    await page.keyboard.press("d")
    await page.wait_for_function("S.shownG === 13")
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
    await page.wait_for_timeout(650)
    assert await page.locator(".nl-load-parts").inner_text() == "Other + Phone call"
    rev_before = await page.evaluate("window.__notaBboxFilterV1.revision")
    await page.evaluate("""() => {
      S.onlyTodo = true; fsRender();
    }""")
    assert await page.evaluate("window.__notaBboxFilterV1.revision") > rev_before
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
    await page.wait_for_function("S.shownG === 497")
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


async def done_all(page, server, expected_posts):
    """Click toolbar Done all, accept the confirmation, wait for the saves; returns the dialog text."""
    messages = []

    async def accept(dialog):
        messages.append(dialog.message)
        await dialog.accept()

    page.once("dialog", accept)
    start = len(server.posts)
    await page.click(".nl-done-all")
    await page.wait_for_function("document.querySelector('.nl-done-all').textContent === 'Done all'")
    assert len(server.posts) - start == expected_posts, (len(server.posts) - start, expected_posts)
    return messages[0]


async def test_done_all_sidebar(browser):
    # No filter: every unfinished frame of the label, in every part and clip.
    page, server, errors = await open_page(browser, count=40, current=0)
    await page.evaluate("S.fstat[rvKey(3)]={body:{s:'done'}}")
    await done_all(page, server, 39)
    assert sorted(g for g, _, _ in server.posts) == [g for g in range(40) if g != 3]
    assert all(label == "body" and state == "done" for _, label, state in server.posts)
    assert not errors, errors
    await page.close()

    # Part search + BBox filter: only frames still listed, including a collapsed clip.
    page, server, errors = await open_page(browser)
    await page.fill(".nl-search", "Bottle")  # Frames 300-449.
    await set_counts(page, "1")
    await counts_ready(page)
    await page.evaluate("""() => {
      S.fstat[rvKey(301)]={body:{s:'done'}};
      document.querySelector('#labList > .grp:not([hidden]) .nl-clip').open=false;
    }""")
    expected = [g for g in range(300, 450) if box_count(g) == 1 and g != 301]
    await done_all(page, server, len(expected))
    assert sorted(g for g, _, _ in server.posts) == expected

    # Unreadable counts stay listed but are skipped and reported.
    server.fail.add(1)
    await page.fill(".nl-search", "Phone")  # Frames 150-299: segment 1 fails, segment 2 is known.
    await counts_ready(page)
    expected = [g for g in range(200, 300) if box_count(g) == 1]
    message = await done_all(page, server, len(expected))
    assert "50 frames with unknown BBox counts will be skipped" in message, message
    assert sorted(g for g, _, _ in server.posts[-len(expected):]) == expected
    assert not errors, errors
    await page.close()
    print("PASS: toolbar Done all marks every listed unfinished frame; follows part search and BBox filter; skips unknown counts")


async def test_done_all_waits_only_for_listed_counts(browser):
    """F2: segments read for auto_load_img outside the listed parts do not block toolbar Done all."""
    page, server, errors = await open_page(browser, current=0, preload=True)
    await page.fill(".nl-search", "Other")  # Frames 0-149 listed: segments 0 and 1.
    await set_counts(page, "2")
    await counts_ready(page)
    server.hold.clear()
    await page.click("#start_auto_load")  # The next part (150-299) needs unlisted segment 2.
    while 2 not in server.al_calls:
        await asyncio.sleep(0.02)
    expected = [g for g in range(150) if box_count(g) == 2]
    await done_all(page, server, len(expected))
    assert sorted(g for g, _, _ in server.posts) == expected
    server.hold.set()
    assert not errors, errors
    await page.close()
    print("PASS: F2 Done all waits only for the listed frames' counts")


async def test_status_actions_follow_filter(browser):
    """F1: progress line, part Done all and clip status cover only the frames the BBox filter lists."""
    page, server, errors = await open_page(browser, current=0)
    await set_counts(page, "1")
    await counts_ready(page)
    matched = sum(1 for g in range(600) if box_count(g) == 1)
    assert await page.inner_text(".nl-bbox-progress-text") == f"✓ Counted 600/600 frames · {matched} matched"
    assert await page.inner_text(".nl-bbox-progress-pct") == "100%"

    part = "#labList > .grp[data-part-name='Other']"
    await page.locator(part + " .nl-part-done").click()
    await page.wait_for_function(f"document.querySelector(\"{part} .nl-part-done\").checked")
    expected = [g for g in range(150) if box_count(g) == 1]
    assert sorted(g for g, _, state in server.posts if state == "done") == expected, server.posts
    assert "38 frames" in await page.inner_text(part + " .nl-part-total")

    clip = "#labList > .grp[data-part-name='Phone call'] .nl-clip"
    trigger = page.locator(clip + " button[data-state='todo']").first
    await trigger.scroll_into_view_if_needed()
    await page.wait_for_timeout(100)  # Scroll events dismiss the menu.
    await trigger.click()
    await page.locator("#nl-clip-status-menu button[data-target-state='wip']").click()
    await page.wait_for_function("!document.querySelector('.nl-clip-status-actions[aria-busy=true]')")
    expected = [g for g in range(150, 200) if box_count(g) == 1]
    assert sorted(g for g, _, state in server.posts if state == "wip") == expected, server.posts
    assert "12 frames" in await page.locator(clip + " .nl-clip-meta").first.inner_text()

    await page.click(".nl-bbox-all")
    await page.wait_for_function("document.querySelector('.nl-bbox-progress-wrap').hidden")
    assert "50 frames" in await page.locator(clip + " .nl-clip-meta").first.inner_text(), "All restores full clip counts"
    assert not errors, errors
    await page.close()
    print("PASS: F1 progress line, part Done all and clip status follow the BBox filter; All restores full counts")


async def test_bbox_warn_filter(browser):
    """Error warning filter (F1, F2, F3): loads full session, respects body multi-box convention,
    detects dup/count/size/jump/drift outliers, pairs multi-box trajectories by centroid (F3),
    guards pending warnings when queue drains (F2), and scopes navigation/Ctrl+B/Done all to visible warnings.
    """
    normal_driver = [100, 120, 420, 760]
    normal_passenger = [900, 130, 1210, 750]

    def warn_boxes(g):
        if g // SEGMENT == NO_AUTO_LABEL_SEGMENT:
            return []
        if g == 12:
            # Duplicate overlapping box on driver.
            return [normal_driver, [104, 122, 418, 758], normal_passenger]
        if g == 25:
            # 1-frame flicker: passenger box missing for a single frame.
            return [normal_driver]
        if g == 40:
            # Area/size outlier on driver box.
            return [[10, 10, 880, 1050], normal_passenger]
        if g == 60:
            # 1-frame temporal jump spike (+110px horizontal jump and back).
            return [[210, 120, 530, 760], normal_passenger]
        if g == 171:
            # Smoothly moving auto-label at frame 171 (IoU >= 0.65 with frame 170).
            return [[140, 120, 460, 760], normal_passenger]
        return [normal_driver, normal_passenger]

    page, server, errors = await open_page(browser, count=600, current=12, boxes_fn=warn_boxes)
    # Simulate static bulk-copied S.ledits on frames 170 and 171 that drifted from auto-label.
    await page.evaluate("""() => {
      const drifted = [{box:[360,120,680,760]}, {box:[900,130,1210,750]}];
      S.ledits[rvKey(170)] = {body: JSON.parse(JSON.stringify(drifted))};
      S.ledits[rvKey(171)] = {body: JSON.parse(JSON.stringify(drifted))};
    }""")

    await page.click("#nl-bbox-warn")
    await counts_ready(page)

    # F2: bboxCountsPendingFor must report true whenever warningsReady is false, even if load queue is empty.
    assert await page.evaluate("""() => {
      const NL = window.__notaOrganizerV1;
      const cache = NL.bboxCountCache();
      cache.warningsReady = false;
      const pending = NL.bboxCountsPendingFor([12]);
      cache.warningsReady = true;
      return pending;
    }""") is True

    # F3: vertically stacked 2-box clip whose cx crosses by 2px must pair by centroid distance, not raw x-sort index.
    assert await page.evaluate("""() => {
      const NL = window.__notaOrganizerV1;
      const a = [{cx: 300, cy: 200, box: [250, 150, 350, 250]}, {cx: 301, cy: 600, box: [251, 550, 351, 650]}];
      const b = [{cx: 301, cy: 600, box: [251, 550, 351, 650]}, {cx: 302, cy: 200, box: [252, 150, 352, 250]}];
      const matched = NL.matchBoxesToReference(a, b);
      return matched[0].cy === 200 && matched[1].cy === 600;
    }""") is True

    # Full-session auto-label segments loaded (<=2 concurrent).
    assert sorted(server.al_calls) == [0, 1, 2, 3, 4] and server.peak <= 2, (server.al_calls, server.peak)
    # Normal 2-box body frames are NOT flagged; only the 6 injected warning frames appear.
    expected_warnings = [12, 25, 40, 60, 170, 171]
    assert await visible_frames(page) == expected_warnings, await visible_frames(page)

    badges = await page.evaluate("""() => {
      const out = {};
      for (const li of document.querySelectorAll('#labList li[data-g]:not([hidden])')) {
        out[li.dataset.g] = li.querySelector('.nl-warn-badge')?.textContent || '';
      }
      return out;
    }""")
    assert "dup" in badges["12"], badges
    assert "count" in badges["25"], badges
    assert "size" in badges["40"], badges
    assert "jump" in badges["60"], badges
    assert "drift" in badges["170"] and "drift" in badges["171"], badges

    # Navigation (D, A, playNext) follows only the warning frames displayed in the sidebar.
    await page.keyboard.press("d")
    await page.wait_for_function("S.shownG === 25")
    assert await page.evaluate("S.shownG") == 25
    await page.keyboard.press("d")
    await page.wait_for_function("S.shownG === 40")
    assert await page.evaluate("S.shownG") == 40
    await page.keyboard.press("a")
    await page.wait_for_function("S.shownG === 25")
    assert await page.evaluate("S.shownG") == 25
    assert await page.evaluate("playNext(25, 1)") == 40
    assert await page.evaluate("playNext(60, 1)") == 170

    # Fix frame 12 to normal 2 boxes and use Ctrl+B to copy to the next 2 frames in clip 0.
    # Because Ctrl+B follows the sidebar filter, the next 2 frames in clip 0 are [25, 40] (NOT 13, 14).
    await page.evaluate("""async () => {
      S.fstat[rvKey(12)] = {body: {s: 'wip'}};
      await show(12);
      ED.items = [{box:[100,120,420,760]}, {box:[900,130,1210,750]}];
      edSave();
    }""")
    await page.keyboard.press("Control+b")
    await page.wait_for_selector("#nl-eye-bulk[open]")
    await page.fill("#nl-eye-bulk .nl-count", "2")
    await page.click("#nl-eye-bulk .nl-apply")
    await page.wait_for_function("!document.querySelector('#nl-eye-bulk').open")
    assert [g for g, _, _ in server.label_edits] == [25, 40], server.label_edits

    # After fixing frames 12, 25, and 40, the warning filter re-evaluates and leaves only [60, 170, 171].
    await page.wait_for_function("document.querySelectorAll('#labList li[data-g]:not([hidden])').length === 3")
    assert await visible_frames(page) == [60, 170, 171]

    # Toolbar Done all marks only the remainingunfinished warning frames listed in the sidebar.
    server.posts.clear()
    await done_all(page, server, 3)
    assert sorted(g for g, _, state in server.posts if state == "done") == [60, 170, 171], server.posts

    # Clicking All clears the warning filter and removes all warning badges.
    await page.click(".nl-bbox-all")
    assert await visible_frames(page) == list(range(600))
    assert await page.evaluate("document.querySelectorAll('.nl-warn-badge').length") == 0
    assert not errors, errors
    await page.close()
    print("PASS: Error warning filter loads session, respects body multi-box, flags anomalies, and scopes nav/Ctrl+B/Done all")


async def main():
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        try:
            await test_bbox_warn_filter(browser)
            await test_auto_load_window_follows_filter(browser)
            await test_preload_outside_search(browser)
            await test_hidden_frame_after_last_match(browser)
            await test_filter_and_loading(browser)
            await test_part_search_limits_loading(browser)
            await test_navigation_and_edits(browser)
            await test_auto_load_with_filter(browser)
            await test_large_list(browser)
            await test_done_all_sidebar(browser)
            await test_done_all_waits_only_for_listed_counts(browser)
            await test_status_actions_follow_filter(browser)
        finally:
            await browser.close()


if __name__ == "__main__":
    asyncio.run(main())
