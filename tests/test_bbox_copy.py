"""Selected bbox copy regressions. Run: uv run --with playwright python tests/test_bbox_copy.py"""
import copy
from pathlib import Path

from _ext import read_organizer_script
from playwright.sync_api import sync_playwright


def box(*coords, cls=None):
    return {"box": list(coords), **({"cls": cls} if cls else {})}


outer = box(0.5, 0.5, 19.5, 19.5)
selected = box(3, 4, 14, 12)
third = box(4, 5, 6, 7)
target_outer = box(0.6, 0.4, 19.6, 19.4)
narrow = box(3, 6, 6.3, 12)
duplicate = box(3.1, 6.1, 6.4, 12.1)
target_third = box(4.1, 5.1, 6.1, 7.1)
wide_body = box(50, 54, 833, 735)
old_wide_body = box(72, 60, 948, 743)
separate_body = box(0, 250, 45, 650)
single_body = box(14, 175, 232, 562)

cases = [
    ("nearly coincident source bodies below 90 percent must not shield the old target",
     [wide_body, old_wide_body, separate_body], wide_body,
     [old_wide_body, box(70, 58, 946, 740), separate_body], [wide_body, separate_body]),
    ("nearly coincident bodies also collapse when copying the wider one",
     [wide_body, old_wide_body, separate_body], old_wide_body,
     [wide_body, old_wide_body, separate_body], [old_wide_body, separate_body]),
    ("single source replaces the taller body on the next frame",
     [single_body], single_body, [box(16, 80, 232, 563)], [single_body]),
    ("single source replaces all old body duplicates with one copy",
     [single_body], single_body,
     [box(16, 80, 232, 563), box(14, 192, 230, 560)], [single_body]),
    ("single source replacement still preserves a body elsewhere",
     [single_body], single_body,
     [box(16, 80, 232, 563), box(300, 20, 900, 560)],
     [single_body, box(300, 20, 900, 560)]),
    ("narrow inner box and duplicates, enclosing box and third person preserved",
     [outer, selected, third], selected,
     [target_outer, narrow, target_third, duplicate],
     [target_outer, selected, target_third]),
    ("different source and target ordering",
     [third, selected, outer], selected,
     [target_third, narrow, duplicate, target_outer],
     [target_third, selected, target_outer]),
    ("small person inside a large body remains separate",
     [outer, third], third, [target_outer, target_third], [target_outer, third]),
    ("copying the enclosing body preserves its separate inner annotation",
     [outer, selected, third], outer,
     [target_outer, selected, target_third], [outer, selected, target_third]),
    ("enclosing body remains separate even without a counterpart at source",
     [third], third, [target_outer, target_third], [target_outer, third]),
    ("large height correction collapses older duplicates",
     [box(2, 2, 6, 8), box(12, 3, 17, 9)], box(2, 2, 6, 8),
     [box(0, 0, 20, 20), box(2, 0, 6, 14), box(2.1, 2.1, 6.1, 8.1), box(12, 3, 17, 9)],
     [box(0, 0, 20, 20), box(2, 2, 6, 8), box(12, 3, 17, 9)]),
    ("no matching target appends one box",
     [selected], selected, [box(16, 16, 19, 19)], [box(16, 16, 19, 19), selected]),
    ("partial intersection alone does not replace",
     [box(2, 2, 6, 8)], box(2, 2, 6, 8),
     [box(3, 3, 7, 9)], [box(3, 3, 7, 9), box(2, 2, 6, 8)]),
    ("a closer unselected source protects an overlapping annotation",
     [box(2, 2, 10, 10), box(4, 2, 12, 10)], box(2, 2, 10, 10),
     [box(4, 2, 12, 10)], [box(4, 2, 12, 10), box(2, 2, 10, 10)]),
    ("same position with different object classes",
     [box(2, 2, 8, 8, cls="can")], box(2, 2, 8, 8, cls="can"),
     [box(2, 2, 8, 8, cls="bottle")],
     [box(2, 2, 8, 8, cls="bottle"), box(2, 2, 8, 8, cls="can")]),
    ("source duplicates do not shield target duplicates",
     [selected, copy.deepcopy(selected)], selected, [selected, copy.deepcopy(selected)], [selected]),
]


def transpose(item):
    x1, y1, x2, y2 = item["box"]
    return {**item, "box": [y1, x1, y2, x2]}


edge_before = box(4, 7, 6, 10)
edge_after = box(4, 7, 12, 10)
edge_neighbor = box(0, 12, 2, 19)
edge_sources = [outer, edge_after, edge_neighbor]
edge_operation = {"type": "edge", "coord": 2, "value": 12, "rank": 1, "itemIndex": 1,
                  "originalBox": edge_before["box"], "currentBox": edge_after["box"]}
