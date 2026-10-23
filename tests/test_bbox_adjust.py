"""Regression: small nose edge drag, 200 versus end on a 69-frame clip."""
import copy
from pathlib import Path

from playwright.sync_api import sync_playwright

from _ext import read_organizer_script
from test_bbox_edges import HTML
from test_bbox_drag import NATIVE
from test_bbox_shortcuts import LABELS

ROOT = Path(__file__).resolve().parents[1]
SETUP = """
function fsGet(g){return g===12?'done':'wip';}
function clipAt(g){return {cat:g<69?'other':'next',n:g<69?1:2};}
function setupAdjust(label='nose'){
  fixtureReset(label);S.g=S.shownG=0;ED.key=rvKey(0);S.lseq=Array.from({length:72},(_,i)=>i);
  S.ts=S.lseq;S.ledits={};S.review={};
  const cls=OBJ_LABELS.includes(label)?{cls:label}:{};
  for(const g of S.lseq){
    S.review[rvKey(g)]={i:g,labels:[label]};
    // A small box moves more than its width, and changes size through the clip.
    S.ledits[rvKey(g)]={[label]:[{box:[400+g*2,250+g%5*5,440+g*3,300+g%7*5],...cls}]};
  }
  ED.items=JSON.parse(JSON.stringify(S.ledits[ED.key][label]));ED.sel=0;ED.poly=[];
  document.querySelector('#labList').innerHTML='<div class="grp"><div class="vlab">Other</div><ul>'+
    S.lseq.map(g=>`<li data-g="${g}" class="${g===0?'cur':''}"><span class="fs ${fsGet(g)}"></span>
    <span class="name"><b class="no">#${g<69?'01':'02'}</b> ${label}<span class="tm">00:00:00</span></span></li>`).join('')+'</ul></div>';
}
"""


def main():
    with sync_playwright() as pw:
        browser=pw.chromium.launch(headless=True)
        page=browser.new_page(viewport={'width':1200,'height':850})
        errors,posts=[],[]
        page.on('pageerror',lambda error:errors.append(str(error)))
        def route(request):
            if '/api/' in request.request.url:
                assert request.request.url.endswith('/api/label_edit'), request.request.url
                posts.append(request.request.post_data_json)
                request.fulfill(body='{}',content_type='application/json')
            else:
                request.fulfill(body=HTML,content_type='text/html')
        page.route('**/*',route)
        page.goto('https://ntt.dev.nota.ai/')
        page.add_script_tag(content=NATIVE)
        page.add_script_tag(content=SETUP)
        source=read_organizer_script().replace(
            '  function bboxEdgeGeometry(event) {',
            '  window.adjustTest={state};\n  function bboxEdgeGeometry(event) {')
        page.add_script_tag(content=source)
        page.wait_for_selector('#nota-labeling-organizer-v1')

        def point(coords):
            r=page.locator('#view').bounding_box()
            return r['x']+coords[0]*r['width']/1000,r['y']+coords[1]*r['height']/600

        def edit(coord,value):
            b=page.evaluate('ED.items[0].box')
            start={0:[b[0],(b[1]+b[3])/2],1:[(b[0]+b[2])/2,b[1]],
                   2:[b[2],(b[1]+b[3])/2],3:[(b[0]+b[2])/2,b[3]]}[coord]
            page.mouse.dblclick(*point(start))
            assert page.evaluate('adjustTest.state.bboxEdgePatch?.coord')==coord
            page.mouse.move(*point(start));page.mouse.down()
            end=start[:];end[coord%2]=value
            # Deliberate sideways drift must not resize another edge, even
            # during the preview on this 16-screen-pixel-wide nose box.
            end[1-coord%2]+=10
            page.mouse.move(*point(end),steps=3)
            expected=b[:];expected[coord]=value
            actual=page.evaluate('ED.items[0].box')
            assert actual==expected, ('Edge drag changed an unselected edge during preview',label,coord,b,start,end,actual,expected)
            page.mouse.up()
            assert page.evaluate('ED.items[0].box')==expected

        def apply(count):
            posts.clear()
            page.keyboard.press('Control+b')
            page.wait_for_selector('#nl-eye-bulk[open]')
            page.locator('#nl-eye-bulk [data-bulk-tab="status"]').click()
            page.locator('#nl-eye-bulk [data-bulk-tab="label"]').click()
            assert 'Adjust the' in page.locator('#nl-eye-bulk .nl-label-panel h2').inner_text()
            page.locator('#nl-eye-bulk [data-eye-direction="after"]').click()
            page.locator('#nl-eye-bulk .nl-count').fill(count)
            page.locator('#nl-eye-bulk .nl-apply').click()
            page.wait_for_selector('#nl-eye-bulk[open]',state='hidden')

        for label in ['nose']:
            page.evaluate('setupAdjust',label)
            page.wait_for_selector('.nl-clip li[data-g="68"]',state='attached')
            before=page.evaluate('S.ledits')
            for coord,value in [(1,220),(1,210)]:
                edit(coord,value)
                apply('200' if coord==1 and value==220 else 'end')
                expected=copy.deepcopy(before)
                for g in range(1,69):
                    if g!=12: expected[f'segment:{g}'][label][0]['box'][coord]=value
                for g in range(1,72):
                    actual=page.evaluate('(g)=>S.ledits[rvKey(g)]',g)
                    assert actual==expected[f'segment:{g}'], (label,coord,g,actual,expected[f'segment:{g}'])
                    assert len(actual[label])==1, (label,coord,g,'duplicate bbox',actual)
                assert sorted(post['i'] for post in posts)==[g for g in range(1,69) if g!=12]
                assert len({post['i'] for post in posts})==len(posts)
                before=expected
            # Reapply the same edge: no requests, no new boxes, no pointless undo.
            snapshot=page.evaluate('S.ledits');undo_count=page.evaluate('adjustTest.state.bboxUndo.length')
            apply('200')
            assert not posts
            assert page.evaluate('S.ledits')==snapshot
            assert page.evaluate('adjustTest.state.bboxUndo.length')==undo_count
        print('PASS: small nose edge-only preview; repeated adjustment; 200/end within 69 frames; Done/next-clip guards; no duplicates or unchanged saves')
        assert not errors,errors
        browser.close()


if __name__=='__main__':
    main()
