# Manual testing: 1.6.36

Use this checklist to verify cached playback, the timeline lock, bbox editing, sticky clip controls, and image preloading in your DMS environment.

## Install

1. Extract `dist/NOTA_Labeling_Organizer_Extension_v1.6.36.zip`, or use this repository's `extension` folder.
2. In `chrome://extensions`, disable the older Organizer version. Click **Load unpacked** and select the folder containing `manifest.json`.
3. Reload the DMS tab. Open **Labeling**, choose a label, and open a frame.
4. Find **auto_load_img** and **Stop** directly below the part search field.

## Review checklist

- Open `Ctrl+B`: verify **Label actions** and **Change status** tabs. Select either tab, close with Esc, reopen, and reload DMS: the same tab must remain selected. Switching tabs must not discard a pending box-edge/mask operation. Return to Label actions before testing copy/delete/adjust below.
- In Change status, test Not checked, In progress, and Done with previous/next frame counts, `end`, and a count larger than the clip. The count must include the current frame, then continue in the selected direction. Only the active label in that clip should change. Hidden/Done frames are eligible, unchanged targets cause no extra saves, and annotation data stays unchanged. Label actions must still exclude the source frame.
- Press `V` on Done, In progress, and Not checked frames across multiple clips, including bbox, landmark, and seatbelt labels. Select **Marked frames** in Change status: all marks are eligible, even hidden ones and the current frame if marked. Marks should remain after saving; V/Clear selection removes them, and changing label/session clears them.
- Test Change status on a frame with no annotations, Enter to apply, and a failed request followed by retry. During saving, tabs and inputs must be disabled. A session/label/mode change must stop queued saves; stale responses must not enter a new session.
- Under the progress bar, combine **Show done**, **Show in progress**, and **Show not checked**. Check each status alone, multiple statuses, all three, and none. Counts above the filters must stay unchanged. With the checkboxes visible, toggle Show done repeatedly by mouse and keyboard: the checkboxes must stay in place, including when a hidden current frame reappears or a replacement image loads slowly. Repeat with the current clip open and collapsed, at the top and with the header partially scrolled. Farther down the list, repainting should preserve the visible frame/clip/part. Reload and verify the choices persist. Combine with part search and use `A` / `D` / `Space`: only matching frames should be visited.
- Hover over each clip status button: it must show a source-frame count and exactly two destination options without saving. Try all six transitions on a mixed-status clip. Only source-status frames in the active-label clip should change, including hidden frames; annotations and other clips/labels must remain unchanged.
- Test a fully Done clip: **Done** must be enabled so it can be reopened; the other source buttons must be disabled. Try keyboard Enter/Space/arrows/Esc, clicking outside, and scrolling with a menu open. The menu must not toggle the clip or trigger playback. Repeating a partially failed transition should save only remaining source frames.
- Find **Done all** below a part's frame count in the left column. Scroll up/down inside a long part and resize the window: the checkbox and count should remain visible. Move into another part and verify its control takes over.
- Tick Done all on a part you intend to complete. The count shows save progress, then all its clips/frames become Done. Untick it: all frames become In progress. Other parts, labels, and annotation boxes must stay unchanged. Check collapsed clips, a partially Done part (dash), and keyboard Space on the focused checkbox.
- With **Show done** unchecked, the action must still cover the complete current-label part. Completed parts disappear; check **Show done** to see and untick the part again. If a request fails, the checkbox must reflect only successful saves and show an error; retry Done to save the remaining frames. Switching label/session during saving must stop new queued requests.
- With auto_load_img running, Done all must advance its two-part cache only after the whole part's Done saves succeed. Test that opening/closing clips and scrolling during saves keep the control accessible.
- Place a hand box against the bottom image edge. Drag its bottom-right handle horizontally while moving slightly in and out of the black margin: the width should keep following the pointer without freezing or jumping on re-entry. Release outside: the saved bottom edge should be clipped to the image.
- Grab the outside half of a boundary handle. Repeat at all four image edges, while zoomed/panned, and with other bbox labels. Check that the box saves once on release, `Z` restores it for body/hand/eye, and losing window focus during a drag discards that unsaved drag. Viewer controls and empty-margin clicks must not start a bbox edit.
- On body/hand/eye, press `C` in frame 2: all boxes should come from frame 1. Edit and save frame 3, then press C in frame 4: it should use the edited boxes. Leave frame 5 unchanged and press C in frame 6: it should use frame 5. Leave frame 7 empty and press C in frame 8: it should use frame 6.
- Jump directly to a frame without viewing its predecessor; C must still find the nearest earlier frame with boxes. Check an explicitly deleted/empty predecessor and a Done predecessor hidden by status filters. The source should always be the same label and session. With no earlier nonempty source, current boxes must remain untouched.
- After C, press `Z` to restore the target. `Shift+C` should copy then advance once. While source data loads, switch frame/label/session or edit the current box: the pending copy must not overwrite that new context or edit. Check that Ctrl+C/Ctrl+V still use the explicit clipboard selection.
- Load a large part with **auto_load_img**, wait for **Ready**, then press `Space` at 1x. Check that frames advance in order and the sidebar follows without repeated long pauses. Press `Space` again to pause; edit a box and check that the sidebar does not jump during repaint.
- During playback, search for a different part, clear the search, change labels, and switch sessions. Navigation must use the new list and stop at its last frame. Mark Done with Show done unchecked, then reopen a frame: the displayed rows and status must stay correct.
- Click the padlock to the right of the bottom timeline. It should close and turn gold. Click, double-click, or drag near either end of the timeline: the current frame must stay in place. Click the lock again and verify timeline clicks navigate normally.
- While locked, use `A` / `D`, `Shift+D`, `Space`, and sidebar frame selection. These should still work. Reload DMS: the lock should keep your last choice. Resize the window and collapse the sidebars: the lock must remain beside the timeline without covering the frame counter.
- For head, face, nose, mouth, hand, eye, body, cigarette, e-cigarette, phone, can, bottle, and mask: double-click the midpoint handle of a box's top edge, then drag. Repeat for bottom, left, and right. Only the chosen edge should change. Check while zoomed/panned and near the image boundary.
- On a small nose box, double-click the top midpoint and drag upward with a little horizontal mouse movement. The left/right/bottom coordinates must not move. Repeat the adjustment once more.
- After adjusting an edge, press `Ctrl+B`. The title must show the correct edge and label. Apply to a few next/previous frames, then try `end`: matching boxes should receive the chosen edge position, keep their other three coordinates, preserve their current width/height on the untouched axis, preserve object classes and unrelated boxes, and skip Done frames. A target with no match must remain unchanged; the operation must never add or remove a box.
- In a 69-frame clip, enter `200` and verify it stops at the clip's final frame exactly like `end`, without updating a target more than once. Repeat the adjust-and-apply workflow and verify no duplicate boxes appear.
- Press `Z` after the batch: all target boxes should return to their previous coordinates. Press `Z` again to undo the source edge adjustment. Switching frame, label, or session must not reuse a previous edge operation.
- Press `N`, click inside the image, then click the black margin below it. The box should save with its bottom edge at the image boundary. Repeat for all edges/corners and while zoomed or panned.
- Start the box in the black margin and finish inside the image. The first corner should snap to the edge. Two corners entirely outside the same edge must not save an empty box; move inside and click again, or cancel with `Esc`.
- On an editable bbox frame, select one or more boxes intended for removal and press `R`. Only the selected boxes should be deleted, just like Delete. Check that Delete/Backspace still work, and that R without a selection changes nothing.
- Hold `R`, type `r` in the part search box, and try `R` on a Done frame. There should be no repeated or unintended deletion. On seatbelt, `R` should still accept the ready SAM3 preview.
- Expand a long clip and scroll down through its frames. Its header (toggle, clip number, and status buttons) should stay directly below the search/image-loading toolbar.
- Collapse the clip using the pinned toggle, then reopen it. Scroll into another expanded clip and confirm that its own header takes over.
- Mark a long clip Done and collapse it while scrolled near its end. Its header must remain visible instead of jumping to a later part. Repeat by collapsing while Done is still saving, and with the following clips already collapsed.
- Resize the sidebar/window and check that the pinned controls do not overlap the toolbar. Use `A` / `D` to reveal frames and confirm they are not hidden behind the pinned controls.
- Click **auto_load_img** in part 1. Confirm the names show parts 1 and 2, and the denominator is their combined frame count.
- Edit labels and use `A`, `D`, or `Space` while loading. The loader must not change the displayed frame or annotation data.
- Leave playback paused. The image count should continue increasing without further input.
- Click **Stop**. The count should stabilize; completed images remain available. Click **auto_load_img** to continue missing images without reloading the completed ones.
- Once the counter says **Ready**, revisit downloaded frames. Network waiting should be reduced; image decoding and other DMS requests can still take time.
- Complete the last unfinished clip in part 1. Once **all frames** are saved as Done, the names change to parts 2 and 3. Part 2's stored images remain; part 3 fills the available slot.
- If earlier frames in part 1 are unfinished, marking just its last clip Done must not advance the pair.
- Repeat with part 2, then test the last part (only one part remains).
- Stop, open a different part, then start. The pair should start at the newly opened part.
- Switch label/session and verify that loading stops and the counter resets.

