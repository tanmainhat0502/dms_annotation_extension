"""Chromium regressions for closing a sticky clip after saving Done.

Run: python tests/test_sidebar_scroll.py
All DMS responses are local fixtures; no live annotation data is changed.
"""
import asyncio
import json
from pathlib import Path

from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = (ROOT / "extension/content.js").read_text(encoding="utf-8")
PRELOAD = (ROOT / "extension/preload.js").read_text(encoding="utf-8")
CSS = """
* { box-sizing: border-box; }
html, body { height: 100%; margin: 0; }
body { display: flex; font: 13px/1.45 "Segoe UI", sans-serif; background: #16181c; color: #eee; }
#side { width: 340px; flex: none; padding: 12px; display: flex; flex-direction: column; overflow: hidden; }
#side h1 { font-size: 15px; margin: 0 0 10px; }
#labPane { display: flex; flex-direction: column; min-height: 0; flex: 1; overflow: auto; }
#labList .grp { display: flex; border-bottom: 1px solid #333; }
#labList .vlab { writing-mode: vertical-rl; text-orientation: upright; width: 26px;
  flex: none; padding: 6px 0; background: #23272e; font-size: 12px; white-space: nowrap; }
#labList ul { list-style: none; margin: 0; padding: 0; flex: 1; min-width: 0; }
#labList li { display: flex; gap: 6px; padding: 3px 6px 3px 8px; font-size: 12px; }
#labList li .name { flex: 1; min-width: 0; }
#labList li.cur { background: #3a2440; }
"""
HTML = """<!doctype html><html><head><meta charset="utf-8"><style>CSS_HERE</style></head>
<body><aside id="side"><h1>DMS Labeling</h1><div id="labPane">
<div id="labTitle">Labeling · body</div><div id="labList"></div></div></aside>
<canvas id="view"></canvas><script>
const S = {mode:'label', labelSel:'body', gen:1, w:1920, q:85, G:600, g:0, shownG:0,
  sess:{bucket:'fixture', prefix:'test/', segments:[{name:'segment', n:600}]},
  review:{}, fstat:{}, ledits:{}, onlyTodo:false, frames:new Map(), inflight:new Map()};
const ED={items:[],sel:-1,drag:null,mouse:null};
const TAG_KO={p0:'Other',p1:'Phone call',p2:'Bottle',p3:'Acting'};
for(let g=0;g<S.G;g++) S.review['segment:'+g]={i:g, labels:['body']};
function rvKey(g){return 'segment:'+g;}
function rvG(item){return item.i;}
function loc(g){return [0,g];}
function segPfx(){return S.sess.prefix;}
function clipAt(g){return {cat:'p'+Math.floor(g/150),n:Math.floor(g%150/50)+1};}
function fsGet(g,lab=S.labelSel){return S.fstat[rvKey(g)]?.[lab]?.s || 'todo';}
function fsLocked(){return fsGet(S.shownG)==='done';}
function buildSeq(){S.lseq=Int32Array.from(Object.values(S.review)
  .filter(it=>!S.onlyTodo || fsGet(it.i)!=='done').map(it=>it.i));}
function pause(){}
function drawBar(){}
function renderTabs(){}
function renderProg(){}
function lsBoxRender(){}
function flash(text){window.lastMessage=text;}
function show(g){S.g=S.shownG=g;rvMarkLab();}
function rvMarkLab(){
  for(const li of document.querySelectorAll('#labList li')){
    const current=Number(li.dataset.g)===S.shownG;
    li.classList.toggle('cur',current);
    if(current) li.scrollIntoView({block:'nearest'});
  }
}
function renderLabList(){
  const list=document.querySelector('#labList');list.innerHTML='';
  for(let p=0;p<4;p++){
    const group=document.createElement('div');group.className='grp';
    group.innerHTML=`<div class="vlab">${TAG_KO['p'+p]}</div><ul></ul>`;
    for(const g of S.lseq){
      if(Math.floor(g/150)!==p) continue;
      const li=document.createElement('li');li.dataset.g=g;
      li.innerHTML=`<span class="fs ${fsGet(g)}">○</span><span class="name">
        <b class="no">#${String(clipAt(g).n).padStart(2,'0')}</b> body,head,face,eye,hand<br>
        <span class="tm">21:22:${String(g%60).padStart(2,'0')}.4</span></span>`;
      li.onclick=()=>show(g);
      group.querySelector('ul').append(li);
    }
    if(group.querySelector('li')) list.append(group);
  }
  rvMarkLab();
}
function fsRender(){
  if(S.onlyTodo) buildSeq();
  renderLabList();
  if(S.onlyTodo && !S.lseq.includes(S.shownG) && S.lseq.length)
    show([...S.lseq].find(g=>g>S.shownG) ?? S.lseq[0]);
}
buildSeq();renderLabList();
</script></body></html>""".replace("CSS_HERE", CSS)
CLIP = '.grp[data-part-name="Phone call"] .nl-clip[data-clip="#02"]'


