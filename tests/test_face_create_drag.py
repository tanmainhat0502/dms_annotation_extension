"""Face 7pt N-drag previews and commits seven editable landmarks."""

from _ext import read_organizer_script
from test_landmark_mask_shortcuts import HTML as FACE_HTML

from playwright.sync_api import sync_playwright


HTML = FACE_HTML.replace('</body>', """<script>
const ctx=view.getContext('2d');
edRepaint=function(){ctx.clearRect(0,0,view.width,view.height);lmkDraw();};
</script></body>""")


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
        rect = page.locator('#view').bounding_box()

        def drag(start, end, release=True):
            page.mouse.move(rect['x'] + start[0], rect['y'] + start[1])
            page.mouse.down()
            page.mouse.move(rect['x'] + end[0], rect['y'] + end[1], steps=4)
            if release:
                page.mouse.up()

        page.evaluate('faceReset();show(1);ED.items=[{pts:Array(7).fill(null)}]')
        page.keyboard.press('n')
        drag((40, 10), (360, 190), release=False)
        during = page.evaluate("""()=>({draft:!!window.__notaOrganizerV1.state.faceCreateDraft,
          points:ED.items[0].pts,saves:window.saves.length,
          preview:ctx.getImageData(112,102,1,1).data[3]})""")
        assert during['draft'] and during['points'] == [None] * 7, during
        assert during['saves'] == 0 and during['preview'] > 0, during
        page.mouse.up()
        created = page.evaluate('ED.items')
        assert len(created) == 1 and len(created[0]['pts']) == 7, created
        assert all(point is not None for point in created[0]['pts']), created
        assert created[0]['pts'][0] == [112.2, 102.1], created
        assert page.evaluate('window.saves.length') == 1
        assert page.evaluate('window.__notaOrganizerV1.state.faceCreateMode') is False
        page.keyboard.press('z')
        assert page.evaluate('ED.items[0].pts') == [None] * 7

        page.keyboard.press('n')
        drag((30, 20), (300, 180), release=False)
        page.keyboard.press('Escape')
        page.mouse.up()
        assert page.evaluate('ED.items[0].pts') == [None] * 7
        assert page.evaluate('window.__notaOrganizerV1.state.faceCreateMode') is False

        page.keyboard.press('n')
        drag((50, 30), (250, 180), release=False)
        page.evaluate('show(2)')
        page.mouse.up()
        assert page.evaluate('ED.items[0].pts[0][0]') == 100
        assert page.evaluate('window.__notaOrganizerV1.state.faceCreateMode') is False

        page.keyboard.press('n')
        page.evaluate('show(1)')
        page.keyboard.press('n')
        assert page.evaluate('window.__notaOrganizerV1.state.faceCreateScope.g') == 1
        page.keyboard.press('Escape')
        page.evaluate('show(2)')

        page.keyboard.press('n')
        drag((30, 20), (300, 180))
        assert len(page.evaluate('ED.items')) == 2, 'A new face must not replace existing points'
        page.keyboard.press('z')
        assert len(page.evaluate('ED.items')) == 1
        assert page.evaluate('ED.items[0].pts[0][0]') == 100
        assert not errors, errors
        browser.close()
        print('PASS: N-drag preview, commit, Z, Esc, stale frame and existing face safety')


if __name__ == '__main__':
    main()