edge_cases = [
    ("missing inner box stays missing instead of adding a source-sized duplicate",
     edge_sources, edge_operation, [target_outer, edge_neighbor], [target_outer, edge_neighbor]),
    ("match the old small box even after a large width correction",
     edge_sources, edge_operation, [target_outer, box(4.2, 7.1, 6.2, 10.1), edge_neighbor],
     [target_outer, box(4.2, 7.1, 12, 10.1), edge_neighbor]),
    ("reordered targets still change only the matching box and one edge",
     edge_sources, edge_operation, [edge_neighbor, box(4.2, 7.1, 6.2, 10.1), target_outer],
     [edge_neighbor, box(4.2, 7.1, 12, 10.1), target_outer]),
    ("empty target stays empty",
     edge_sources, edge_operation, [], []),
    ("existing target count stays unchanged even when adjusted geometry coincides",
     edge_sources, edge_operation, [target_outer, edge_before, edge_after, edge_neighbor],
     [target_outer, edge_after, edge_after, edge_neighbor]),
    ("inward edge movement matches the original geometry",
     [outer, edge_before, edge_neighbor],
     {**edge_operation, "value": 6, "originalBox": edge_after["box"], "currentBox": edge_before["box"]},
     [target_outer, box(4.2, 7.1, 12.2, 10.1), edge_neighbor],
     [target_outer, box(4.2, 7.1, 6, 10.1), edge_neighbor]),
    ("left edge preserves the other three target coordinates",
     [outer, box(3, 7, 12, 10), edge_neighbor],
     {**edge_operation, "coord": 0, "value": 3, "originalBox": [8, 7, 12, 10], "currentBox": [3, 7, 12, 10]},
     [target_outer, box(8.2, 7.1, 12.2, 10.1), edge_neighbor],
     [target_outer, box(3, 7.1, 12.2, 10.1), edge_neighbor]),
    ("missing reference geometry must not fall back to target rank",
     edge_sources, {"type": "edge", "coord": 2, "value": 12, "rank": 1},
     [target_outer, edge_neighbor], [target_outer, edge_neighbor]),
    ("moved single target keeps its other three coordinates without a geometry overlap",
     [edge_before],
     {**edge_operation, "coord": 1, "value": 2, "itemIndex": 0,
      "originalBox": edge_before["box"], "currentBox": [4,2,6,10]},
     [box(14,5,20,12)], [box(14,2,20,12)]),
]


def main():
    content = read_organizer_script()
    guard = '  if (!ALLOWED_ORIGINS.has(location.origin) || document.getElementById(ROOT_ID)) return;'
    assert content.count(guard) == 1
    # Expose the actual production function on about:blank. The origin guard
    # then exits normally, without installing any application UI or listeners.
    content = content.replace(guard, '  window.copyBboxForTest = mergeCopiedGenericBbox;\n'
                              '  window.edgeBboxForTest = applyQuickOperationToItems;\n' + guard)
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        page = browser.new_page()
        page.evaluate("window.S = {sess: {src_w: 20, src_h: 20}}")
        page.add_script_tag(content=content)
        for transpose_axes in (False, True):
            transform = transpose if transpose_axes else copy.deepcopy
            for name, sources, copied, targets, expected in cases:
                payload = {"sources": [transform(x) for x in sources], "copied": transform(copied),
                           "targets": [transform(x) for x in targets]}
                result = page.evaluate("""data => {
                  const before = JSON.stringify(data);
                  const first = copyBboxForTest(data.targets, data.copied, data.sources);
                  const again = copyBboxForTest(first, data.copied, data.sources);
                  return {first, again, unchanged: JSON.stringify(data) === before};
                }""", payload)
                wanted = [transform(x) for x in expected]
                assert result["first"] == wanted, (name, transpose_axes, result)
                assert result["again"] == wanted, (name, "repeated copy", result)
                assert result["unchanged"], (name, "mutated input")
            for name, sources, operation, targets, expected in edge_cases:
                op = copy.deepcopy(operation)
                if transpose_axes:
                    op["coord"] = {0: 1, 1: 0, 2: 3, 3: 2}[op["coord"]]
                    for field in ("originalBox", "currentBox"):
                        if field in op:
                            op[field] = transpose({"box": op[field]})["box"]
                payload = {"sources": [transform(x) for x in sources], "op": op,
                           "targets": [transform(x) for x in targets]}
                result = page.evaluate("""data => {
                  const before = JSON.stringify(data);
                  const first = edgeBboxForTest(data.targets, data.op, data.sources);
                  const again = edgeBboxForTest(first, data.op, data.sources);
                  return {first, again, unchanged: JSON.stringify(data) === before};
                }""", payload)
                wanted = [transform(x) for x in expected]
                assert result["first"] == wanted, (name, transpose_axes, result)
                assert result["again"] == wanted, (name, "repeated edge propagation", result)
                assert result["unchanged"], (name, "mutated input")
        browser.close()
    print(f"PASS: {len(cases) * 2} bbox-copy and {len(edge_cases) * 2} edge cases; repeated operations and input preservation")


if __name__ == "__main__":
    main()
