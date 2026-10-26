"""Eye 15pt keyboard shortcuts with native landmark editor behavior in Chromium."""
from _ext import read_organizer_script
from playwright.sync_api import sync_playwright


HTML = """<!doctype html><html><body>
<div id="labPane"><div id="labTitle">Labeling</div><div id="labList"></div></div>
<div id="lmkRef"></div><input id="text"><canvas id="view" width="400" height="200" style="width:400px;height:200px"></canvas>
<script>
const view=document.getElementById('view');
const one=x=>({pts:Array.from({length:15},(_,i)=>[x+i,50+i]),closed:false});
const S={mode:'label',labelSel:'eye_lmk',sess:{src_w:400,src_h:200,segments:[{name:'segment'}]},
  gen:1,g:2,shownG:2,lseq:[0,1,2,3],ledits:{},al:new Map(),ts:[0,1,2,3]};
const ED={key:'segment:2',lab:'eye_lmk',items:[],drag:null,marq:null,poly:[],sel:-1,selSet:new Set()};
const LM={n:0,k:0,addEye:false,drag:null,marq:null,poly:[],selSet:new Set(),sig:null};
let RV_OPEN=false,locked=false;
window.saves=[];window.nativeC=0;
function rvKey(g){return 'segment:'+g;}
function loc(g){return [0,g];}
function lmkActive(){return S.mode==='label'&&S.labelSel==='eye_lmk'&&!locked&&S.lseq.includes(S.shownG);}
function lmkCur(){return ED.items;}
function edSave(){const items=JSON.parse(JSON.stringify(ED.items));S.ledits[ED.key]={eye_lmk:items};window.saves.push(items);}
function edRepaint(){}
function lsTouch(){}
function lmkChanged(){edSave();lsTouch();LM.sig=null;edRepaint();}
function lmkPanel(){}
function lmkDraw(){}
function lmkToggleClosed(){if(!ED.items[LM.n])return;ED.items[LM.n].closed=!ED.items[LM.n].closed;lmkChanged();}
function lmkAddEyeAt(x,y){ED.items.push(one(x));LM.n=ED.items.length-1;LM.addEye=false;lmkChanged();}
function pause(){}
function show(g){S.g=S.shownG=g;ED.key=rvKey(g);ED.lab=S.labelSel;
  ED.items=JSON.parse(JSON.stringify(S.ledits[ED.key]?.eye_lmk||[]));LM.n=0;LM.k=0;LM.addEye=false;}
function reset(g=2,items=[]){document.querySelectorAll('dialog[open]').forEach(el=>el.close());
  document.activeElement?.blur();S.mode='label';S.labelSel='eye_lmk';S.gen=1;locked=false;RV_OPEN=false;
  S.ledits={'segment:0':{eye_lmk:[one(10)]},'segment:1':{eye_lmk:[]},'segment:2':{eye_lmk:items},'segment:3':{eye_lmk:[]}};
  window.saves=[];window.nativeC=0;show(g);}
view.addEventListener('mousedown',e=>{if(!lmkActive()||e.button!==0)return;
  if(LM.addEye||!ED.items.length){lmkAddEyeAt(e.offsetX,e.offsetY);return;}
  if(e.shiftKey){ED.items[LM.n].pts[0][0]+=5;lmkChanged();}
});
document.addEventListener('keydown',e=>{if(lmkActive()&&e.code==='KeyC'){
  window.nativeC++;lmkToggleClosed();}},true);
reset();
</script></body></html>"""


