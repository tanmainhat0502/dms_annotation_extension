"""Large-list playback and cached Space playback with local DMS responses."""
from pathlib import Path
from urllib.parse import urlparse

from playwright.sync_api import sync_playwright

from _ext import read_organizer_script
from test_sidebar_scroll import HTML as SIDEBAR_HTML
from test_preload import HTML as CACHE_HTML

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = read_organizer_script()
PRELOAD = (ROOT/'extension/preload.js').read_text(encoding='utf-8')
PNG = (ROOT/'extension/icons/icon16.png').read_bytes()

# Standalone contracts; local runs additionally exercise the saved viewer's
# actual cache, playback loop and row-marking functions when available.
CACHE = CACHE_HTML[CACHE_HTML.index('function fkey(g)'):CACHE_HTML.index('</script>')]
PLAYBACK = """
function play(){if(S.playing)return;S.playing=true;S.tok++;resyncAt(S.g);loop(S.tok);}
function pause(){S.playing=false;S.tok++;}
async function loop(tok){
  const alive=()=>S.playing && tok===S.tok;
  while(alive()){
    const next=playNext(S.g,1);if(next===S.g){pause();break;}
    for(let k=0,g=next;k<AHEAD;k++){
      const ng=playNext(g,1);if(ng===g || S.inflight.size>=MAX_INFLIGHT)break;
      g=ng;if(!S.frames.has(fkey(g)))getFrame(g).catch(()=>{});
    }
    const bitmap=await getFrame(next);if(!alive())return;
    const wait=S.wall0+S.ts[next]-S.t0-performance.now();if(wait>1)await sleep(wait);
    if(!alive())return;S.g=S.shownG=next;S.bmp=bitmap;paint();drawBar();
  }
}
"""
MARK = """
function rvMarkLab(){
  if(S.mode==='label' && S.onlyTodo && S.lseq.some(g=>fsGet(g)==='done')){
    buildSeq();renderLabList();drawBar();return;
  }
  for(const li of document.querySelector('#labList').querySelectorAll('li')){
    const on=Number(li.dataset.g)===S.shownG;li.classList.toggle('cur',on);
    if(on)li.scrollIntoView({block:'nearest'});
  }
  lsBoxRender();r2Render();
}
"""
native_dir = ROOT.parent/'NOTA_LABEL/DMS Web Viewer_files'
if (native_dir/'app.js.download').exists():
    source=(native_dir/'app.js.download').read_text(encoding='utf-8')
    CACHE=source[source.index('function fkey(g)'):source.index('\nlet _hashT')]
    PLAYBACK=source[source.index('function play()'):source.index('\nfunction playNext(g, step)')]
if (native_dir/'review.js.download').exists():
    source=(native_dir/'review.js.download').read_text(encoding='utf-8')
    a=source.index('function rvMarkLab()')
    MARK=source[a:source.index('\nfunction renderFinal()',a)]

SETUP = """
const MAX_BITMAPS=240,MAX_INFLIGHT=6,AHEAD=8,SPEEDS=[.25,.5,1,2,3,5,10];
const enc=encodeURIComponent,$=id=>document.getElementById(id),sleep=ms=>new Promise(r=>setTimeout(r,ms));
Object.assign(S,{speedI:2,playing:false,tok:0,step10:true,clip:null,ts:Float64Array.from({length:S.G},(_,i)=>i*100)});
window.painted=[];window.pauseAt=-1;window.decodes=0;window.statusPaints=0;
function lsBoxRender(){window.statusPaints++;}
function r2Render(){}
function seqMode(){return false;}
function updPlayBtn(){}
function saveHash(){}
function saveHashSoon(){}
function resyncAt(g){S.wall0=performance.now();S.t0=S.ts[g];}
function msg(text){window.lastMessage=text;}
function nextG(g,dir,n=1){return Math.max(0,Math.min(S.G-1,g+dir*n));}
function playNext(g,step=1){return nextG(g,1,step);}
function paint(){
  if(S.bmp)document.querySelector('#view').getContext('2d').drawImage(S.bmp,0,0);
  if(S.mode==='label' || S.mode==='review2')rvMarkLab();
  window.painted.push({g:S.shownG,t:performance.now()});
  if(S.shownG===window.pauseAt)pause();
}
document.addEventListener('keydown',e=>{
  if(e.code==='Space' && !['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName)){
    e.preventDefault();S.playing ? pause() : play();
  }
});
"""


