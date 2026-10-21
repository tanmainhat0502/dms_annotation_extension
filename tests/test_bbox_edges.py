"""Exercise all bbox edge gestures, bulk saves and undo in Chromium with local responses."""
import copy
from pathlib import Path

from playwright.sync_api import sync_playwright

from test_bbox_boundary import HTML as BOUNDARY_HTML
from test_bbox_shortcuts import LABELS

ROOT = Path(__file__).resolve().parents[1]
SETUP = """
const view=document.querySelector('#view'),ctx=view.getContext('2d');
const OBJ_LABELS=['cigarette','e_cigarette','phone','can','bottle'];
const VZ={pan:null,z:1};
function pause(){}
function edDraw(){}
function edRepaint(){edDraw();}
function flash(message){window.lastMessage=message;}
function loc(g){return [0,g];}
function segPfx(){return 'test/';}
function fsGet(g){return g===3 ? 'done' : 'wip';}
function clipAt(g){return {cat:'other',n:g<5 ? 1 : 2};}
function edSave(){
  const items=JSON.parse(JSON.stringify(ED.items));
  window.saves.push(items);S.ledits[ED.key]={[S.labelSel]:items};
}
function fixtureReset(label='head'){
  reset(label);S.gen++;S.sess={src_w:1000,src_h:600,bucket:'fixture',segments:[{name:'segment'}]};
  S.g=S.shownG=1;S.lseq=[0,1,2,3,4,5];S.ts=S.lseq;S.ledits={};S.review={};
  ED.key=rvKey(1);ED.sel=-1;ED.poly=[];
  const cls=OBJ_LABELS.includes(label) ? {cls:label} : {};
  ED.items=[{box:[200,150,500,450],...cls},{box:[650,100,850,450],...cls}];
  for(const g of S.lseq){
    S.review[rvKey(g)]={i:g,labels:[label]};
    S.ledits[rvKey(g)]={[label]:JSON.parse(JSON.stringify(ED.items))};
  }
  S.ledits[rvKey(0)][label]=[];
  S.ledits[rvKey(2)][label][0].box=[205,155,505,455];
  document.querySelector('#labList').innerHTML='<div class="grp"><div class="vlab">Other</div><ul>'+
    S.lseq.map(g=>`<li data-g="${g}" class="${g===1 ? 'cur' : ''}"><span class="fs ${fsGet(g)}"></span>
      <span class="name"><b class="no">#${g<5 ? '01' : '02'}</b> ${label}<br><span class="tm">00:00:0${g}</span></span></li>`).join('')+'</ul></div>';
}
fixtureReset();
"""
HTML = BOUNDARY_HTML.replace('</body>', '<script>'+SETUP+'</script></body>')

# Minimal native drag contract for standalone runs. Use the original viewer's
# hit testing and mouse handlers as well when its saved source is available.
NATIVE = """
view.addEventListener('mousedown',e=>{
  if(!edActive() || e.button!==0) return;
  const r=view.getBoundingClientRect(),x=(e.clientX-r.left)*1000/r.width,y=(e.clientY-r.top)*600/r.height;
  const [l,t,rgt,b]=ED.items[0].box;
  const handles=[[(l+rgt)/2,t,1],[(l+rgt)/2,b,3],[l,(t+b)/2,0],[rgt,(t+b)/2,2]];
  const h=handles.find(h=>Math.hypot(h[0]-x,h[1]-y)<20);
  if(h) ED.drag={n:0,coord:h[2],box0:ED.items[0].box.slice(),moved:false};
});
view.addEventListener('mousemove',e=>{
  if(!edActive() || !ED.drag) return;
  const r=view.getBoundingClientRect(),d=ED.drag;
  ED.items[d.n].box[d.coord]=d.coord%2 ? (e.clientY-r.top)*600/r.height : (e.clientX-r.left)*1000/r.width;
  d.moved=true;edRepaint();
});
window.addEventListener('mouseup',()=>{
  if(ED.drag?.moved) edSave();ED.drag=null;edRepaint();
});
"""
native_file = ROOT.parent / 'NOTA_LABEL/DMS Web Viewer_files/editor.js.download'
if native_file.exists():
    native = native_file.read_text(encoding='utf-8')
    a = native.index('function handlePts')
    handles = native[a:native.index('\n}', a)+2]
    a = native.index('function canvasPt')
    geometry = native[a:native.index('let _raf', a)]
    a = native.index('window.addEventListener("mousemove"', native.index('let _raf'))
    NATIVE = handles + '\n' + geometry + '\n' + native[a:native.index('document.addEventListener("keydown"', a)]

EDGES = [('top', 1, [350,150], [350,110]), ('bottom', 3, [350,450], [350,490]),
         ('left', 0, [200,300], [160,300]), ('right', 2, [500,300], [540,300])]


