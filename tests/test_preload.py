"""Offline Chromium integration tests: python tests/test_preload.py.

Use the real preloader with an authenticated-page-shaped fixture, delayed image
responses, IndexedDB, and the native getFrame bitmap cache contract.
"""
import asyncio
import os
from collections import Counter
from pathlib import Path

from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = (ROOT / "extension" / "preload.js").read_text(encoding="utf-8")
PNG = (ROOT / "extension" / "icons" / "icon16.png").read_bytes()
HTML = """<!doctype html><html><head><meta charset="utf-8"></head><body>
<div id="nota-labeling-organizer-v1"></div>
<input id="annotation" aria-label="Annotation"><canvas id="view"></canvas>
<div id="labList"></div><script>
const S = {
  mode: 'label', labelSel: 'body', gen: 1, w: 1920, q: 85, G: 12,
  sess: {bucket: 'test', prefix: 'test/', segments: [{name: 'segment', n: 12}]},
  g: 0, shownG: 0, frames: new Map(), inflight: new Map(), bmp: null,
  review: {}, fstat: {}, onlyTodo: true
};
const TAG_KO = {p1: 'Other', p2: 'Phone', p3: 'Bottle', p4: 'Acting'};
for (let g=0;g<12;g++) S.review[g] = {i:g, labels:['body','hand']};
function rvG(item) { return item.i; }
function clipAt(g) { return {cat:'p'+(Math.floor(g/3)+1), n:g%3===2?2:1}; }
function loc(g) { return [0,g]; }
function segPfx() { return S.sess.prefix; }
function fsGet(g, label=S.labelSel) { return S.fstat[label+':'+g] || 'todo'; }
window.statusGate = null; window.saveFails = false;
async function fsSet(value, g=S.shownG) {
  const key=S.labelSel+':'+g, old=S.fstat[key];
  S.fstat[key]=value; // Like the native UI, optimistic until the save returns.
  if (window.statusGate) await window.statusGate;
  if (window.saveFails) S.fstat[key]=old;
}
function fkey(g) { return `${S.gen}:${S.w}:${g}`; }
window.decodes=0;
function getFrame(g) {
  const k=fkey(g), hit=S.frames.get(k);
  if(hit) return Promise.resolve(hit);
  if(S.inflight.has(k)) return S.inflight.get(k);
  const gen=S.gen;
  const p=fetch(`/api/frame?bucket=${encodeURIComponent(S.sess.bucket)}&prefix=${encodeURIComponent(segPfx(0))}&seg=segment&i=${g}&w=${S.w}&q=${S.q}`)
    .then(r=>{if(!r.ok) throw new Error('frame '+r.status); return r.blob();})
    .then(blob=>{window.decodes++;return createImageBitmap(blob);})
    .then(bitmap=>{
      if(gen!==S.gen){bitmap.close();return null;}
      S.frames.set(k,bitmap);return bitmap;
    }).finally(()=>S.inflight.delete(k));
  S.inflight.set(k,p);return p;
}
async function show(g) {
  S.g=g;const bitmap=await getFrame(g);if(S.g!==g||!bitmap)return;
  S.bmp=bitmap;S.shownG=g;document.querySelector('canvas').getContext('2d').drawImage(bitmap,0,0);
}
</script></body></html>"""


class Server:
    def __init__(self):
        self.calls = []
        self.active = 0
        self.peak = 0
        self.delay = 0.08
        self.fail = set()
        self.hold = None
        self.other = []

    async def route(self, route):
        from urllib.parse import urlparse, parse_qs
        url = urlparse(route.request.url)
        if url.path == "/":
            await route.fulfill(body=HTML, content_type="text/html")
        elif url.path == "/api/frame":
            args = parse_qs(url.query)
            g = int(args["i"][0])
            self.calls.append((args["prefix"][0], g))
            self.active += 1
            self.peak = max(self.peak, self.active)
            try:
                if self.hold:
                    await self.hold.wait()
                await asyncio.sleep(self.delay)
                await route.fulfill(status=503 if g in self.fail else 200,
                                    body="Unavailable" if g in self.fail else PNG,
                                    content_type="text/plain" if g in self.fail else "image/png")
            except Exception:
                pass  # An intentional Stop or navigation can abort a request.
            finally:
                self.active -= 1
        else:
            self.other.append((route.request.method, url.path))
            await route.fulfill(body='{"ok":true}', content_type="application/json")