def fixture(count):
    group=count//4
    html=SIDEBAR_HTML.replace('G:600',f'G:{count}').replace('n:600',f'n:{count}')
    html=html.replace('g/150',f'g/{group}').replace('g%150',f'g%{group}')
    tracking='''window.nativeLoopCalls=0;const originalLoop=loop;
      loop=function(...args){window.nativeLoopCalls++;return originalLoop(...args);};'''
    return html.replace('</body>', '<div id="spin" hidden></div><script>'+'\n'.join([SETUP,CACHE,PLAYBACK,MARK,tracking])+'\n</script></body>')


def settle(page):
    page.evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))')


def open_page(browser,count):
    page=browser.new_page(viewport={'width':1200,'height':820})
    errors,requests=[],[]
    page.on('pageerror',lambda error:errors.append(str(error)))

    def route(r):
        path=urlparse(r.request.url).path
        if path=='/':r.fulfill(body=fixture(count),content_type='text/html')
        elif path=='/api/frame':
            requests.append(r.request.url)
            r.fulfill(body=PNG,content_type='image/png')
        else:raise AssertionError(f'Unexpected network request: {r.request.method} {path}')

    page.route('**/*',route);page.goto('https://ntt.dev.nota.ai/')
    assert not errors,errors
    page.add_script_tag(content=SCRIPT);page.wait_for_selector('.nl-organized');settle(page)
    return page,errors,requests


def test_large_list(browser):
    page,errors,requests=open_page(browser,12000)
    # A native cache hit can be immediate while DOM work still blocks playback.
    # Count enumerated sidebar nodes as well as reporting wall time; assertions
    # use operation counts so slow CI machines do not fail timing thresholds.
    result=page.evaluate('''async()=>{
      playNext(200,1);
      const original=Element.prototype.querySelectorAll;
      let enumerated=0;
      Element.prototype.querySelectorAll=function(...args){
        const result=original.apply(this,args);
        if(this.id==='labList' || this.closest('#labList'))enumerated+=result.length;
        return result;
      };
      const times=[];
      try{
        for(let i=0;i<30;i++){
          S.g=S.shownG=200+i;
          const start=performance.now();
          for(let k=0,g=S.g;k<9;k++)g=playNext(g,1);
          times.push(performance.now()-start);
          rvMarkLab();await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
        }
      }finally{Element.prototype.querySelectorAll=original;}
      return {enumerated,times,current:document.querySelector('#labList li.cur')?.dataset.g,statusPaints:window.statusPaints};
    }''')
    assert result['enumerated']<100,result
    assert result['current']=='229' and result['statusPaints']>=30
    assert not requests,requests
    values=sorted(result['times'])
    print(f"PASS: 12,000 frames, 30 playback iterations: {result['enumerated']} sidebar nodes enumerated; median lookahead {values[len(values)//2]:.2f} ms")

    page.locator('.nl-search').fill('Phone call');settle(page)
    assert page.evaluate('playNext(3000,10)')==3010
    assert page.evaluate('playNext(5999,1)')==5999
    # Hidden current frames retain the original all-list fallback.
    assert page.evaluate('playNext(2999,1)')==3000
    page.locator('.nl-search').fill('');settle(page)
    assert page.evaluate('playNext(5999,1)')==6000
    page.evaluate("S.lseq=Int32Array.from([10,20,30]);S.g=S.shownG=20;renderLabList()")
    settle(page)
    assert page.evaluate('playNext(20,1)')==30
    assert page.evaluate('playNext(30,1)')==30
    page.evaluate("S.labelSel='hand';S.gen++;S.lseq=Int32Array.from([40,50]);S.g=S.shownG=40;renderLabList()")
    settle(page)
    assert page.evaluate('playNext(40,1)')==50
    print('PASS: filtered playback and clip/list boundaries; list rebuild and label/session invalidation')

    # Retain native only-todo semantics and current status updates.
    page.evaluate("S.onlyTodo=true;S.fstat['segment:50']={hand:{s:'done'}};rvMarkLab()")
    settle(page)
    assert page.locator('#labList li[data-g="50"]').count()==0
    page.evaluate("S.fstat['segment:50']={hand:{s:'wip'}};fsRender()")
    settle(page)
    assert page.locator('#labList li[data-g="50"]').count()==1
    assert not errors,errors
    page.close()
    print('PASS: Done removes rows under only-todo; status rollback/rebuild restores them')