def main():
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True)
        page = browser.new_page(viewport={'width':1200,'height':850})
        errors, posts = [], []
        page.on('pageerror', lambda error: errors.append(str(error)))

        def route(request):
            if '/api/' in request.request.url:
                assert request.request.url.endswith('/api/label_edit'), request.request.url
                posts.append(request.request.post_data_json)
                request.fulfill(body='{}', content_type='application/json')
            else:
                request.fulfill(body=HTML, content_type='text/html')

        page.route('**/*', route)
        page.goto('https://ntt.dev.nota.ai/')
        page.add_script_tag(content=NATIVE)
        source = (ROOT/'extension/content.js').read_text(encoding='utf-8')
        # Observe operation scope without replacing production event handlers.
        source = source.replace('  function bboxEdgeGeometry(event) {',
            '  window.edgeTest={state,bboxEdgePatchMatches,quickOperationMatches};\n  function bboxEdgeGeometry(event) {')
        page.add_script_tag(content=source)
        page.wait_for_selector('#nota-labeling-organizer-v1')

        def reset(label='head'):
            page.evaluate('fixtureReset', label)
            page.wait_for_selector('.nl-clip li[data-g="1"]', state='attached')
            posts.clear()

        def point(coords):
            rect=page.locator('#view').bounding_box()
            return rect['x']+coords[0]*rect['width']/1000, rect['y']+coords[1]*rect['height']/600

        def edit(edge):
            _, coord, start, end=edge
            page.mouse.dblclick(*point(start))
            assert page.evaluate('edgeTest.state.bboxEdgePatch?.coord') == coord
            page.mouse.move(*point(start));page.mouse.down()
            page.mouse.move(*point(end), steps=3);page.mouse.up()
            assert page.evaluate('edgeTest.state.bboxEdgePatch?.ready') is True
            assert page.evaluate('edgeTest.quickOperationMatches()') is True

        def apply(direction='after'):
            page.keyboard.press('Control+b')
            page.wait_for_selector('#nl-eye-bulk[open]')
            page.locator(f'#nl-eye-bulk [data-eye-direction="{direction}"]').click()
            page.locator('#nl-eye-bulk .nl-count').fill('end')
            page.locator('#nl-eye-bulk .nl-apply').click()
            page.wait_for_selector('#nl-eye-bulk[open]', state='hidden')

        def undo():
            page.keyboard.press('z')
            page.wait_for_function('!edgeTest.state.operationBusy')

        for label in LABELS:
            for edge in EDGES:
                reset(label)
                before=page.evaluate('ED.items')
                targets=page.evaluate('S.ledits')
                edit(edge)
                expected=copy.deepcopy(before)
                expected[0]['box'][edge[1]]=edge[3][edge[1]%2]
                assert page.evaluate('ED.items') == expected, (label, edge)
                assert page.evaluate('window.saves.at(-1)') == expected
                apply()
                assert sorted(p['i'] for p in posts) == [2,4], posts
                for post in posts:
                    target=copy.deepcopy(targets[f"segment:{post['i']}"][label])
                    target[0]['box'][edge[1]]=expected[0]['box'][edge[1]]
                    assert post['items'] == target and post['label']==label, (label,edge,post,target)
                undo()
                assert page.evaluate('S.ledits["segment:2"][S.labelSel]') == targets['segment:2'][label]
                assert page.evaluate('S.ledits["segment:4"][S.labelSel]') == targets['segment:4'][label]
                undo()
                assert page.evaluate('ED.items') == before, (label,edge)
        print('PASS: 13 bbox labels x 4 edges; native drag/save, Ctrl+B, other edges/boxes/classes preserved, Done and clip boundary, batch/source undo')

        reset('phone');edit(EDGES[0])
        apply('before')
        assert posts==[], posts
        assert page.evaluate('S.ledits["segment:0"].phone') == []
        page.locator('#view').evaluate("el=>el.style.transform='translate(12px,-8px) scale(1.25)'")
        reset('face_mask');edit(EDGES[3])
        assert page.evaluate('ED.items[0].box') == [200,150,540,450]
        page.locator('#view').evaluate("el=>el.style.transform='none'")
        print('PASS: missing target stays missing without duplicate; zoom/pan edge selection')

        for label in ('face_lmk','eye_lmk','seatbelt'):
            reset(label);page.mouse.dblclick(*point([350,150]))
            assert not page.evaluate('edgeTest.bboxEdgePatchMatches()'), label
        for setup in ('locked=true','RV_OPEN=true',"ED.lab='body'", "ED.key='segment:4'", "S.mode='review'"):
            reset();page.evaluate(setup);page.mouse.dblclick(*point([350,150]))
            assert not page.evaluate('edgeTest.state.bboxEdgePatch?.generation===S.gen'), setup
        for change in ("S.labelSel=ED.lab='face'",'S.gen++','S.sess={...S.sess}',"S.g=S.shownG=2;ED.key=rvKey(2)"):
            reset();edit(EDGES[0]);page.evaluate(change)
            assert not page.evaluate('edgeTest.bboxEdgePatchMatches()'), change
            assert not page.evaluate('edgeTest.quickOperationMatches()'), change
        reset();page.mouse.dblclick(*point([350,150]))
        assert not page.evaluate('edgeTest.state.bboxEdgePatch.ready')
        assert not page.evaluate('edgeTest.quickOperationMatches()')
        assert not errors, errors
        browser.close()
        print('PASS: landmarks/masks, locked/review/stale editor, label/session/frame scope and no-op double click')


if __name__ == '__main__':
    main()
