"""C copies the nearest earlier nonempty bbox frame, independent of visit history."""
from pathlib import Path

from playwright.sync_api import sync_playwright

from _ext import read_organizer_script
from test_bbox_shortcuts import HTML as BASE_HTML, LABELS

ROOT=Path(__file__).resolve().parents[1]
SETUP="""
window.autoData=null;window.autoLoads=0;window.loadGate=null;window.failLoad=false;
window.visitLog=[];window.lastMessage='';
function flash(message){window.lastMessage=message;}
function loc(g){return [0,g];}
function rvG(item){return item.i;}
function pause(){S.playing=false;}
function clipAt(){return {cat:'other',n:1};}
function alBoxes(frame,label){return frame[label]||[];}
function ensureAL(si){
  if(S.al.has(si))return S.al.get(si);
  window.autoLoads++;
  const pending=(async()=>{
    await window.loadGate;
    // Like the native loader, a failed request becomes a null cache entry.
    S.al.set(si,window.failLoad ? null : window.autoData);
  })();
  S.al.set(si,pending);return pending;
}
function edSave(){
  const items=JSON.parse(JSON.stringify(ED.items));
  (S.ledits[ED.key]??={})[ED.lab]=items;
  window.saves.push({key:ED.key,label:ED.lab,items});
}
function renderLabList(){
  document.querySelector('#labList').innerHTML='<div class="grp"><div class="vlab">Other</div><ul>'+
    [...S.lseq].map(g=>`<li data-g="${g}" class="${g===S.shownG?'cur':''}"><span class="fs todo"></span>
      <span class="name"><b class="no">#01</b> ${S.labelSel}<span class="tm">00:00:0${g}</span></span></li>`).join('')+'</ul></div>';
}
function rvMarkLab(){
  for(const li of document.querySelectorAll('#labList li'))li.classList.toggle('cur',Number(li.dataset.g)===S.shownG);
}
function show(g){
  S.g=S.shownG=g;ED.key=rvKey(g);ED.lab=S.labelSel;ED.drag=ED.marq=null;ED.poly=[];ED.sel=-1;
  ED.items=JSON.parse(JSON.stringify(S.ledits[ED.key]?.[ED.lab]??window.autoData.frames[g]?.[ED.lab]??[]));
  window.visitLog.push(g);rvMarkLab();
}
function setupCopy(label='body'){
  reset(label);S.gen++;S.sess={src_w:1000,src_h:600,segments:[{name:'segment',al:true}]};
  S.lseq=Int32Array.from({length:9},(_,i)=>i);S.review={};S.ledits={};S.al=new Map();S.playing=false;
  window.autoData={frames:{}};window.autoLoads=0;window.loadGate=null;window.failLoad=false;
  window.lastMessage='';window.visitLog=[];
  for(let g=0;g<9;g++){
    S.review[rvKey(g)]={i:g,labels:[...labels]};
    autoData.frames[g]={};
    for(const lab of labels)autoData.frames[g][lab]=[
      {box:[10+g,20+g,60+g,80+g]},{box:[200+g,50+g,260+g,110+g]}];
  }
  show(0);renderLabList();
}
setupCopy();
"""
HTML=BASE_HTML.replace('</body>','<script>'+SETUP+'</script></body>')