async def settle(page):
    await page.evaluate("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))")


class Fixture:
    def __init__(self):
        self.gate = asyncio.Event()
        self.gate.set()
        self.fail = False
        self.saves = []

    async def route(self, route):
        if route.request.url.endswith("/api/frame_status"):
            self.saves.append(route.request.post_data_json)
            await self.gate.wait()
            await route.fulfill(status=503 if self.fail else 200,
                                body=json.dumps({"detail": "Save failed"} if self.fail else {}),
                                content_type="application/json")
        elif route.request.url == "https://ntt.dev.nota.ai/":
            await route.fulfill(body=HTML, content_type="text/html")
        else:
            await route.abort()


async def setup(browser, later_open=True):
    page = await browser.new_page(viewport={"width": 1100, "height": 820})
    fixture, errors = Fixture(), []
    page.on("pageerror", lambda error: errors.append(str(error)))
    await page.route("**/*", fixture.route)
    await page.goto("https://ntt.dev.nota.ai/")
    await page.add_script_tag(content=SCRIPT)
    await page.add_script_tag(content=PRELOAD)
    await page.wait_for_selector("#start_auto_load")
    await page.evaluate("""laterOpen=>{
      document.querySelectorAll('.nl-clip').forEach((clip,index)=>{clip.open=laterOpen || index<=4;});
      show(228);
    }""", later_open)
    await settle(page)
    await page.locator(CLIP).evaluate("""clip=>{
      const pane=document.querySelector('#labPane'), toolbar=document.querySelector('#nota-labeling-organizer-v1');
      pane.scrollTop+=clip.getBoundingClientRect().top-toolbar.getBoundingClientRect().bottom+clip.offsetHeight*.7;
    }""")
    await settle(page)
    return page, fixture, errors


async def click_without_scrolling(page, selector, toggle=False):
    # Locator.click auto-scrolls a sticky element, which can hide this bug.
    bounds = await page.locator(selector).bounding_box()
    await page.mouse.click(bounds["x"] + (12 if toggle else bounds["width"] / 2),
                           bounds["y"] + bounds["height"] / 2)


async def header_y(page):
    return (await page.locator(CLIP + " > summary").bounding_box())["y"]


async def assert_retained(page, before):
    await settle(page)
    after = await header_y(page)
    assert abs(after - before) <= 1, f"Clip header jumped from {before:.1f} to {after:.1f}"
    assert not await page.locator(CLIP).evaluate("el=>el.open")
    assert await page.evaluate("S.shownG") == 228, "Collapsing must not navigate to another frame"
    assert await page.locator(CLIP + " > summary").evaluate("""el=>{
      const rect=el.getBoundingClientRect();
      return el.contains(document.elementFromPoint(rect.left+12,rect.top+rect.height/2));
    }"""), "Collapsed header must remain visible and clickable"


