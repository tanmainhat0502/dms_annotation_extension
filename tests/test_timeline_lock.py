"""Offline Chromium checks for the timeline lock and native frame navigation."""
from pathlib import Path

from playwright.sync_api import sync_playwright

from _ext import read_organizer_script
from test_sidebar_scroll import HTML as SIDEBAR_HTML

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = read_organizer_script()
NATIVE_CLICK = """
bar.addEventListener("click", (e) => {
  if (!S.sess || (typeof labEmpty === "function" && labEmpty())) return;
  const r = bar.getBoundingClientRect();
  const g = snap(barToG((e.clientX - r.left) / r.width));
  const was = S.playing; pause();
  show(g).then(() => was && play());
});
"""
native_file = ROOT.parent / 'NOTA_LABEL/DMS Web Viewer_files/app.js.download'
if native_file.exists():
    native = native_file.read_text(encoding='utf-8')
    a = native.index('bar.addEventListener("click"')
    NATIVE_CLICK = native[a:native.index('bar.addEventListener("mousemove"', a)]

SETUP = """
const bar=document.querySelector('#bar');
window.seeks=0;window.pauses=0;window.releases=0;window.draws=0;S.playing=false;
function snap(g){return Math.max(0,Math.min(S.G-1,g));}
function barToG(frac){return Math.round(frac*(S.G-1));}
function pause(){S.playing=false;window.pauses++;}
function play(){S.playing=true;}
function show(g){S.g=S.shownG=g;window.seeks++;rvMarkLab();drawBar();return Promise.resolve();}
function drawBar(){
  window.draws++;
  bar.width=Math.round(bar.clientWidth*devicePixelRatio);bar.height=44*devicePixelRatio;
  const c=bar.getContext('2d');c.fillStyle='#f000ed';c.fillRect(0,0,bar.width,6*devicePixelRatio);
  c.fillStyle='#4fb86a';c.fillRect(0,28*devicePixelRatio,S.g/(S.G-1)*bar.width,7*devicePixelRatio);
  c.fillStyle='#ffd278';c.font=`${11*devicePixelRatio}px sans-serif`;c.textAlign='right';
  c.fillText(`${S.g+1} / ${S.G}`,bar.width-4*devicePixelRatio,16*devicePixelRatio);
}
window.addEventListener('mouseup',()=>window.releases++);
document.addEventListener('keydown',e=>{
  if(e.code==='Space' && !['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName)){
    e.preventDefault();S.playing ? pause() : play();
  }
});
show(228);
"""
HTML = SIDEBAR_HTML.replace('<canvas id="view"></canvas>', '''
<main id="viewer"><div id="stage"><canvas id="view" width="400" height="240"></canvas></div>
<canvas id="bar" width="640" height="44"></canvas></main>
<style>
main { flex:1;display:flex;flex-direction:column;min-width:0;padding:10px;gap:6px; }
#stage { flex:1;min-height:0;background:#000;display:flex;align-items:center;justify-content:center; }
#bar { width:100%;cursor:pointer;background:#1d2128;border-radius:4px;flex:none; }
#bar[hidden] { display:none!important; }
</style>''').replace('</body>', '<script>'+SETUP+NATIVE_CLICK+'</script></body>')


