"""Blank clicks must not start the native dashed landmark polygon."""
from _ext import read_organizer_script
from test_eye_shortcuts import HTML as EYE_HTML
from playwright.sync_api import sync_playwright


NATIVE_SELECTION = """<script>
lmkActive=function(){return S.mode==='label'&&['eye_lmk','face_lmk'].includes(S.labelSel)&&
  !locked&&S.lseq.includes(S.shownG);};
window.marqueeCount=0;
view.addEventListener('mousedown',e=>{
  if(e.button!==0||!lmkActive()||LM.addEye)return;
  LM.marq={x0:e.offsetX,y0:e.offsetY,x1:e.offsetX,y1:e.offsetY};
});
view.addEventListener('mousemove',e=>{
  if(LM.marq){LM.marq.x1=e.offsetX;LM.marq.y1=e.offsetY;}
});
window.addEventListener('mouseup',()=>{
  if(!LM.marq)return;
  const m=LM.marq;LM.marq=null;
  if(Math.abs(m.x1-m.x0)<3&&Math.abs(m.y1-m.y0)<3){
    if(LM.selSet.size)LM.selSet.clear();
    else LM.poly.push([m.x0,m.y0]);
  }else window.marqueeCount++;
});
</script>"""
HTML = EYE_HTML.replace('</body>', NATIVE_SELECTION + '</body>')


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

        page.evaluate('reset(2,[one(10)])')
        page.locator('#view').click(position={'x': 300, 'y': 110})
        assert page.evaluate('LM.poly') == [], 'Eye blank click started a polygon'
        assert page.evaluate('LM.marq') is None

        page.evaluate("LM.selSet.add('0:0');LM.poly.push([10,20])")
        page.locator('#view').click(position={'x': 300, 'y': 110})
        assert page.evaluate('LM.selSet.size') == 0, 'Blank click should deselect points'
        assert page.evaluate('LM.poly') == [], 'Blank click should clear an old polygon'

        page.evaluate("S.labelSel='face_lmk';ED.lab='face_lmk';LM.poly=[]")
        page.locator('#view').click(position={'x': 300, 'y': 110})
        assert page.evaluate('LM.poly') == [], 'Face blank click started a polygon'

        bounds = page.locator('#view').bounding_box()
        page.mouse.move(bounds['x'] + 300, bounds['y'] + 110)
        page.mouse.down()
        page.mouse.move(bounds['x'] + 340, bounds['y'] + 150)
        page.mouse.up()
        assert page.evaluate('window.marqueeCount') == 1, 'Marquee drag must remain available'
        assert page.evaluate('LM.poly') == []
        assert not errors, errors
        browser.close()
    print('PASS: blank clicks no longer start dashed polygons; marquee drag remains')


if __name__ == '__main__':
    main()