def test_cached_space(browser):
    page,errors,requests=open_page(browser,32)
    page.add_script_tag(content=PRELOAD)
    page.locator('#start_auto_load').click()
    page.wait_for_function("document.querySelector('.nl-load-count').textContent==='Ready 16 / 16 images'")
    assert page.evaluate('S.frames.size')==0
    page.evaluate('show(0)')
    # Organized/filtered rows need not have evenly spaced source timestamps.
    # The native wall-clock loop pauses at gaps, then paints duplicate timestamps
    # together, even though every image is already downloaded.
    page.evaluate('''window.painted=[];window.pauseAt=6;
      S.ts.set([0,100,600,600,700,1000,1100]);''')
    page.locator('#start_auto_load').evaluate('el=>el.blur()')
    before=len(requests)
    page.keyboard.press('Space')
    page.wait_for_function('S.shownG===6 && !S.playing && S.inflight.size===0')
    assert len(requests)==before,(before,len(requests))
    assert page.evaluate('window.painted.map(p=>p.g)')==[1,2,3,4,5,6]
    assert page.locator('#labList li.cur').get_attribute('data-g')=='6'
    assert page.evaluate('S.frames.size')<=16
    intervals=page.evaluate('painted.slice(1).map((p,i)=>p.t-painted[i].t)')
    assert min(intervals)>70 and max(intervals)<250,intervals
    assert not errors,errors
    page.close()
    print(f'PASS: cached Space playback stays evenly paced across timestamp gaps/repeats ({[round(t) for t in intervals]} ms); no additional image requests')


def test_playback_stall(browser):
    page,errors,requests=open_page(browser,64)
    page.evaluate('''async()=>{
      await Promise.all(Array.from({length:20},(_,g)=>getFrame(g)));
      await show(0);window.painted=[];window.pauseAt=7;
      const originalPaint=paint;
      paint=function(){
        originalPaint();
        if(S.shownG===2){const end=performance.now()+230;while(performance.now()<end){}}
      };
    }''')
    before=len(requests)
    page.keyboard.press('Space')
    page.wait_for_function('S.shownG===7 && !S.playing')
    frames=page.evaluate('painted')
    assert [p['g'] for p in frames]==list(range(1,8)),frames
    intervals=[b['t']-a['t'] for a,b in zip(frames,frames[1:])]
    assert min(intervals)>70,intervals
    assert len(requests)==before,(before,len(requests))
    assert not errors,errors
    page.close()
    print(f'PASS: a 230 ms render stall does not cause catch-up bursts ({[round(t) for t in intervals]} ms)')


