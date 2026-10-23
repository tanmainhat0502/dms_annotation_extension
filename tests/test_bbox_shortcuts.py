"""Check the R/Delete alias in Chromium: python tests/test_bbox_shortcuts.py."""
from pathlib import Path

from _ext import read_organizer_script
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
LABELS = ["body", "head", "face", "nose", "mouth", "eye", "hand",
          "cigarette", "e_cigarette", "phone", "can", "bottle", "face_mask"]
HTML = """<!doctype html><html><body>
<div id="labPane"><div id="labTitle">Labeling</div><div id="labList"></div></div>
<input id="text"><textarea></textarea><select><option>r</option></select>
<div contenteditable="true"><span id="editable">Text</span></div><canvas id="view"></canvas>
<script>
const labels = LABELS_HERE;
const S = {mode:'label',labelSel:'body',sess:{},gen:1,g:0,shownG:0,lseq:[0],ledits:{}};
const ED = {key:'segment:0',lab:'body',items:[],sel:-1,selSet:new Set(),hover:null,
  drag:null,marq:null,poly:[],mouse:null};
let RV_OPEN = false, locked = false;
window.saves=[];window.touches=0;window.repaints=0;window.samAdds=0;
const BT={mode:'pt',prev:null,busy:false,points:[],poly:[]};
function rvKey(g){return 'segment:'+g;}
function edActive(){return S.mode==='label' && labels.includes(S.labelSel) && S.lseq.includes(S.shownG) && !locked;}
function edSelected(){return ED.selSet.size ? [...ED.selSet] : ED.sel>=0 ? [ED.sel] : [];}
function edClearSel(){ED.sel=-1;ED.selSet.clear();}
function edSave(){window.saves.push(JSON.parse(JSON.stringify(ED.items)));}
function edRepaint(){window.repaints++;}
function lsTouch(){window.touches++;}
function beltActive(){return S.labelSel==='seatbelt' && !locked;}
function beltLoad(){return true;}
function beltApply(){window.samAdds++;BT.prev=null;}
function reset(label='body'){
  document.querySelectorAll('dialog[open]').forEach(el=>el.close());
  document.activeElement?.blur();
  S.labelSel=ED.lab=label;S.mode='label';S.g=S.shownG=0;
  ED.key='segment:0';ED.sel=1;ED.selSet.clear();ED.drag=ED.marq=ED.hover=null;
  ED.items=[{box:[0,0,10,10]},{box:[20,0,30,10]},{box:[40,0,50,10]}];
  locked=false;RV_OPEN=false;window.saves=[];window.touches=0;window.repaints=0;
  BT.prev=null;
}
reset();
</script></body></html>""".replace("LABELS_HERE", repr(LABELS))

# Native Delete contract, also used when the saved DMS source is unavailable.
NATIVE_DELETE = """
document.addEventListener("keydown", e=>{
  if(!edActive() || RV_OPEN || ['INPUT','SELECT','TEXTAREA'].includes(e.target.tagName)) return;
  if((e.code==='Delete' || e.code==='Backspace') && edSelected().length){
    for(const n of edSelected().sort((a,b)=>b-a)) ED.items.splice(n,1);
    edClearSel();edSave();edRepaint();lsTouch();e.preventDefault();e.stopPropagation();
  }
},true);
"""
native_file = ROOT.parent / "NOTA_LABEL/DMS Web Viewer_files/editor.js.download"
if native_file.exists():
    native_source = native_file.read_text(encoding="utf-8")
    start = native_source.index('document.addEventListener("keydown"', native_source.index("// 키: Backspace/Delete"))
    NATIVE_DELETE = native_source[start:]


def main():
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True)
        page = browser.new_page()
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.route("**/*", lambda route: route.fulfill(body=HTML, content_type="text/html"))
        page.goto("https://ntt.dev.nota.ai/")
        page.add_script_tag(content=NATIVE_DELETE)
        page.add_script_tag(content=read_organizer_script())
        page.wait_for_selector("#nota-labeling-organizer-v1")

        def snapshot():
            return page.evaluate("""()=>({items:ED.items,selected:edSelected(),
              saves:window.saves,touches:window.touches,repaints:window.repaints})""")

        for label in LABELS:
            for selection in ("ED.sel=1", "ED.selSet=new Set([2,0])"):
                page.evaluate("reset", label)
                page.evaluate(selection)
                page.keyboard.press("Delete")
                expected = snapshot()
                page.evaluate("reset", label)
                page.evaluate(selection)
                page.keyboard.press("r")
                assert snapshot() == expected, (label, selection, snapshot(), expected)
                assert len(expected["saves"]) == 1
        print("PASS: R matches native Delete for single/multiple selections across all 13 bbox labels")

        page.evaluate("reset()")
        page.keyboard.down("r")
        page.evaluate("ED.sel=0")  # A later selection must not be deleted by held-key repeats.
        before = snapshot()
        page.keyboard.down("r")
        assert snapshot() == before
        page.keyboard.up("r")
        page.keyboard.press("r")
        assert len(snapshot()["items"]) == 1
        print("PASS: holding R deletes once; a new press can delete the next selection")

        for setup in [
            "ED.sel=-1;ED.hover={n:1}",
            "locked=true",
            "RV_OPEN=true",
            "ED.drag={n:1}",
            "ED.marq={}",
            "ED.key='segment:1'",
            "ED.lab='hand'",
            "S.shownG=1",
            "S.mode='review'",
            "document.querySelector('#nl-eye-bulk').showModal()",
            "document.querySelector('#nl-seatbelt-bulk').showModal()",
        ]:
            page.evaluate("reset()")
            page.evaluate(setup)
            before = snapshot()
            page.keyboard.press("r")
            assert snapshot() == before, setup
        for selector in ("#text", ".nl-search", "textarea", "select", "[contenteditable]"):
            page.evaluate("reset()")
            page.locator(selector).focus()
            before = snapshot()
            page.keyboard.press("r")
            assert snapshot() == before, selector
        for modifier in ("Control", "Meta", "Alt", "Shift"):
            page.evaluate("reset()")
            before = snapshot()
            # Dispatch modifier chords without invoking browser reload shortcuts.
            prop = {"Control": "ctrlKey", "Meta": "metaKey", "Alt": "altKey", "Shift": "shiftKey"}[modifier]
            page.dispatch_event("body", "keydown", {"key": "r", "code": "KeyR", prop: True})
            assert snapshot() == before, modifier
        page.evaluate("reset()")
        before = snapshot()
        page.dispatch_event("body", "keydown", {"key": "r", "code": "KeyR", "isComposing": True})
        assert snapshot() == before
        print("PASS: no selection/hover, Done, dialogs, typing, modifiers, gestures and stale frames do not delete")

        for label in ("face_lmk", "eye_lmk", "seatbelt"):
            page.evaluate("reset", label)
            before = snapshot()
            page.keyboard.press("r")
            assert snapshot() == before, label
        page.evaluate("reset('seatbelt');BT.prev={ready:true}")
        before = snapshot()
        page.keyboard.press("r")
        assert page.evaluate("window.samAdds") == 1
        assert snapshot() == before
        page.evaluate("reset()")
        page.keyboard.press("Backspace")
        assert len(snapshot()["items"]) == 2
        assert not errors, errors
        browser.close()
        print("PASS: seatbelt R still accepts SAM; landmarks unaffected; Backspace still deletes")


if __name__ == "__main__":
    main()