The existing Done buttons save real DMS status changes; use frames you actually intend to mark Done when checking the automatic transition.

## Automated checks

Run with Python and Playwright/Chromium installed:

```powershell
python tests/test_preload.py
python tests/test_bbox_copy.py
python tests/test_sidebar_scroll.py
python tests/test_bbox_shortcuts.py
python tests/test_bbox_boundary.py
python tests/test_bbox_edges.py
python tests/test_timeline_lock.py
python tests/test_playback.py
python tests/test_bbox_previous.py
python tests/test_bbox_drag.py
python tests/test_part_done.py
python tests/test_bbox_adjust.py
python tests/test_status_controls.py
python tests/test_filter_scroll.py
python tests/test_bulk_status.py
```

The image-loading tests use delayed local responses, actual IndexedDB and Chromium image decoding. They cover request limits, cache hits, Stop/resume, part transitions, failed optimistic Done saves, scope changes, failed image retries, quota errors, and integration with the Organizer. When the saved local DMS source is available, the integration check uses its original `getFrame` and `show` implementations.

The sidebar tests use long clips and local status-save responses. They check header position after collapse, successful/failed pending saves, native-style repaints and list rebuilds, keyboard toggles, frame navigation, and closing near the end of the list.

The edge tests exercise all 13 bbox labels and all four edges through mouse gestures, the Ctrl+B dialog, local save responses, and Z undo. They verify unchanged target edges/boxes/classes, Done/clip limits, missing-box creation, zoom/pan, and label/session/frame scope. If the saved DMS source is available, the tests use its original hit testing and mouse handlers.