def test_pending_playback(browser):
    page,errors,requests=open_page(browser,64)
    page.evaluate('''async()=>{
      await show(0);window.painted=[];window.frameRequests=[];window.maxInflight=0;
      const gate=new Promise(r=>window.releaseImage=r),nativeGet=getFrame;
      getFrame=function(g){
        frameRequests.push(g);
        const pending=nativeGet(g);
        maxInflight=Math.max(maxInflight,S.inflight.size);
        return g===1 ? pending.then(b=>gate.then(()=>b)) : pending;
      };
    }''')
    page.keyboard.press('Space')
    page.wait_for_function('frameRequests.length>=4')
    assert page.evaluate('frameRequests.slice(0,4)')==[1,2,3,4]
    assert page.evaluate('maxInflight')<=4
    # Pause a pending decode; start another run before the old result arrives.
    page.keyboard.press('Space')
    page.evaluate('show(8)')
    page.evaluate('window.painted=[];window.pauseAt=12')
    page.keyboard.press('Space')
    page.evaluate('releaseImage()')
    page.wait_for_function('S.shownG===12 && !S.playing')
    assert page.evaluate('painted.map(p=>p.g)')==[9,10,11,12]
    assert page.evaluate('nativeLoopCalls')==0

    # Scope switches invalidate images already being decoded. Returning to
    # review mode still uses the original player rather than the label cadence.
    page.evaluate('''async()=>{
      await show(0);window.painted=[];
      const gate=new Promise(r=>window.releaseScopeImage=r),nativeGet=getFrame;
      getFrame=g=>g===1 ? nativeGet(g).then(b=>gate.then(()=>b)) : nativeGet(g);
    }''')
    page.keyboard.press('Space')
    page.evaluate("S.labelSel='hand';S.gen++;releaseScopeImage()")
    page.wait_for_function('!S.playing')
    assert page.evaluate('painted.length')==0
    page.evaluate("S.mode='review';window.pauseAt=2")
    page.keyboard.press('Space')
    page.wait_for_function('S.shownG===2 && !S.playing')
    assert page.evaluate('nativeLoopCalls')==1
    assert not errors,errors
    page.close()
    print('PASS: next image requested first, at most four foreground loads; pause/resume and scope changes reject stale images; review playback stays native')


def test_playback_speed_and_filters(browser):
    page,errors,requests=open_page(browser,64)
    page.evaluate('''async()=>{
      await Promise.all(Array.from({length:20},(_,g)=>getFrame(g)));
      S.lseq=Int32Array.from([0,4,8,12]);renderLabList();await show(0);
      window.painted=[];window.pauseAt=-1;S.speedI=1;
    }''')
    settle(page)
    page.keyboard.press('Space')
    page.wait_for_function('S.shownG===4')
    page.evaluate('S.speedI=3;resyncAt(S.g)')
    page.wait_for_function('!S.playing')
    frames=page.evaluate('painted')
    assert [p['g'] for p in frames]==[4,8,12],frames
    assert 25<frames[-1]['t']-frames[-2]['t']<180,frames
    # At high speed retain native frame stepping (3x advances two rows).
    page.evaluate('''async()=>{
      buildSeq();renderLabList();await show(0);window.painted=[];window.pauseAt=8;S.speedI=4;
    }''')
    settle(page)
    page.keyboard.press('Space')
    page.wait_for_function('S.shownG===8 && !S.playing')
    assert page.evaluate('painted.map(p=>p.g)')==[2,4,6,8]
    assert not errors,errors
    page.close()
    print('PASS: sparse filtered lists play evenly and stop at their end; speed changes and high-speed stepping work')


