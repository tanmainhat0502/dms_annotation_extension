"""Face 7pt N-click anchors and Shift+N drag create editable landmarks."""

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
        page.locator('#view').click(position={'x': 200, 'y': 40})
        page.locator('#view').click(position={'x': 200, 'y': 95})
        page.mouse.move(rect['x'] + 200, rect['y'] + 160)
        preview = page.evaluate("""()=>({anchors:window.__notaOrganizerV1.state.faceCreateAnchors.length,
          saves:window.saves.length, point:ctx.getImageData(128,40,1,1).data[3]})""")
        assert preview['anchors'] == 2 and preview['saves'] == 0 and preview['point'] > 0, preview
        page.locator('#view').click(position={'x': 200, 'y': 160})
        expected = [[128, 40], [167.6, 42.4], [232.4, 42.4], [272, 40],
                    [158, 150.4], [242, 150.4], [200, 95]]
        assert page.evaluate('ED.items[0].pts') == expected
        assert page.evaluate('window.saves.length') == 1
        assert page.evaluate('window.__notaOrganizerV1.state.faceCreateMode') is None
        page.keyboard.press('z')
        assert page.evaluate('ED.items[0].pts') == [None] * 7

        page.keyboard.press('n')
        page.locator('#view').click(position={'x': 200, 'y': 40})
        page.keyboard.press('Escape')
        assert page.evaluate('window.saves.length') == 2
        assert page.evaluate('window.__notaOrganizerV1.state.faceCreateMode') is None

        page.evaluate('faceReset();show(1);ED.items=[{pts:Array(7).fill(null)}]')
        page.keyboard.press('Shift+n')
        drag((40, 10), (360, 190), release=False)
        during = page.evaluate("""()=>({draft:!!window.__notaOrganizerV1.state.faceCreateDraft,
          points:ED.items[0].pts,saves:window.saves.length,
          preview:ctx.getImageData(72,53,1,1).data[3]})""")
        assert during['draft'] and during['points'] == [None] * 7, during
        assert during['saves'] == 0 and during['preview'] > 0, during
        page.mouse.up()
        created = page.evaluate('ED.items')
        assert len(created) == 1 and len(created[0]['pts']) == 7, created
        assert all(point is not None for point in created[0]['pts']), created
        assert created[0]['pts'] == [[72, 53.2], [171.2, 55], [228.8, 55],
                                     [328, 53.2], [148.8, 152.2], [257.6, 152.2],
                                     [200, 125.2]], created
        assert page.evaluate('window.saves.length') == 1
        assert page.evaluate('window.__notaOrganizerV1.state.faceCreateMode') is None
        page.keyboard.press('z')
        assert page.evaluate('ED.items[0].pts') == [None] * 7

        page.keyboard.press('Shift+n')
        drag((30, 20), (300, 180), release=False)
        page.keyboard.press('Escape')
        page.mouse.up()
        assert page.evaluate('ED.items[0].pts') == [None] * 7
        assert page.evaluate('window.__notaOrganizerV1.state.faceCreateMode') is None

        page.keyboard.press('Shift+n')
        drag((50, 30), (250, 180), release=False)
        page.evaluate('show(2)')
        page.mouse.up()
        assert page.evaluate('ED.items[0].pts[0][0]') == 100
        assert page.evaluate('window.__notaOrganizerV1.state.faceCreateMode') is None

        page.keyboard.press('Shift+n')
        page.evaluate('show(1)')
        page.keyboard.press('Shift+n')
        assert page.evaluate('window.__notaOrganizerV1.state.faceCreateScope.g') == 1
        page.keyboard.press('Escape')
        page.evaluate('show(2)')

        page.keyboard.press('Shift+n')
        drag((30, 20), (300, 180))
        assert len(page.evaluate('ED.items')) == 2, 'A new face must not replace existing points'
        page.keyboard.press('z')
        assert len(page.evaluate('ED.items')) == 1
        assert page.evaluate('ED.items[0].pts[0][0]') == 100
        assert not errors, errors
        browser.close()
        print('PASS: N three-anchor preview/commit and Shift+N drag, Z, Esc, stale frame safety')


if __name__ == '__main__':
    main()