async def test_done_and_collapse(browser):
    page, fixture, errors = await setup(browser)
    before = await header_y(page)
    await click_without_scrolling(page, CLIP + ' button[data-state="todo"]')
    await page.locator('#nl-clip-status-menu button[data-target-state="done"]').click()
    await page.wait_for_function("Array.from({length:50},(_,i)=>fsGet(200+i)).every(s=>s==='done')")
    await page.wait_for_selector(CLIP + ' button[data-state="done"][aria-pressed="true"]')
    assert len(fixture.saves) == 50
    assert abs(await header_y(page) - before) <= 1, "Done must not move the viewport"
    await click_without_scrolling(page, CLIP + " > summary", toggle=True)
    await assert_retained(page, before)
    # Native paints and list rebuilds must respect the user's manual collapse.
    await page.evaluate("rvMarkLab();fsRender();renderLabList()")
    await assert_retained(page, before)
    # Reopen/close with keyboard, preserving native <summary> activation.
    await page.locator(CLIP + " > summary").evaluate("el=>el.focus({preventScroll:true})")
    await page.keyboard.press("Enter")
    await settle(page)
    assert await page.locator(CLIP).evaluate("el=>el.open")
    assert abs(await header_y(page) - before) <= 1
    await page.keyboard.press("Space")
    await assert_retained(page, before)
    # A deliberate frame selection still scrolls to that frame.
    await page.evaluate("show(350)")
    await settle(page)
    visible = await page.locator('li[data-g="350"]').evaluate("""el=>{
      const row=el.getBoundingClientRect(), pane=document.querySelector('#labPane').getBoundingClientRect();
      return {top:row.top,bottom:row.bottom,paneTop:pane.top,paneBottom:pane.bottom};
    }""")
    assert visible["top"] >= visible["paneTop"] - 1 and visible["bottom"] <= visible["paneBottom"] + 1, visible
    assert not errors, errors
    await page.close()
    print("PASS: Done + collapse stays at the same clip; repaint, rebuild, keyboard toggle and navigation")


async def test_pending_done(browser, failure=False):
    page, fixture, errors = await setup(browser)
    before = await header_y(page)
    fixture.gate.clear()
    fixture.fail = failure
    await click_without_scrolling(page, CLIP + ' button[data-state="todo"]')
    await page.locator('#nl-clip-status-menu button[data-target-state="done"]').click()
    await page.wait_for_selector(CLIP + ' [aria-busy="true"]')
    await click_without_scrolling(page, CLIP + " > summary", toggle=True)
    await assert_retained(page, before)
    fixture.gate.set()
    await page.wait_for_function("!!window.lastMessage")
    await assert_retained(page, before)
    assert await page.evaluate("fsGet(228)") == ("todo" if failure else "done")
    assert not errors, errors
    await page.close()
    print(f"PASS: collapsing while Done is pending stays put after {'failed' if failure else 'successful'} save")


async def test_short_remaining_list(browser):
    page, _, errors = await setup(browser, later_open=False)
    before = await header_y(page)
    await click_without_scrolling(page, CLIP + " > summary", toggle=True)
    await settle(page)
    # With too little content below the clip, the browser may reach max scroll.
    # It must still keep the closed clip visible, rather than switch parts.
    after = await header_y(page)
    pane = await page.locator("#labPane").bounding_box()
    toolbar = await page.locator("#nota-labeling-organizer-v1").bounding_box()
    assert toolbar["y"] + toolbar["height"] - 1 <= after < pane["y"] + pane["height"] - 32
    assert not await page.locator(CLIP).evaluate("el=>el.open")
    assert await page.evaluate("S.shownG") == 228
    assert not errors, errors
    await page.close()
    print("PASS: closing near the end with later clips collapsed keeps the header visible")


async def main():
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        try:
            await test_done_and_collapse(browser)
            await test_pending_done(browser)
            await test_pending_done(browser, failure=True)
            await test_short_remaining_list(browser)
        finally:
            await browser.close()


if __name__ == "__main__":
    asyncio.run(main())
