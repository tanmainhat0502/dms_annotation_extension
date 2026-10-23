"""Keep bbox drags continuous when handles cross the image boundary."""
import copy
from pathlib import Path

from playwright.sync_api import sync_playwright

from _ext import read_organizer_script
from test_bbox_edges import HTML, NATIVE, native_file
from test_bbox_shortcuts import LABELS

ROOT = Path(__file__).resolve().parents[1]

# Standalone native mouse contract; the saved viewer supplies the real handlers
# when available. In both cases only the canvas handles mousemove, as in DMS.
if not native_file.exists():
    NATIVE = """
function canvasPt(e){const r=view.getBoundingClientRect();return [(e.clientX-r.left)*view.width/r.width,(e.clientY-r.top)*view.height/r.height];}
function handlePts([l,t,r,b]){return [[l,t],[r,t],[l,b],[r,b],[(l+r)/2,t],[(l+r)/2,b],[l,(t+b)/2],[r,(t+b)/2]];}
function hitTest(p){
  const s=view.width/S.sess.src_w,tol=9*view.width/view.getBoundingClientRect().width;
  for(let n=0;n<ED.items.length;n++){
    const points=handlePts(ED.items[n].box.map(v=>v*s));
    for(let corner=0;corner<8;corner++)if(points[corner].every((v,i)=>Math.abs(v-p[i])<=tol))return {n,corner};
  }
  const n=ED.items.findIndex(it=>p[0]>=it.box[0]*s&&p[0]<=it.box[2]*s&&p[1]>=it.box[1]*s&&p[1]<=it.box[3]*s);
  return n<0?null:{n,corner:-1};
}
view.addEventListener('mousedown',e=>{
  if(e.button!==0||!edActive()||ED.poly.length)return;
  const p=canvasPt(e),h=hitTest(p);if(!h)return;
  ED.sel=h.n;ED.selSet.clear();ED.drag={...h,p0:p,box0:ED.items[h.n].box.slice(),moved:false};
  e.preventDefault();lsTouch();edRepaint();
});
view.addEventListener('mousemove',e=>{
  if(!edActive()||!ED.drag)return;
  ED.mouse=canvasPt(e);const d=ED.drag,s=view.width/S.sess.src_w;
  const dx=(ED.mouse[0]-d.p0[0])/s,dy=(ED.mouse[1]-d.p0[1])/s,b=d.box0.slice(),c=d.corner;
  if(c<0){b[0]+=dx;b[2]+=dx;b[1]+=dy;b[3]+=dy;}
  else if(c===4)b[1]+=dy;else if(c===5)b[3]+=dy;else if(c===6)b[0]+=dx;else if(c===7)b[2]+=dx;
  else{b[c===0||c===2?0:2]+=dx;b[c===0||c===1?1:3]+=dy;}
  ED.items[d.n].box=[Math.min(b[0],b[2]),Math.min(b[1],b[3]),Math.max(b[0],b[2]),Math.max(b[1],b[3])];
  d.moved=true;edRepaint();
});
window.addEventListener('mouseup',()=>{if(ED.drag?.moved)edSave();ED.drag=null;});
"""


