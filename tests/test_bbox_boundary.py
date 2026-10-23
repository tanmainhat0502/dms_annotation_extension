"""Chromium checks for N creation in the black margin around the image."""
from pathlib import Path

from playwright.sync_api import sync_playwright

from _ext import read_organizer_script
from test_bbox_shortcuts import HTML as SHORTCUT_HTML, LABELS

ROOT = Path(__file__).resolve().parents[1]
HTML = SHORTCUT_HTML.replace('<canvas id="view"></canvas>', '''
<div id="stage"><canvas id="view" width="400" height="240"></canvas>
<button id="stageAction" style="position:absolute;right:5px;bottom:5px"
 onclick="window.actionClicks++">Viewer action</button></div>
<style>
body { margin:0; }
#labPane { width:320px; }
#stage { position:absolute;left:400px;top:100px;width:640px;height:560px;
 display:flex;align-items:center;justify-content:center;overflow:hidden;background:#000; }
#view { width:400px;height:240px;flex:none;background:#888; }
</style>''').replace('reset();\n</script>', '''
S.sess={src_w:1000,src_h:600};window.actionClicks=0;
reset();
</script>''')

CASES = [
    ("bottom", [200, 200], [500, 650], [200, 200, 500, 600]),
    ("right", [200, 200], [1050, 400], [200, 200, 1000, 400]),
    ("left", [500, 200], [-50, 400], [0, 200, 500, 400]),
    ("top", [200, 400], [500, -50], [200, 0, 500, 400]),
    ("bottom-right", [200, 200], [1050, 650], [200, 200, 1000, 600]),
    ("top-left", [500, 400], [-50, -50], [0, 0, 500, 400]),
    ("start outside", [500, 650], [200, 200], [200, 200, 500, 600]),
    ("both corners outside", [-50, -50], [1050, 650], [0, 0, 1000, 600]),
]


def main():
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1200, "height": 850})
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.route("**/*", lambda route: route.fulfill(body=HTML, content_type="text/html"))
        page.goto("https://ntt.dev.nota.ai/")
        page.add_script_tag(content=read_organizer_script())
        page.wait_for_selector("#nota-labeling-organizer-v1")

        def start(label="hand"):
            page.keyboard.press("Escape")
            page.evaluate("label=>{reset(label);ED.items=[];ED.sel=-1;}", label)
            page.keyboard.press("n")

        def point(coords, click=True):
            rect = page.locator("#view").bounding_box()
            x = rect["x"] + coords[0] / 1000 * rect["width"]
            y = rect["y"] + coords[1] / 600 * rect["height"]
            if click:
                page.mouse.click(x, y)
            else:
                page.mouse.move(x, y)

        def assert_box(actual, expected):
            assert len(actual) == 4 and all(abs(a-b) < .01 for a, b in zip(actual, expected)), (actual, expected)

        # First reproduce the reported failure: click below the image to finish.
        start()
        point([200, 200])
        point([500, 650])
        saved = page.evaluate("window.saves")
        assert len(saved) == 1, "Clicking in the black margin must finish and save the box"
        assert_box(saved[0][0]["box"], [200, 200, 500, 600])

        for transform in ("none", "translate(12px,-8px) scale(1.25)"):
            page.locator("#view").evaluate("(el,value)=>el.style.transform=value", transform)
            for label in LABELS:
                for name, first, last, expected in CASES:
                    start(label)
                    point(first)
                    point(last, click=False)
                    assert_box(page.evaluate("ED.items[0].box"), expected)
                    point(last)
                    saved = page.evaluate("window.saves")
                    assert len(saved) == 1 and len(saved[0]) == 1, (label, name, transform, saved)
                    assert_box(saved[0][0]["box"], expected)
                    assert page.evaluate("window.touches") == 1
                    point([400, 300])
                    assert len(page.evaluate("window.saves")) == 1, "Creation mode must end after saving"
        print("PASS: all 13 bbox labels; four edges/corners, outside first click, zoom/pan; preview and saved coordinates")

        page.locator("#view").evaluate("el=>{el.style.transform='none';el.width=200;el.height=120;}")
        start()
        point([200, 200])
        point([1050, 650])
        assert_box(page.evaluate("window.saves[0][0].box"), [200, 200, 1000, 600])
        start()
        point([-50, 100])
        point([-50, 400])
        assert page.evaluate("window.saves.length") == 0, "Fully outside box must not save zero width"
        point([200, 400])
        assert_box(page.evaluate("window.saves[0][0].box"), [0, 100, 200, 400])
        print("PASS: lower canvas resolution and zero-area outside box; retry at a valid corner")

        start()
        point([200, 200])
        page.locator("#stageAction").click()
        assert page.evaluate("window.saves.length") == 0
        assert page.evaluate("window.actionClicks") == 1
        page.locator("#text").click()
        assert page.evaluate("window.saves.length") == 0
        page.keyboard.press("Tab")
        page.evaluate("document.activeElement?.blur()")
        page.keyboard.press("Escape")
        assert page.evaluate("ED.items.length") == 0
        start()
        page.evaluate("locked=true")
        point([-50, 100])
        point([200, 400])
        assert page.evaluate("window.saves.length") == 0
        assert page.evaluate("ED.items.length") == 0
        start("body")
        point([200, 200])
        point([500, 650])
        page.keyboard.press("z")
        assert page.evaluate("ED.items.length") == 0
        assert not errors, errors
        browser.close()
        print("PASS: viewer/sidebar controls do not finish boxes; Escape, Done locks and bbox undo still work")


if __name__ == "__main__":
    main()