def main():
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True)
        page = browser.new_page(viewport={'width':1200,'height':820}, has_touch=True, device_scale_factor=2)
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.route('**/*', lambda route: route.fulfill(body=HTML, content_type='text/html'))

        def install():
            page.add_script_tag(content=SCRIPT)
            page.wait_for_selector('#nl-timeline-lock')
            page.wait_for_function('bar.width===Math.round(bar.clientWidth*devicePixelRatio)')

        def point(frac):
            r=page.locator('#bar').bounding_box()
            return r['x']+frac*r['width'],r['y']+r['height']/2

        def state():
            return page.evaluate('({g:S.g,shown:S.shownG,playing:S.playing,seeks:window.seeks,pauses:window.pauses})')

        def assert_layout():
            bar=page.locator('#bar').bounding_box()
            button=page.locator('#nl-timeline-lock').bounding_box()
            main=page.locator('#viewer').bounding_box()
            assert abs(bar['height']-44)<1 and abs(button['height']-32)<1
            assert 5<=button['x']-(bar['x']+bar['width'])<=7
            assert abs(button['y']+16-(bar['y']+22))<1
            assert button['x']+button['width']<=main['x']+main['width']
            assert page.locator('#nl-timeline-lock').count()==1

        page.goto('https://ntt.dev.nota.ai/')
        install();assert_layout()
        button=page.locator('#nl-timeline-lock')
        assert button.get_attribute('aria-pressed')=='false'
        page.mouse.click(*point(.85))
        assert abs(page.evaluate('S.g')-.85*599)<=1
        button.click()
        assert button.get_attribute('aria-pressed')=='true'
        assert page.evaluate('document.activeElement.id')!='nl-timeline-lock'
        baseline=state()
        for frac in (.01,.5,.98):
            page.mouse.click(*point(frac))
            page.mouse.dblclick(*point(frac))
            page.touchscreen.tap(*point(frac))
        page.mouse.move(*point(.1));page.mouse.down()
        page.mouse.move(*point(.9),steps=4);page.mouse.up()
        assert state()==baseline
        # A pen press must not reach a target navigation handler either.
        page.evaluate("bar.addEventListener('pointerdown',()=>window.penPresses=(window.penPresses||0)+1)")
        page.dispatch_event('#bar','pointerdown',{'pointerType':'pen','button':0})
        assert page.evaluate('window.penPresses||0')==0
        print('PASS: native click seeks when unlocked; locked clicks, double clicks, drag, touch and pen do not seek')

        page.evaluate('show(228)')
        page.keyboard.press('d');assert page.evaluate('S.g')==229
        page.keyboard.press('a');assert page.evaluate('S.g')==228
        page.keyboard.press('Shift+d');assert page.evaluate('S.g')==238
        page.keyboard.press('Space');assert page.evaluate('S.playing')
        baseline=state();page.mouse.click(*point(.1));assert state()==baseline
        page.keyboard.press('Space');assert not page.evaluate('S.playing')
        page.locator('#labList li[data-g="240"]').click()
        assert page.evaluate('S.g')==240
        releases=page.evaluate('window.releases')
        page.locator('#view').hover();page.mouse.down()
        page.mouse.move(*point(.7));page.mouse.up()
        assert page.evaluate('window.releases')==releases+1
        assert page.evaluate('S.g')==240
        print('PASS: A/D/Shift+D, Space, sidebar selection and annotation mouse-release cleanup still work while locked')

        page.reload();install()
        assert button.get_attribute('aria-pressed')=='true'
        baseline=state();page.mouse.click(*point(.9));assert state()==baseline
        button.focus();page.keyboard.press('Enter')
        assert button.get_attribute('aria-pressed')=='false'
        baseline=state();page.keyboard.press('Space')
        assert button.get_attribute('aria-pressed')=='true' and state()==baseline
        button.click()  # Mouse activation returns focus to viewer shortcuts.
        assert button.get_attribute('aria-pressed')=='false'
        page.mouse.click(*point(.2));assert abs(page.evaluate('S.g')-.2*599)<=1
        page.reload();install()
        assert button.get_attribute('aria-pressed')=='false'
        print('PASS: lock/unlock persist across reload; focused button supports Enter/Space without toggling playback')

        for width in (860,1500,1200):
            page.set_viewport_size({'width':width,'height':820})
            page.wait_for_function('bar.width===Math.round(bar.clientWidth*devicePixelRatio)')
            assert_layout()
        page.evaluate('bar.hidden=true')
        page.wait_for_selector('#nl-timeline-controls',state='hidden')
        page.evaluate('bar.hidden=false')
        page.wait_for_selector('#nl-timeline-lock')
        assert_layout()
        page.add_script_tag(content=SCRIPT)
        assert page.locator('#nl-timeline-controls').count()==1
        assert page.locator('#nl-timeline-lock').count()==1
        print('PASS: button stays beside timeline at different widths/high DPI; hidden timeline hides controls; no duplicate installation')

        page.add_init_script("Object.defineProperty(window,'localStorage',{get(){throw new Error('Storage blocked');}})")
        page.reload();install()
        button.click();assert button.get_attribute('aria-pressed')=='true'
        baseline=state();page.mouse.click(*point(.9));assert state()==baseline
        button.click();assert button.get_attribute('aria-pressed')=='false'
        assert not errors,errors
        browser.close()
        print('PASS: storage failure does not prevent locking or unlocking')


if __name__=='__main__':
    main()
