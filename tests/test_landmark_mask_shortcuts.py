"""Face 7pt and seatbelt keyboard shortcuts against a small native-editor fixture."""
from _ext import read_organizer_script
from test_eye_shortcuts import HTML as EYE_HTML

from playwright.sync_api import sync_playwright


EXTRA = """<script>
lmkActive=function(){return S.mode==='label'&&['eye_lmk','face_lmk'].includes(S.labelSel)&&
  !locked&&S.lseq.includes(S.shownG);};
edSave=function(){const items=JSON.parse(JSON.stringify(ED.items));
  (S.ledits[ED.key]=S.ledits[ED.key]||{})[S.labelSel]=items;window.saves.push(items);};
const face=x=>({pts:Array.from({length:7},(_,i)=>[x+i,20+i])});
const BT={key:null,W:4,H:4,mask:new Uint8Array(16),sel:new Uint8Array(16),undo:[],
  mode:'box',prev:null,busy:false,points:[],poly:[],drag:null};
function beltActive(){return S.mode==='label'&&S.labelSel==='seatbelt'&&!locked;}
function beltLoad(){return BT.key===rvKey(S.shownG)&&!!BT.mask;}
function beltChanged(){S.ledits[BT.key]={seatbelt:[{rle:{size:[4,4],counts:rle(BT.mask)}}]};
  window.saves.push(Array.from(BT.mask));}
function beltUndo(){BT.mask=BT.undo.pop();BT.sel.fill(0);beltChanged();}
function rle(mask){let value=0,count=0,counts=[];for(const bit of mask){
  if(bit!==value){counts.push(count);count=0;value=bit;}count++;}counts.push(count);return counts;}
function setBeltFrame(g,at=[]){const mask=new Uint8Array(16);for(const i of at)mask[i]=1;
  S.ledits[rvKey(g)]={seatbelt:[{rle:{size:[4,4],counts:rle(mask)}}]};}
show=function(g){S.g=S.shownG=g;ED.key=rvKey(g);ED.lab=S.labelSel;
  ED.items=JSON.parse(JSON.stringify(S.ledits[ED.key]?.[S.labelSel]||[]));
  LM.n=0;LM.k=0;LM.addEye=false;
  BT.key=rvKey(g);BT.undo=[];BT.mask=new Uint8Array(16);BT.sel=new Uint8Array(16);
  if(S.labelSel==='seatbelt'){
    const counts=S.ledits[BT.key]?.seatbelt?.[0]?.rle?.counts||[16];
    let value=0,index=0;for(const count of counts){if(value)BT.mask.fill(1,index,index+count);
      index+=count;value^=1;}
  }
};
function faceReset(){document.activeElement?.blur();S.mode='label';S.labelSel='face_lmk';
  S.gen=1;S.lseq=[0,1,2,3];locked=false;RV_OPEN=false;window.saves=[];
  S.ledits={'segment:0':{face_lmk:[face(10)]},'segment:1':{face_lmk:[]},
    'segment:2':{face_lmk:[face(100)]},'segment:3':{face_lmk:[]}};show(2);}
function beltReset(){document.activeElement?.blur();S.mode='label';S.labelSel='seatbelt';
  S.gen=1;S.lseq=[0,1,2,3];S.sess.src_w=4;S.sess.src_h=4;
  locked=false;RV_OPEN=false;window.saves=[];S.ledits={};
  setBeltFrame(0,[1,2]);setBeltFrame(1,[]);setBeltFrame(2,[8]);setBeltFrame(3,[]);
  BT.prev=null;BT.busy=false;BT.points=[];BT.poly=[];show(2);}
document.addEventListener('keydown',e=>{
  if(S.labelSel==='face_lmk'&&lmkActive()&&['KeyX','Delete'].includes(e.code)&&!e.defaultPrevented){
    ED.items[0].pts[0]=null;lmkChanged();e.preventDefault();}
},true);
</script>"""
HTML = EYE_HTML.replace('</body>', EXTRA + '</body>')


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

        page.evaluate('faceReset()')
        page.keyboard.press('c')
        page.wait_for_function('ED.items[0]?.pts[0]?.[0]===10')
        page.keyboard.press('z')
        assert page.evaluate('ED.items[0].pts[0][0]') == 100
        page.keyboard.press('Delete')
        assert page.evaluate('ED.items[0].pts[0]') is None
        page.keyboard.press('z')
        assert page.evaluate('ED.items[0].pts[0][0]') == 100
        page.keyboard.press('r')
        assert page.evaluate('ED.items[0].pts[0]') is None
        page.keyboard.press('z')
        assert page.evaluate('ED.items[0].pts[0][0]') == 100
        page.keyboard.press('Control+c')
        page.evaluate('show(3)')
        page.keyboard.press('Control+v')
        assert page.evaluate('ED.items[0].pts[0][0]') == 100
        page.keyboard.press('z')
        assert page.evaluate('ED.items') == []
        page.evaluate('show(2)')
        page.keyboard.press('x')
        assert page.evaluate('ED.items[0].pts[0]') is None, 'Native X still marks a point Not found'
        page.keyboard.press('z')
        assert page.evaluate('ED.items[0].pts[0][0]') == 100
        print('PASS: face 7pt C, Ctrl+C/V and Z; X, Delete and R remove the selected point')

        page.evaluate('beltReset()')
        page.keyboard.press('c')
        page.wait_for_function('BT.mask[1]===1 && BT.mask[2]===1')
        assert page.evaluate('BT.mask[8]') == 0
        page.keyboard.press('z')
        assert page.evaluate('BT.mask[8]') == 1 and page.evaluate('BT.mask[1]') == 0
        page.keyboard.press('Control+c')
        page.evaluate('show(3)')
        page.keyboard.press('Control+v')
        assert page.evaluate('BT.mask[8]') == 1
        page.keyboard.press('z')
        assert page.evaluate('Array.from(BT.mask).every(x=>x===0)')
        print('PASS: seatbelt C skips empty frames; Ctrl+C/V saves masks and native Z undoes')

        page.evaluate('beltReset();locked=true')
        page.keyboard.press('c')
        assert page.evaluate('BT.mask[8]') == 1
        page.evaluate('locked=false;BT.prev=new Uint8Array(16)')
        page.keyboard.press('Control+v')
        assert page.evaluate('BT.mask[8]') == 1, 'A pending SAM preview blocks mask paste'
        page.evaluate('BT.prev=null;faceReset()')
        page.locator('#text').focus()
        page.keyboard.press('c')
        assert page.evaluate('ED.items[0].pts[0][0]') == 100
        assert not errors, errors
        browser.close()
        print('PASS: Done, SAM preview, and text focus guard shortcut writes')


if __name__ == '__main__':
    main()