The timeline tests cover locked/unlocked mouse, touch and pen input; keyboard/sidebar navigation; playback; reload persistence; keyboard access to the lock; high-DPI resizing; hidden timelines; and unavailable local storage. When available, the saved DMS source supplies the native timeline click handler.

The playback tests use 12,000 sidebar rows to verify that repeated navigation/lookahead and frame highlighting avoid full-list enumeration. They cover filter/list/label/session invalidation and only-todo rebuilds. Cached Space playback is also exercised with local image responses, asserting ordered display and no new image requests while the tested lookahead remains in the downloaded parts. Local saved viewer code supplies the original playback and image-cache functions when available. This is a controlled browser test, not a live-server FPS guarantee.

The C-shortcut tests cover sequential and out-of-order navigation, saved/auto-label sources, hidden Done frames, explicit deletions, nearest nonempty lookup, all-box replacement, undo, Shift+C, clipboard isolation, and delayed-load cancellation/error cases. All data is local to the browser fixture.

The boundary-drag tests check every intermediate movement across the bottom edge, outside handle starts, all 13 bbox labels, all four image boundaries, zoom/pan, single-save behavior, undo, pointer cancellation, focus loss, and editor/context guards. They use the original saved DMS mouse handlers when available, or a standalone canvas-only drag contract. These tests reproduce the boundary freeze locally; confirm the feel in your DMS tab as well.

The part-status tests use local status responses to check full-part Done/In progress, mixed states, collapsed and hidden rows, label authorization, the four-request limit, progress, partial failures/retries, session changes, sticky positioning, resize and keyboard use. An integration check verifies the two-part preloader waits for successful Done saves before advancing. No live annotations or statuses are changed by these tests.