async def setup(browser):
    context = await browser.new_context()
    page = await context.new_page()
    server = Server()
    await page.route("**/*", server.route)
    await page.goto("https://ntt.dev.nota.ai/")
    await page.add_script_tag(content=SCRIPT)
    return context, page, server


async def ready_count(page, count):
    await page.wait_for_function(
        "n => document.querySelector('.nl-load-count').textContent === `Ready ${n} / ${n} images`", arg=count)


async def stored(page):
    return await page.evaluate("""() => new Promise((resolve,reject) => {
      const open=indexedDB.open('nota-part-images-v1');
      open.onsuccess=()=>{
        const db=open.result, tx=db.transaction('images'), request=tx.objectStore('images').getAll();
        request.onsuccess=()=>resolve(request.result.map(x=>({owner:x.owner,url:x.url})));
        tx.oncomplete=()=>db.close();
      };open.onerror=()=>reject(open.error);
    })""")


async def test_window_rotation(browser):
    context, page, server = await setup(browser)
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    await page.wait_for_timeout(600)
    assert not server.calls
    await page.click("#start_auto_load")
    await ready_count(page, 6)
    assert [g for _, g in server.calls[:3]] == [0, 1, 2], server.calls
    assert Counter(g for _, g in server.calls) == Counter(range(6))
    assert server.peak <= 4, "HTTP/1.1 fixture: at most 4 background requests"
    assert await page.evaluate("decodes") == 0, "Background preloading must not decode images into RAM"
    assert await page.evaluate("S.frames.size") == 0
    # Reading a downloaded image, even after its bitmap is evicted, avoids HTTP.
    await page.evaluate("show(1)")
    await page.evaluate("S.frames.clear(); show(1)")
    assert len(server.calls) == 6
    assert await page.evaluate("S.shownG") == 1
    await page.fill("#annotation", "Editing still works")
    assert await page.input_value("#annotation") == "Editing still works"
    await page.evaluate("fetch('/api/annotation', {method:'POST', body:'test'})")
    assert server.other == [("POST", "/api/annotation")]
    # Only the final clip is Done: do not evict unfinished earlier frames.
    await page.evaluate("fsSet('done',2)")
    await page.wait_for_timeout(650)
    assert len(server.calls) == 6
    # The last missing Done is optimistic and its save fails: do not rotate.
    await page.evaluate("""() => {
      S.fstat['body:0']='done'; saveFails=true;
      window.statusGate=new Promise(resolve=>window.finishSave=resolve);
      fsSet('done',1);
    }""")
    await page.wait_for_timeout(650)
    assert len(server.calls) == 6
    await page.evaluate("finishSave(); window.statusGate=null")
    await page.wait_for_timeout(650)
    assert len(server.calls) == 6
    # Confirmed whole-part completion slides 1+2 -> 2+3 without reloading 2.
    await page.evaluate("saveFails=false; fsSet('done',1)")
    await page.wait_for_function("document.querySelector('.nl-load-parts').textContent === 'Phone + Bottle'")
    await ready_count(page, 6)
    assert Counter(g for _, g in server.calls) == Counter(range(9))
    rows = await stored(page)
    assert len(rows) == 6 and len({row["owner"] for row in rows}) == 2
    assert all(int(row["url"].split("&i=")[1].split("&")[0]) >= 3 for row in rows)
    await page.evaluate("Promise.all([3,4,5].map(g=>fsSet('done',g)))")
    await page.wait_for_function("document.querySelector('.nl-load-parts').textContent === 'Bottle + Acting'")
    await ready_count(page, 6)
    assert Counter(g for _, g in server.calls) == Counter(range(12))
    await page.evaluate("Promise.all([6,7,8].map(g=>fsSet('done',g)))")
    await ready_count(page, 3)
    assert len(await stored(page)) == 3
    await page.evaluate("Promise.all([9,10,11].map(g=>fsSet('done',g)))")
    await page.wait_for_function("document.querySelector('.nl-load-parts').textContent.includes('All remaining')")
    assert len(await stored(page)) == 0
    assert not errors, errors
    await context.close()
    print("PASS: 2-part order, concurrency, disk hits, no background decoding, save rollback, 1+2 -> 2+3 -> 3+4 -> 4")