def main():
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True)
        page = browser.new_page(viewport={'width': 1200, 'height': 850})
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.route('**/*', lambda route: route.fulfill(body=HTML, content_type='text/html'))
        page.goto('https://ntt.dev.nota.ai/')
        page.add_script_tag(content=NATIVE)
        page.add_script_tag(content=read_organizer_script())
        page.wait_for_selector('#nota-labeling-organizer-v1')

        def reset(label='hand', box=None):
            page.evaluate('fixtureReset', label)
            page.evaluate('box=>{ED.items[0].box=box;ED.sel=0;}', box or [200, 150, 500, 600])
            return page.evaluate('ED.items')

        def point(coords):
            r = page.locator('#view').bounding_box()
            return r['x'] + coords[0]*r['width']/1000, r['y'] + coords[1]*r['height']/600

        def box_is(expected):
            actual = page.evaluate('ED.items[0].box')
            assert all(abs(a-b) < .01 for a,b in zip(actual, expected)), (actual, expected)

        # The reported bottom-right handle: every movement must update width,
        # including the moves just below the image, not only after re-entry.
        reset()
        page.mouse.move(*point([500, 590])); page.mouse.down()
        assert page.evaluate('ED.drag?.corner') == 3
        for x,y in [(520,590),(550,610),(580,620),(610,590),(640,610),(660,610)]:
            page.mouse.move(*point([x,y]))
            box_is([200,150,x,600+y-590])
        page.mouse.up()
        box_is([200,150,660,600])
        assert len(page.evaluate('saves')) == 1
        print('PASS: horizontal bottom-corner drag updates on every move across the image boundary')

        cases = [
            ([200,150,500,600], [500,610], [620,630], [200,150,620,620], [200,150,620,600]),
            ([200,0,500,450], [200,-10], [140,-30], [140,-20,500,450], [140,0,500,450]),
            ([0,150,500,450], [-10,450], [-30,500], [-20,150,500,500], [0,150,500,500]),
            ([200,150,1000,450], [1010,450], [1030,500], [200,150,1020,500], [200,150,1000,500]),
            ([200,150,500,600], [350,610], [400,640], [200,150,500,630], [200,150,500,600]),
            ([200,150,500,450], [350,300], [1000,650], [850,500,1150,800], [850,500,1000,600]),
        ]
        for transform in ('none', 'translate(12px,-8px) scale(1.25)'):
            page.locator('#view').evaluate('(el,t)=>el.style.transform=t', transform)
            for label in LABELS:
                for box,start,end,preview,saved in cases:
                    before = reset(label, box)
                    page.mouse.move(*point(start)); page.mouse.down()
                    assert page.evaluate('!!ED.drag'), (label, start, transform)
                    page.mouse.move(*point(end), steps=3)
                    box_is(preview)
                    assert len(page.evaluate('saves')) == 0, 'Do not save per pointer movement'
                    page.mouse.up()
                    box_is(saved)
                    expected = copy.deepcopy(before); expected[0]['box'] = saved
                    assert page.evaluate('saves') == [expected]
                    assert page.evaluate('ED.drag') is None
                    page.mouse.move(*point([400,300]))
                    assert page.evaluate('ED.items') == expected, 'Release must end the drag'
                    if label in ('body','hand','eye'):
                        page.keyboard.press('z')
                        page.wait_for_function('expected=>JSON.stringify(ED.items)===JSON.stringify(expected)', arg=before)
        print('PASS: 13 labels, outside handle starts, all image edges, box movement, zoom/pan, one save and undo')

        page.locator('#view').evaluate("el=>el.style.transform='none'")
        for setup in ('locked=true','RV_OPEN=true',"S.mode='review'", "S.labelSel=ED.lab='eye_lmk'",
                      "ED.lab='body'", "ED.key='segment:4'", 'S.g=2'):
            reset(); page.evaluate(setup)
            page.mouse.move(*point([500,610])); page.mouse.down()
            page.mouse.move(*point([650,620])); page.mouse.up()
            assert page.evaluate('saves.length') == 0, setup
            assert not page.evaluate('!!ED.drag'), setup
        for interruption in ('blur', 'pointercancel', 'lostpointercapture'):
            before = reset()
            page.mouse.move(*point([500,590])); page.mouse.down()
            page.mouse.move(*point([600,610]))
            page.evaluate("""kind=>{
              if(kind==='blur')window.dispatchEvent(new Event('blur'));
              else view.dispatchEvent(new PointerEvent(kind,{pointerId:1,bubbles:true}));
            }""", interruption)
            assert page.evaluate('ED.items') == before, interruption
            assert page.evaluate('ED.drag') is None, interruption
            page.mouse.up()
            assert page.evaluate('saves.length') == 0, interruption
        reset()
        page.locator('#stageAction').click()
        assert page.evaluate('window.actionClicks') == 1
        assert page.evaluate('saves.length') == 0
        page.mouse.click(*point([850,650]))
        assert not page.evaluate('!!ED.drag || !!ED.marq || ED.poly.length')
        assert page.evaluate('saves.length') == 0
        assert not errors, errors
        print('PASS: cancellation/focus loss, stale editor, locked/review/non-bbox contexts, controls and empty margin')
        browser.close()


if __name__ == '__main__':
    main()