def main():
    with sync_playwright() as pw:
        browser=pw.chromium.launch(headless=True)
        page=browser.new_page()
        errors=[]
        page.on('pageerror',lambda error:errors.append(str(error)))
        page.route('**/*',lambda route:route.fulfill(body=HTML,content_type='text/html'))
        page.goto('https://ntt.dev.nota.ai/')
        script=read_organizer_script()
        script=script.replace('  function previousQuickBboxFrames(target) {',
          '  window.previousCopyTest={state};\n  function previousQuickBboxFrames(target) {')
        page.add_script_tag(content=script)
        page.wait_for_selector('#nota-labeling-organizer-v1')

        def setup(label='body'):
            page.evaluate('setupCopy',label)
            page.wait_for_selector('.nl-organized li[data-g="0"]',state='attached')

        def items():return page.evaluate('ED.items')

        def copy(shift=False):
            page.keyboard.press('Shift+c' if shift else 'c')
            page.wait_for_function('!previousCopyTest.state.bboxCopyRequest')

        for label in LABELS:
            setup(label)
            expected=items()
            page.evaluate('show(1);ED.sel=0');copy()
            assert items()==expected and len(items())==2,(items(),expected,page.evaluate('lastMessage'))
            assert page.evaluate('window.saves.at(-1).key')=='segment:1'
            # Frame 3 is edited; C on frame 4 must use that latest saved edit.
            page.evaluate('show(2);ED.items[0].box=[30,40,90,120];edSave()')
            expected=items();page.evaluate('show(3)');copy();assert items()==expected
            # Unedited frame 5 is still the source for frame 6.
            page.evaluate('show(4)');expected=items()
            page.evaluate('show(5)');copy();assert items()==expected
            # Empty frame 7 is skipped, so frame 8 receives frame 6.
            page.evaluate('autoData.frames[6][S.labelSel]=[];show(6);show(7)')
            before=items();source=page.evaluate('S.ledits[rvKey(5)][S.labelSel]')
            copy();assert items()==source==expected
            page.keyboard.press('z')
            page.wait_for_function('!previousCopyTest.state.operationBusy')
            assert items()==before
            assert page.evaluate('S.ledits[rvKey(5)][S.labelSel]')==source
            page.evaluate('show(8);show(1)');copy()
            assert items()==page.evaluate('autoData.frames[0][S.labelSel]')
            # Copying must not alias the source array or its coordinates.
            page.evaluate('ED.items[0].box[0]+=100')
            assert page.evaluate('autoData.frames[0][S.labelSel][0].box[0]')==10
        print('PASS: requested 1->2, edited 3->4, unedited 5->6, empty 7 skipped to 6->8; all 13 bbox labels, all boxes, undo and source isolation')

        setup();page.evaluate('show(7);S.ledits[rvKey(6)]={body:[]};S.ledits[rvKey(5)]={body:[]}')
        copy();assert items()==page.evaluate('autoData.frames[4].body')
        assert page.evaluate('autoLoads')==1
        setup();page.evaluate('S.lseq=Int32Array.from([0,1,2,3,4,5,7,8]);renderLabList();show(7)')
        copy();assert items()==page.evaluate('autoData.frames[6].body')
        setup('hand');page.evaluate("S.review[rvKey(6)].labels=['body'];show(7)")
        copy();assert items()==page.evaluate('autoData.frames[5].hand')
        setup();before=items();copy(True)
        assert items()==before and page.evaluate('S.shownG')==0 and page.evaluate('saves.length')==0
        assert 'No earlier' in page.evaluate('lastMessage')
        setup();page.evaluate('show(7);for(let g=0;g<7;g++)autoData.frames[g].body=[]')
        before=items();copy();assert items()==before and page.evaluate('saves.length')==0
        print('PASS: unvisited/hidden Done sources, multiple empty frames, explicit deletions override auto boxes, label authorization and no-source no-op')

        setup();page.evaluate('show(1)');copy(True)
        page.wait_for_function('S.shownG===2')
        assert page.evaluate('saves.length')==1
        assert page.evaluate('S.ledits[rvKey(1)].body')==page.evaluate('autoData.frames[0].body')
        for block in ('locked=true','RV_OPEN=true',"ED.lab='hand'","ED.key='segment:4'",'S.g=4',
                      'ED.drag={n:0}',"document.querySelector('#text').focus()"):
            setup();page.evaluate('show(1)');before=items();page.evaluate(block);copy()
            assert items()==before and page.evaluate('saves.length')==0,block
        print('PASS: Shift+C advances once after copying; Done/review/stale editor/loading/drag/typing guards')

        # Block auto-label reading to exercise races without live server requests.
        def pending():
            setup();page.evaluate('()=>{show(7);window.loadGate=new Promise(r=>window.releaseLoad=r);}')
            page.keyboard.press('c');page.wait_for_function('autoLoads===1')

        for change in ('show(8)',"S.labelSel='hand';show(7)",'S.gen++','S.sess={...S.sess}',
                       'ED.items[0].box[0]+=50','locked=true'):
            pending();page.evaluate(change);before=items();page.evaluate('releaseLoad()')
            page.wait_for_function('!previousCopyTest.state.bboxCopyRequest')
            assert items()==before and page.evaluate('saves.length')==0,change
        pending();page.keyboard.press('c')
        assert page.evaluate('autoLoads')==1
        page.evaluate('S.ledits[rvKey(6)]={body:[{box:[100,100,200,200]}]};releaseLoad()')
        page.wait_for_function('!previousCopyTest.state.bboxCopyRequest')
        assert items()==[{'box':[100,100,200,200]}] and page.evaluate('saves.length')==1
        pending();page.evaluate('show(8)');page.keyboard.press('c');page.evaluate('releaseLoad()')
        page.wait_for_function('!previousCopyTest.state.bboxCopyRequest')
        assert items()==page.evaluate('autoData.frames[7].body')
        assert page.evaluate('saves.length===1 && saves[0].key==="segment:8"')
        pending();before=items();page.evaluate('failLoad=true;releaseLoad()')
        page.wait_for_function('!previousCopyTest.state.bboxCopyRequest')
        assert items()==before and page.evaluate('saves.length')==0
        assert 'unavailable' in page.evaluate('lastMessage')
        print('PASS: async copy cannot overwrite another frame/session/label or newer edits; duplicate presses coalesce; source changes and load failures handled')

        setup();page.evaluate('show(1)');before=items()
        for flags in ({'repeat':True},{'isComposing':True}):
            page.dispatch_event('body','keydown',{'code':'KeyC','key':'c',**flags})
            assert items()==before and page.evaluate('saves.length')==0
        setup();page.evaluate('show(2);ED.sel=0');expected=items()[0]
        page.keyboard.press('Control+c');page.evaluate('show(7);ED.items=[]')
        page.keyboard.press('Control+v');assert items()==[expected]
        assert not errors,errors
        browser.close()
        print('PASS: Ctrl+C / Ctrl+V selected-box clipboard remains separate')


if __name__=='__main__':main()