async def test_stop_resume(browser):
    context, page, server = await setup(browser)
    server.delay = 0.25
    await page.click("#start_auto_load")
    await page.wait_for_function(r"/^Loading [1-5] \/ 6/.test(document.querySelector('.nl-load-count').textContent)")
    await page.click("#stop_auto_load")
    await page.wait_for_timeout(500)
    before = len(server.calls)
    count = await page.locator(".nl-load-count").inner_text()
    loaded = int(count.split()[1])
    assert "Stopped" in count and 0 < loaded < 6, count
    await page.wait_for_timeout(700)
    assert len(server.calls) == before, "Stop must not schedule new background requests"
    rows = await stored(page)
    assert len(rows) == loaded
    kept = {int(row["url"].split("&i=")[1].split("&")[0]) for row in rows}
    await page.click("#start_auto_load")
    await ready_count(page, 6)
    counts = Counter(g for _, g in server.calls)
    assert all(counts[g] == 1 for g in kept), counts
    assert len(await stored(page)) == 6
    # Immediate Stop/Start cannot poison resumed work with an old AbortError.
    await page.evaluate("S.shownG=6; S.g=6")
    await page.wait_for_function("document.querySelector('.nl-load-parts').textContent === 'Bottle + Acting'")
    await page.click("#stop_auto_load")
    await page.click("#start_auto_load")
    await ready_count(page, 6)
    assert "failed" not in await page.locator(".nl-load-count").inner_text()
    await context.close()
    print("PASS: Stop preserves completed downloads, restart fetches missing images, rapid Stop/Start")


async def test_priority_order(browser):
    context, page, server = await setup(browser)
    server.hold = asyncio.Event()
    # Open frame 1 of part 1 (frames 0-2), with frame 2 already Done.
    await page.evaluate("S.fstat['body:2']='done'; S.shownG=1; S.g=1")
    await page.click("#start_auto_load")
    while len(server.calls) < 4:
        await asyncio.sleep(0.02)
    assert [g for _, g in server.calls[:4]] == [1, 0, 2, 3], server.calls
    server.hold.set()
    await ready_count(page, 6)
    await context.close()
    print("PASS: open frame first, earlier frames next, Done frames last")


async def test_navigation_and_scope(browser):
    context, page, server = await setup(browser)
    server.delay = 0.35
    await page.click("#start_auto_load")
    await page.wait_for_function("document.querySelector('.nl-load-count').textContent.startsWith('Loading')")
    await page.wait_for_timeout(120)
    await page.evaluate("show(1)")
    assert Counter(g for _, g in server.calls)[1] == 1, "Foreground and preload must share one request"
    await page.fill("#annotation", "Can edit while preloading")
    await ready_count(page, 6)
    await page.click("#stop_auto_load")
    await page.evaluate("S.shownG=9; S.g=9")
    await page.click("#start_auto_load")
    await ready_count(page, 3)
    assert (await page.locator(".nl-load-parts").inner_text()) == "Acting"
    assert len(await stored(page)) == 3
    # Changing label stops automatically and clears old scope records.
    await page.evaluate("S.labelSel='hand'")
    await page.wait_for_function("document.querySelector('.nl-load-count').textContent === 'Loaded 0 / 0 images'")
    await page.wait_for_timeout(150)
    assert len(await stored(page)) == 0
    await page.click("#start_auto_load")
    await ready_count(page, 3)
    # Same frame IDs in a new session must fetch that session's images.
    await page.evaluate("S.gen++; S.sess={...S.sess,prefix:'another/'}; S.frames.clear()")
    await page.wait_for_function("document.querySelector('.nl-load-count').textContent === 'Loaded 0 / 0 images'")
    await page.click("#start_auto_load")
    await ready_count(page, 3)
    assert {prefix for prefix, _ in server.calls[-3:]} == {"another/"}
    # A width/quality change likewise cannot reuse the previous image variant.
    await page.evaluate("S.q=70")
    await page.wait_for_function("document.querySelector('.nl-load-count').textContent === 'Loaded 0 / 0 images'")
    await page.wait_for_timeout(150)
    assert len(await stored(page)) == 0
    await context.close()
    print("PASS: navigation stays usable, shared fetches, current-part restart, label/session/quality isolation")


async def test_failures(browser):
    context, page, server = await setup(browser)
    server.fail.add(1)
    await page.click("#start_auto_load")
    await page.wait_for_function("document.querySelector('.nl-load-count').textContent.includes('5 / 6 images · 1 failed')")
    assert len(await stored(page)) == 5
    await page.click("#stop_auto_load")
    server.fail.clear()
    await page.click("#start_auto_load")
    await ready_count(page, 6)
    assert Counter(g for _, g in server.calls)[1] == 2
    assert len(server.calls) == 7
    await context.close()

    context, page, server = await setup(browser)
    await page.evaluate("""() => {
      const put=IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put=function(...args) {
        if(this.name==='images') throw new DOMException('Test quota', 'QuotaExceededError');
        return put.apply(this,args);
      };
    }""")
    await page.click("#start_auto_load")
    await page.wait_for_function("document.querySelector('.nl-load-parts').textContent.includes('Storage full')")
    assert await page.locator("#start_auto_load").is_enabled()
    assert "0 / 6" in await page.locator(".nl-load-count").inner_text()
    await page.evaluate("show(1)")
    assert await page.evaluate("S.shownG") == 1
    await context.close()
    print("PASS: failed frames excluded from progress and retried; quota failure stops background work without blocking navigation")