def main():
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True)
        page = browser.new_page()
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.route('**/*', lambda route: route.fulfill(body=HTML, content_type='text/html'))
        page.goto('https://ntt.dev.nota.ai/')
        page.add_script_tag(content=read_organizer_script())
        page.wait_for_selector('#nota-labeling-organizer-v1')

        def items():
            return page.evaluate('ED.items')

        page.evaluate('reset(2,[])')
        page.keyboard.press('n')
        assert page.evaluate('LM.addEye') is True
        page.locator('#view').click(position={'x': 200, 'y': 100})
        assert len(items()) == 1 and len(items()[0]['pts']) == 15
        page.keyboard.press('z')
        assert items() == [], 'Z undoes an eye created by N and a canvas click'
        page.evaluate('reset(2,[one(190)])')
        page.keyboard.press('n')
        page.locator('#view').click(position={'x': 195, 'y': 55})
        assert len(items()) == 2, 'Add mode must win over group dragging inside an existing eye box'
        page.keyboard.press('z')
        assert len(items()) == 1
        print('PASS: N creates a 15-point eye, including over an existing group; Z undoes creation')

        page.evaluate('reset(2,[one(10),one(100)])')
        page.evaluate('LM.n=1')
        page.keyboard.press('r')
        assert len(items()) == 1 and items()[0]['pts'][0][0] == 10
        page.keyboard.press('z')
        assert len(items()) == 2
        page.evaluate('LM.n=1')
        page.keyboard.press('Delete')
        assert len(items()) == 1 and items()[0]['pts'][0][0] == 10
        page.keyboard.press('z')
        assert len(items()) == 2
        page.keyboard.press('1')
        assert len(items()) == 1 and items()[0]['pts'][0][0] == 100
        page.keyboard.press('z')
        page.keyboard.press('2')
        assert len(items()) == 1 and items()[0]['pts'][0][0] == 10
        page.keyboard.press('z')
        page.keyboard.press('x')
        assert items() == []
        page.keyboard.press('z')
        assert len(items()) == 2
        print('PASS: R, Delete, 1/2, X and Z delete and restore the intended eye groups')

        page.evaluate('reset(2,[one(200)])')
        page.keyboard.press('c')
        page.wait_for_function('ED.items[0]?.pts[0][0]===10')
        assert page.evaluate('window.nativeC') == 0, 'C must not toggle Closed eye'
        page.keyboard.press('z')
        assert items()[0]['pts'][0][0] == 200
        page.keyboard.press('Alt+c')
        assert items()[0]['closed'] is True
        page.keyboard.press('z')
        assert not items()[0].get('closed')
        page.keyboard.press('Control+c')
        page.evaluate('show(3)')
        page.keyboard.press('Control+v')
        assert items()[0]['pts'][0][0] == 200
        page.keyboard.press('z')
        assert items() == []
        print('PASS: C skips empty frames; Alt+C toggles closed eyes; Ctrl+C/V and Z copy/undo')

        page.evaluate("""()=>{
          reset(2,[one(40),one(240)]);
          S.ledits['segment:3']={eye_lmk:[one(43),one(245)]};
          LM.n=0;
        }""")
        page.keyboard.press('Control+c')
        assert page.evaluate('window.__notaOrganizerV1.state.eyeClipboard.selected') == 0
        page.evaluate('show(3)')
        page.keyboard.press('Control+v')
        assert [eye['pts'][0][0] for eye in items()] == [40, 245], 'Left paste must keep right eye'
        page.keyboard.press('z')
        assert [eye['pts'][0][0] for eye in items()] == [43, 245], 'Undo must restore both eyes'

        page.evaluate("""()=>{
          reset(2,[one(40),one(240)]);
          S.ledits['segment:3']={eye_lmk:[one(43),one(245)]};
          LM.n=1;
        }""")
        page.keyboard.press('Control+c')
        page.evaluate('show(3)')
        page.keyboard.press('Control+v')
        assert [eye['pts'][0][0] for eye in items()] == [43, 240], 'Right paste must keep left eye'

        page.evaluate("""()=>{
          reset(2,[one(40),one(240)]);
          S.ledits['segment:3']={eye_lmk:[one(245)]};
          LM.n=0;
        }""")
        page.keyboard.press('Control+c')
        page.evaluate('show(3)')
        page.keyboard.press('Control+v')
        assert [eye['pts'][0][0] for eye in items()] == [245, 40], 'Missing left eye is added without deleting right'
        page.keyboard.press('Control+v')
        assert [eye['pts'][0][0] for eye in items()] == [245, 40], 'Repeated paste must not duplicate the eye'

        page.evaluate('reset(2,[one(40),one(240)]);LM.n=1')
        page.keyboard.press('Control+c')
        page.evaluate('show(3)')
        page.keyboard.press('Control+v')
        assert [eye['pts'][0][0] for eye in items()] == [240], 'Empty target receives only selected eye'
        page.evaluate('reset(2,[])')
        page.keyboard.press('Control+c')
        assert page.evaluate('window.__notaOrganizerV1.state.eyeClipboard') is None
        print('PASS: Ctrl+C/V copies only the selected eye, keeps the other, and supports undo')

        result = page.evaluate("""()=>{
          const merge=window.__notaOrganizerV1.mergeEyeLandmarks;
          const left=one(40), right=one(240), updatedLeft=one(45);
          return {
            rightOnly:merge([right],[updatedLeft],{sourceItems:[updatedLeft],selected:[0]},'selected'),
            both:merge([left,right],[updatedLeft],{sourceItems:[updatedLeft],selected:[0]},'selected'),
            rightSelected:merge([left],[left,one(245)],{sourceItems:[left,one(245)],selected:[1]},'selected')
          };
        }""")
        assert [item['pts'][0][0] for item in result['rightOnly']] == [240, 45], result
        assert [item['pts'][0][0] for item in result['both']] == [45, 240], result
        assert [item['pts'][0][0] for item in result['rightSelected']] == [40, 245], result
        print('PASS: selected-eye merge preserves the opposite eye, including one-eye targets')

        page.evaluate('reset(2,[one(50)])')
        page.locator('#view').click(position={'x': 180, 'y': 80}, modifiers=['Shift'])
        assert items()[0]['pts'][0][0] == 55
        page.keyboard.press('z')
        assert items()[0]['pts'][0][0] == 50
        for guard in ('locked=true', 'RV_OPEN=true', "ED.key='segment:1'", "S.mode='review'"):
            page.evaluate('reset(2,[one(50)])')
            page.evaluate(guard)
            page.keyboard.press('x')
            assert len(items()) == 1, guard
        page.evaluate('reset(2,[one(50)])')
        page.locator('#text').focus()
        page.keyboard.press('x')
        assert len(items()) == 1
        assert not errors, errors
        browser.close()
        print('PASS: native point edits undo; Done, modal, stale editor, review mode and typing guards hold')


if __name__ == '__main__':
    main()