def test_playback_retarget_and_retry(browser):
    page,errors,requests=open_page(browser,32)
    page.evaluate('''async()=>{
      await show(0);window.painted=[];window.pauseAt=8;window.waiting=false;
      const nativeGet=getFrame,gate=new Promise(r=>window.releaseImage=r);
      getFrame=function(g){
        const pending=nativeGet(g);
        if(g!==1)return pending;
        window.waiting=true;return pending.then(b=>gate.then(()=>b));
      };
    }''')
    page.keyboard.press('Space')
    page.wait_for_function('waiting')
    page.evaluate('S.lseq=Int32Array.from([0,4,8]);renderLabList();releaseImage()')
    page.wait_for_function('S.shownG===8 && !S.playing')
    assert page.evaluate('painted.map(p=>p.g)')==[4,8]
    assert not errors,errors
    page.close()

    page,errors,requests=open_page(browser,32)
    failures=[]

    def fail_once(route):
        if '&i=1&' in route.request.url and not failures:
            failures.append(route.request.url)
            route.fulfill(status=503,body='Local test: image unavailable')
        else:route.fallback()

    page.route('**/api/frame?*',fail_once)
    page.evaluate('show(0)')
    page.evaluate('window.painted=[];window.pauseAt=2')
    page.keyboard.press('Space')
    page.wait_for_function('!S.playing && window.lastMessage?.includes("retry")')
    assert page.evaluate('[S.g,S.shownG,painted.length]')==[0,0,0]
    page.keyboard.press('Space')
    page.wait_for_function('S.shownG===2 && !S.playing')
    assert page.evaluate('painted.map(p=>p.g)')==[1,2]
    assert len(failures)==1 and not errors,(failures,errors)
    page.close()
    print('PASS: filtering during a pending image uses the new list; a failed image pauses and Space retries without skipping')


def test_cached_bbox_filter_playback(browser):
    page,errors,requests=open_page(browser,64)
    page.evaluate('''() => {
      for(let g=0;g<S.G;g++)S.ledits[rvKey(g)]={body:
        Array.from({length:g%4},(_,i)=>({box:[i,i,i+5,i+5]}))};
    }''')
    page.locator('#nl-bbox-counts').fill('2')
    page.wait_for_function("document.querySelector('.nl-bbox-status').textContent==='16/64 frames'")
    page.add_script_tag(content=PRELOAD)
    page.locator('#start_auto_load').click()
    page.wait_for_function("document.querySelector('.nl-load-count').textContent==='Ready 8 / 8 images'")
    before=len(requests)
    page.evaluate('window.painted=[];window.pauseAt=6')
    page.locator('#start_auto_load').evaluate('el=>el.blur()')
    # Current frame 0 is hidden by the new BBox filter. Space must resume at
    # the nearest matching row and use its cached lookahead, not the old list.
    page.keyboard.press('Space')
    page.wait_for_function('S.shownG===6 && !S.playing && S.inflight.size===0')
    assert page.evaluate('painted.map(p=>p.g)')==[2,6]
    assert len(requests)==before,(before,len(requests))
    assert page.evaluate('painted[1].t-painted[0].t')>70
    # Reconfigure both the filter and two-part preloader, then resume from a
    # frame hidden by the new count. Forward playback must not jump backward.
    page.locator('#nl-bbox-counts').fill('1')
    page.wait_for_function("document.querySelector('.nl-load-count').textContent==='Ready 8 / 8 images' && S.inflight.size===0")
    page.locator('#nl-bbox-counts').evaluate('el=>el.blur()')
    page.evaluate('window.painted=[];window.pauseAt=13')
    page.keyboard.press('Space')
    page.wait_for_function('S.shownG===13 && !S.playing')
    assert page.evaluate('painted.map(p=>p.g)')==[9,13]
    assert not errors,errors
    page.close()
    print('PASS: BBox-filtered cached Space playback follows matching rows, including after changing counts from a hidden frame')


def main():
    with sync_playwright() as pw:
        browser=pw.chromium.launch(headless=True)
        try:
            test_large_list(browser)
            test_cached_space(browser)
            test_playback_stall(browser)
            test_pending_playback(browser)
            test_playback_speed_and_filters(browser)
            test_playback_retarget_and_retry(browser)
            test_cached_bbox_filter_playback(browser)
        finally:browser.close()


if __name__=='__main__':main()