async def test_organizer_integration(browser):
    context = await browser.new_context(viewport={"width": 1100, "height": 850})
    page = await context.new_page()
    server = Server()
    # Use the saved DMS getFrame/prefetch/show code, when available locally.
    native_file = ROOT.parent / "NOTA_LABEL" / "DMS Web Viewer_files" / "app.js.download"
    fixture = HTML.replace('<div id="nota-labeling-organizer-v1"></div>', "")
    fixture = fixture.replace('<div id="labList"></div>', """<div id="labPane" style="width:330px">
      <div id="labTitle">Labeling · body</div><div id="labList"></div></div><div id="spin" hidden></div>""")
    extra = """
      const ED={items:[], sel:-1, drag:null, mouse:null};
      const list=document.querySelector('#labList');
      for(let p=0;p<4;p++){
        const row=document.createElement('div');row.className='grp';
        row.innerHTML=`<div class="vlab">${TAG_KO['p'+(p+1)]}</div><ul></ul>`;
        for(let g=p*3;g<p*3+3;g++){
          const li=document.createElement('li');li.dataset.g=g;
          li.innerHTML=`<span class="fs todo"></span><span class="name"><b class="no">#${g%3===2?'02':'01'}</b><span class="tm">12:00:00.${g}</span></span>`;
          li.addEventListener('click',()=>show(g));row.querySelector('ul').append(li);
        }
        list.append(row);
      }
      S.lseq=Int32Array.from({length:12},(_,i)=>i);
      function pause(){}
      function playNext(g,step=1){return Math.min(11,g+step);}
      function rvKey(g){return `segment:${g}`;}
      function drawBar(){}
      function saveHashSoon(){}
      function msg(text){window.lastMessage=text;}
      function paint(){
        document.querySelectorAll('#labList li').forEach(li=>li.classList.toggle('cur',Number(li.dataset.g)===S.shownG));
      }
    """
    if native_file.exists():
        source = native_file.read_text(encoding="utf-8")
        native = source[source.index("function fkey(g)"):source.index("\nlet _hashT")]
        extra += "\nconst MAX_BITMAPS=240, MAX_INFLIGHT=6, enc=encodeURIComponent, $=id=>document.getElementById(id);\n" + native
    fixture = fixture.replace("</script>", extra + "</script>")

    async def route(route):
        if route.request.url == "https://ntt.dev.nota.ai/":
            await route.fulfill(body=fixture, content_type="text/html")
        else:
            await server.route(route)

    await page.route("**/*", route)
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    await page.goto("https://ntt.dev.nota.ai/")
    await page.add_script_tag(content=(ROOT / "extension" / "content.js").read_text(encoding="utf-8"))
    await page.add_script_tag(content=SCRIPT)
    await page.wait_for_selector(".nl-organized")
    await page.click("#start_auto_load")
    await ready_count(page, 6)
    assert await page.evaluate("S.frames.size") == 0
    await page.evaluate("show(0)")
    before = len(server.calls)
    await page.locator(".nl-load-start").blur()
    await page.keyboard.press("d")
    await page.wait_for_function("S.shownG === 1 && S.inflight.size === 0")
    assert len(server.calls) == before
    assert await page.evaluate("S.frames.has(fkey(2)) && S.frames.has(fkey(3))"), "A/D lookahead uses native frame cache"
    assert not errors, errors
    if os.environ.get("NOTA_TEST_SCREENSHOT"):
        await page.locator("#labPane").screenshot(path=os.environ["NOTA_TEST_SCREENSHOT"])
    await context.close()
    print("PASS: organizer + preloader integration, A/D lookahead and native DMS frame cache")


async def main():
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        try:
            await test_window_rotation(browser)
            await test_stop_resume(browser)
            await test_priority_order(browser)
            await test_navigation_and_scope(browser)
            await test_failures(browser)
            await test_organizer_integration(browser)
        finally:
            await browser.close()


if __name__ == "__main__":
    asyncio.run(main())
