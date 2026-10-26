# Changelog

## 1.6.49 - 2026-10-26

- In face 7pt labeling, press `N` and drag a face rectangle to preview the seven numbered landmarks; release to create them. `Esc` cancels, `Z` undoes, and existing points are preserved when adding another group.
- Keep `Delete` and `Backspace` as deletion shortcuts: on eye 15pt they delete the selected eye like `R`; on face 7pt they mark selected point(s) Not found like `R`. Bounding-box and seatbelt native Delete behavior stays available, and seatbelt `R` still accepts SAM3 previews.
- Add browser regressions for live preview, cancellation, frame changes, undo, and landmark deletion shortcuts.

## 1.6.48 - 2026-10-26

- Add `C` / `Shift+C` and `Ctrl+C` / `Ctrl+V` to face 7pt and seatbelt, with `Z` undo for copied annotations. Face 7pt also records native point edits for undo. Keep face `X` for Not found points and seatbelt `R` for SAM3.
- Match eye 15pt groups by image position when **Ctrl+B → Selected eye only → Replace matching eyes and keep the others** is used. Copying a left eye into a frame that only has a right eye now adds the left eye without deleting the right.
- Add browser regressions for these shortcuts and the selected-eye bulk merge.

## 1.6.47 - 2026-10-25

- When a G start is marked, `Ctrl+B` automatically selects **From G to current frame** in both **Change status** and **Label actions**. Without a G start, the dialog returns to the usual next-frame selection.
- Clear G after a successful G-range operation. Keep it when the dialog is canceled, saving fails, or a different target direction is applied, so the range can be retried.

## 1.6.46 - 2026-10-24

- Add eye 15pt shortcuts: `N` creates a group on the next image click, `R` deletes the selected eye, `X` deletes all, `1` / `2` delete left/right, `C` copies the nearest earlier nonempty frame, `Ctrl+C` / `Ctrl+V` copy between frames, and `Z` undoes group and point edits. `Shift+X` and `Shift+C` advance afterward. Move the native closed-eye shortcut to `Alt+C`; its checkbox remains available.
- Add a **Done all ▾** menu to each sticky part control with direct **Done all** and **In progress all** actions. Keep the existing checkbox toggle and part-wide progress behavior.
- Add browser regressions for eye creation, deletion, copy, undo and guards, plus the part menu at a scrolled position.

## 1.6.45 - 2026-10-24

- Add `G` to mark a range start. `Ctrl+B` now offers **From G to current frame** in both **Change status** and **Label actions**, avoiding manual frame counts. Status includes both endpoints; label actions exclude the current source frame. The range stays within one clip and works in either direction.
- Show the G start beside the canvas V counter and in the frame list. Press `G` again to clear or move it; changing session or label clears the mark. Add browser coverage for status and bbox, landmark and seatbelt label actions.

## 1.6.44 - 2026-10-24

- Keep the sidebar at the user's scroll position for the entire `Space` playback session, including asynchronous annotation repaints, sidebar rebuilds, and clip grouping. The highlighted frame still advances; a deliberate `A` / `D` or frame click after pausing still reveals its destination.
- Add a browser regression that reproduces the v1.6.43 jump from **Other** into the part below: an asynchronous repaint and list rebuild moved `scrollTop` from 24 to 2058. Verify it stays at 24 and `D` navigation still reveals the selected row afterward.

## 1.6.43 - 2026-10-24

- Keep the sidebar viewport fixed during `Space` playback, including long **Other** parts, while still updating the current-frame highlight. Deliberate `A` / `D` and frame clicks continue to reveal their destination.
- Reload face 7pt and eye 15pt editor data by global frame before painting. This prevents collected sources with repeated segment/local-frame keys from reusing stale landmark state and losing face point 0 after rapid `D` navigation.
- Treat missing auto-label responses as a retryable load failure instead of painting and pinning an empty bbox or landmark editor to the destination frame.
- Add browser regressions for stable sidebar playback and rapid face 7pt navigation with repeated source keys.

## 1.6.42 - 2026-10-24

- Keep the previous display visible during fast `A` / `D`, sidebar, timeline, and `Space` navigation until both the target image and its bbox data are ready. Rapid navigation now discards stale loads and paints only the latest requested frame, preventing cached images from appearing temporarily without boxes.
- Extend **auto_load_img** to preload raw auto-label/bbox responses for the current two-part window with at most two background requests. Responses stay in IndexedDB and are parsed only on use, rotate with the part window, and have a separate loaded/total segment counter.
- Release keyboard focus from the part **Done all** checkbox after it changes so bbox shortcuts such as `R`, `C`, and `Z` remain available while status saves run.
- Add browser regressions for rapid `D` navigation, bbox data stored on disk and released on part rotation, bounded bbox concurrency, and `R` / `C` / `Z` during pending **Done all** saves.

## 1.6.41 - 2026-10-24

- Keep bbox editing available while **Done all** or another clip/part status batch is saving, so `R` and `C` act immediately instead of waiting for the complete status queue. Status controls remain locked against overlapping status batches, and the currently open frame is queued last.
- Keep **auto_load_img** progressing with one bounded background image request while frame statuses save, instead of pausing until **Done all** finishes.
- Add a browser regression that holds four status saves open and verifies concurrent bounded preloading plus immediate `R` deletion and `C` previous-frame copying.

## 1.6.40 - 2026-10-24

- Fix temporarily missing bbox annotations during fast `Space` playback in parts such as **Other** that collect frames from different source segments. Load the target image and its auto-label data concurrently, prepare upcoming auto-label segments with at most two lookahead requests, and display a frame only after its annotations are ready. Saved edits continue without waiting for auto-label data.
- Add a multi-segment cached-playback regression to ensure every painted frame already has its annotation data and auto-label lookahead stays bounded.

## 1.6.39 - 2026-10-24

- Enable the complete bbox shortcut workflow for all 13 bbox labels, including single-box labels such as head, mouth, nose, face, and face mask, plus object labels. `X` / `Shift+X`, `1` / `2`, `C` / `Shift+C`, `Ctrl+C` / `Ctrl+V`, `V`, `Ctrl+B`, and `Z` now use the same behavior previously limited to body, hand, and eye.
- Add browser regression coverage for quick deletion, undo, clipboard copy/paste, and nearest-earlier-frame copying across every bbox label.

## 1.6.38 - 2026-10-23

- Add **⚠ Warn** BBox error warning filter (`bbox-warn.js`): loads session auto-labels (`<= 2` concurrent segments), evaluates 4-layer session + clip anomaly rules (`dup`, `tiny`, `size`, `ratio`, `pos`, `jump`, `count`, `drift`) while respecting the multi-box `body` convention, and filters the sidebar to flagged frames with `.nl-warn-badge` reason badges. Navigation (`A` / `D`, `Space`), `C`, `Ctrl+B`, **Done all**, and **auto_load_img** operate strictly on the listed warning frames.
- Restore toolbar **Done all** and scope sidebar actions to active filters: after confirmation, **Done all** marks every unfinished frame currently listed in the sidebar Done (collapsed clips included), waiting for the listed frames' BBox counts to load and skipping unknown counts. While a BBox filter is entered, part **Done all**, clip status buttons, `Ctrl+B`, and `C` apply only to the filtered frames shown in the sidebar; when **BBox** is empty, they apply to all frames.
- Show BBox count progress below the **BBox** row while a filter is entered: counted/total listed frames, matches, loaded segments, and unknown counts.
- Speed up status changes on long sidebars: repaint only rows whose status or edit mark changed and refresh only their clips (about 52 ms to 5 ms per change at 12,000 frames while the current frame is in view). V markers update only the toggled frames instead of every row.
- Seatbelt Ctrl+B mask copy skips target frames whose mask would not change, so they are not re-saved or switched to In progress.
- Speed up **auto_load_img** (7.3 s → 3.7 s for 120 frames at 100 ms server latency in a local browser benchmark) and align it with all sidebar filters: start the next download as soon as one finishes instead of waiting 50 ms after the last of each batch, use 4 parallel requests on HTTP/1.1 or 6 on HTTP/2/3, and keep one background request while the viewer loads frames. Download sequentially from the open frame onward, then earlier frames, for all frames shown in the sidebar (including Done frames when **Show done** is enabled), and slide the two-part window when navigating into the second part or when active status/BBox filters hide a part.
- Modularize the Organizer content scripts into focused domain modules (`core.js`, `styles.js`, `sidebar.js`, `bbox-warn.js`, `bbox-filter.js`, `bbox-tools.js`, `seatbelt-eye.js`, `bulk-dialogs.js`, `content.js`, `preload.js`) and unify test script injection through `tests/_ext.py`.

## 1.6.37 - 2026-10-22

- Restore the **BBox** exact-count filter below part search for bbox labels (`2,3,4`, **All**). Counts include saved edits and refresh after edits and Ctrl+B; `A` / `D` and `Space` follow the filtered frames, and a frame hidden after an edit resumes at its nearest visible neighbor.
- Reduce filter load: read auto-labels only while a count is entered, at most two segments at a time, current frame first, limited to parts matching the part search, once per session and label. Cache per-frame counts, throttle list refreshes, and skip per-row work while the filter is off.
- Make **auto_load_img** follow the filter: download only matching frames, wait for unknown counts (also loaded for preloaded parts hidden by part search), keep downloaded images when the filter changes, skip parts without matching frames, re-select the two parts when the filter changes, and treat a part as complete once its filtered frames are Done.
- Add browser coverage for count loading order and concurrency, part search scope, read failures, navigation, edits, label scope, preloader integration, and a 12,000-frame list.
- Pace Labeling Space playback by the selected frame list at 10 frames/second at 1×, adjusted by the existing speed/step controls. Timestamp gaps/repeats no longer cause pauses followed by rapid catch-up frames.
- Present through the browser animation clock and resume from the actual presentation time after a stall. Request the next image before warming three successors, with at most four outstanding viewer loads; reuse the existing two-part cache.
- Reject stale playback results after pause/resume, navigation, filters, label/session or image-setting changes. Stop with a retry message if the next image fails; keep review-mode playback native.
- Add browser regressions for cached timestamp gaps/repeats, a 230 ms rendering stall, request priority/limits, pending-image cancellation, speed changes, filtered-list boundaries, native fallback, and cached Space playback with BBox filters.

## 1.6.36 - 2026-10-22

- Fix the remaining Show done jump at the top of the sidebar: keep the visible filter controls in place instead of anchoring a part below newly inserted Done groups. Continue anchoring list content when the controls are scrolled out of view.
- Keep filter-triggered replacement images from scrolling the sidebar when loading finishes; preserve deliberate frame navigation.
- Reproduce the v1.6.35 jump with real checkbox clicks and a scrolling header/preloader layout. Cover repeated toggles, open/collapsed clips, two sidebar widths, keyboard access, empty results, hidden current frames, delayed image loads, and later repaints.

## 1.6.35 - 2026-10-22

- Keep the browsed sidebar part in place when Show done makes a hidden current frame visible again. Capture a filter-specific scroll anchor even when the current frame has no row in the filtered list.
- Retain the v1.6.34 behavior for removing statuses, deliberate navigation, sticky clip headers, and clip collapse; add a regression for the hidden-current-frame case.

## 1.6.34 - 2026-10-22

- Preserve the visible sidebar frame, clip, or part when Show done, Show in progress, or Show not checked inserts or removes content above the viewport. Avoid jumping to a different part when the current frame is off screen.
- Keep deliberate frame navigation unchanged and add browser regression coverage for showing and hiding a completed part above the user's scroll position.

## 1.6.33 - 2026-10-22

- Count the current frame in Ctrl+B Change status previous/next ranges, then continue in the selected direction. Keep Label actions unchanged so copy, delete, and edge adjustment still exclude the source frame.
- Update the status preview and add regression coverage for numeric and `end` ranges in both directions, hidden frames, and Label actions isolation.

## 1.6.32 - 2026-10-22

- Split Ctrl+B into Label actions and Change status tabs. Remember the last selected tab across reopening, labels, and page reloads; retain pending label operations when switching tabs.
- Add bulk Not checked, In progress, and Done destinations for previous/next ranges or V-marked frames. Bound ranges to the complete active-label clip, include hidden/Done frames, skip unchanged statuses, and preserve annotations.
- Allow V to mark any status for all labels. Keep marks available after status changes, include the current frame when explicitly marked, and clear selections on session/label changes.
- Keep at most four concurrent saves, show progress, support partial-failure retries, and stop queued writes on context changes. Test tab persistence, range limits, mark reuse, status-only writes, copy/adjust behavior, and keyboard submission.

## 1.6.31 - 2026-10-22

- Replace Show only unfinished with three independent, remembered filters: Show done, Show in progress, and Show not checked. Combine them with part search and keep navigation/playback aligned with the filtered sequence.
- Change each clip's status buttons into source-status menus. Hover or click Done, Not checked, or In progress, then choose one of the other two statuses. Change only matching frames in the complete current-label clip, including hidden frames; preserve other statuses and annotations.
- Show source counts and save progress, support mouse and keyboard access, and keep menus accessible from sticky clip headers. Stop queued saves on errors or session/label/mode changes; retries process remaining source frames.
- Test all filter combinations, all six transitions, hidden-frame scope, persistence, failures/retries, keyboard menus, sticky collapse, full-part Done controls, and playback.

## 1.6.30 - 2026-10-21

- Fix midpoint edge adjustment on small boxes such as nose: after double-clicking top, bottom, left, or right, dragging is locked to that exact edge even when the native corner hit area overlaps it.
- Apply an adjusted edge only to an existing corresponding target box. Preserve its other three coordinates and target-frame dimensions, and never add, remove, merge, or duplicate boxes when propagating an edge.
- Keep numeric ranges such as 200 bounded by the current clip exactly like `end`, skip Done frames, and avoid saving unchanged targets on repeated application.
- Add regression coverage for repeated nose adjustments over a 69-frame clip, `200` versus `end`, all bbox edge transforms, missing targets, duplicate prevention, and unchanged-frame saves.

## 1.6.29 - 2026-10-21

- Add a sticky Done all checkbox below each part's frame count. Check to mark the current label's complete part Done; uncheck to set every frame In progress. Show an intermediate state for partially completed parts.
- Include collapsed clips and Done frames hidden by the unfinished filter. Keep the counter and checkbox visible while scrolling within the part, and show save progress with at most four concurrent status requests.
- Reflect successful saves only, stop queued writes on errors or session/label/mode changes, and preserve unrelated parts, labels, and annotations. Keep status controls usable after bulk edits and undo.
- Add browser coverage for full-part scope, failures/retries, sticky scroll/resize, keyboard access, and automatic preloader advancement after successful completion; update the English guides.

## 1.6.28 - 2026-10-21

- Keep native bbox drags receiving pointer movement when a corner or edge crosses the image boundary, fixing freezes and jumps while dragging horizontally along the bottom edge.
- Let the outside half of a boundary handle start a drag. Preserve native resize geometry, clip outside coordinates on release, save once, and retain undo and single-edge bulk adjustments. Cancel an unsaved drag on pointer cancellation or window focus loss.
- Add Chromium regression coverage for continuous movement, all 13 bbox labels, four image edges, zoom/pan, save/undo, and context guards.
- Publish together with the cached Space-playback optimization and nearest-previous-frame C behavior from 1.6.26 and 1.6.27.

## 1.6.27 - 2026-10-21

- Change body/hand/eye C to copy all boxes from the nearest earlier nonempty frame of the same label and session, using chronological frame order instead of visit history. Include unvisited and hidden Done frames; prefer saved edits and skip explicit empty edits.
- Preserve whole-target replacement, Z undo, and Shift+C advancement. Leave the target unchanged when no source exists or source annotations cannot be read.
- Cancel pending copies when the target frame, session, label, or boxes change; guard repeated presses and active editing gestures. Remove the obsolete visit-history snapshots.
- Add browser regression coverage for the requested frame sequence, empty-frame fallback, current saved edits, async races, and independent Ctrl+C/Ctrl+V behavior; update the English guides.

## 1.6.26 - 2026-10-21

- Reduce Space playback stalls on large lists by indexing frame positions once and reusing that index for navigation and lookahead, instead of repeatedly scanning the full sidebar.
- Update only the previous/current frame rows and clip highlight during playback. Avoid refreshing every clip and marked-frame control for a highlight-only change; retain status panels, only-todo filtering, frame history, and scroll behavior.
- Rebuild the index on filter, list, label, or session changes. Keep image-download limits and bitmap caching unchanged.
- Add a 12,000-frame regression check and native cached Space-playback integration test with local responses.

## 1.6.25 - 2026-10-21

- Add a padlock beside the bottom timeline to prevent accidental frame jumps from clicks or drags. Keep keyboard navigation, playback, and sidebar frame selection available while locked.
- Remember the lock choice across page reloads. Keep the button beside the timeline on resize and hide it when the native timeline is hidden.
- Add browser checks for mouse/touch/pen input, normal navigation, persistence, layout, and storage failures; update the English guides.

## 1.6.24 - 2026-10-21

- Extend top, bottom, left, and right edge adjustment from body to all 13 bbox labels. Double-click a midpoint handle, then drag the chosen edge.
- Make Ctrl+B repeat that edge's exact position for every bbox label, with the correct label in the dialog. Preserve the other three target edges, matching rules, object classes, and Done-frame skipping.
- Add Z undo for these edge edits and their whole bulk batches. Keep pending edge operations scoped to their frame, label, and session.
- Add browser regression checks for all labels/edges, bulk saves, undo, missing boxes, zoom, and scope guards; update the English guides.

## 1.6.23 - 2026-10-21

- Allow either corner of a new bbox to be clicked in the black margin around the image. Clamp the preview and saved box to the image edges, including while zoomed or panned.
- Validate the clipped box size so clicks entirely outside one edge cannot save a zero-area box. Viewer controls and sidebar clicks do not finish the draft.
- Add browser checks for all bbox labels, edges/corners, zoom, resolution changes, cancellation, Done locks, and undo.

## 1.6.22 - 2026-10-20

- Add `R` as an alias for the native Delete action on all bounding-box labels, including multiple selected boxes.
- Require a selection through the native handler; ignore held-key repeats, typing, modifier chords, dialogs, locked frames, active drags, and stale editor frames.
- Preserve Delete/Backspace and the seatbelt `R` shortcut for accepting SAM3 previews.

## 1.6.21 - 2026-10-20

- Fix the sidebar jumping to a later clip or another part when collapsing a long clip from its sticky header, including after marking it Done.
- Anchor the clicked header when toggling so it stays within reach after the list changes height.
- Add browser regressions for Done followed by collapse, pending/failed saves, repainting, list rebuilding, keyboard toggles, and short remaining lists.

## 1.6.20 - 2026-10-20

- Keep each clip's expand/collapse toggle and status buttons visible below the search/image-loading toolbar while scrolling through its frames.
- Adjust the sticky offset when the toolbar changes height, and leave room above frames revealed by keyboard navigation.

## 1.6.19 - 2026-10-20

- Add **auto_load_img**, **Stop**, and a combined image counter for the current part and the next unfinished part.
- Download up to three images concurrently in the background and keep compressed images in IndexedDB instead of decoding the entire pair into RAM.
- Release the first part's cache after all its frames are successfully saved as Done, then load the next unfinished part. Preserve the overlapping part.
- Keep completed downloads on Stop; resume missing images for the currently open part and the next part. Share foreground/background requests for the same image.
- Clear preloader state on session, label, resolution/quality or mode changes. Display failed downloads and storage errors without blocking normal viewing.
- Prepare up to three nearby frames when navigating with `A` / `D`.

## 1.6.18 - 2026-10-20

- Translate the extension interface, dialogs, notifications, updater setup, and native updater messages into English.
- Add five installation screenshots to the GitHub README, with a concise feature guide and complete keyboard shortcut tables.
- Rewrite the popup help and usage guide in English, documenting current box matching, bulk editing, and frame marking behavior.
- Preserve annotation behavior and shortcut bindings from 1.6.17.

## 1.6.17 - 2026-10-19

- Fix `Ctrl+B` after dragging a body edge: match targets using the geometry before/after the edit and the source layout, instead of left/right order. A missing small box no longer causes a larger box to shrink.
- Add the edited source box if no match exists; otherwise set only the selected edge to the blue line's absolute coordinate. Preserve the other three edges and other objects, and merge matching duplicates.
- Test all four edges, missing boxes, different box orders, nested boxes, repeated copying, and batch undo.

## 1.6.16 - 2026-10-19

- Fix nearly duplicate source body boxes incorrectly protecting old target boxes. Copying groups source duplicates at 75% IoU; red warnings still use 90%.
- Test one source box replacing one or more old boxes of different heights, leaving one copied box at that position and preserving other objects.
- Recheck nested boxes, repeated copying, `Ctrl+C` / `Ctrl+V`, and bulk undo with `Z`.

## 1.6.15 - 2026-10-19

- Fix selected bbox copying with nested boxes: compare the full source layout to preserve enclosing boxes and other objects while replacing a matching narrow box with one copied box.
- Use the same matching for `Ctrl+B` and `Ctrl+C` / `Ctrl+V`. Repeated copies do not add duplicates; `Z` still undoes the whole batch.
- Add tests for nested boxes, size differences, duplicates, and repeated pasting.

## 1.6.14 - 2026-10-19

- Detect the Windows Extension ID in both `Preferences` and `Secure Preferences` for Chrome, Chrome Beta, Chrome Canary, and Chromium.
- If automatic detection is unavailable, prompt the user to copy the ID from `chrome://extensions` and paste it to continue setup.

## 1.6.13 - 2026-10-19

- Add `Install-NOTA-Updater.command` and a universal macOS native updater for Apple Silicon and Intel. After one-time setup, Mac users can use **Update now** as on Windows.
- Show separate Windows and macOS instructions on the updater setup page.

## 1.6.12 - 2026-10-19

- Prevent copying a small nested body box from replacing the enclosing box: matching now also checks width and height similarity while still merging true duplicates.

## 1.6.11 - 2026-10-19

- Identify matching boxes using both IoU and coverage of the smaller box. Replace all matching duplicates at a position with one source box, even when the old box is much taller.

## 1.6.10 - 2026-10-19

- Use a 50% IoU threshold for selected bbox replacement to handle differing heights; keep the red duplicate warning threshold at 90%.

## 1.6.9 - 2026-10-19

- With selected bbox `Ctrl+B` or `Ctrl+C` / `Ctrl+V`, replace target boxes at 90% IoU or above. If none match, add the new box and preserve others.

## 1.6.8 - 2026-10-19

- Fix `Ctrl+B` after drawing an `M` delete region for hand and eye boxes: always open bulk deletion, including when the polygon closes on its first point or the source region contains no boxes.

## 1.6.7 - 2026-10-19

- Show red duplicate warnings only at 90% IoU or above. Small boxes partly overlapping or contained within larger boxes no longer trigger false warnings.

## 1.6.6 - 2026-10-19

- Correct the part frame-count orientation to read from top to bottom.

## 1.6.5 - 2026-10-19

- Change **Selected box only** in `Ctrl+B` to append the box without replacing existing target boxes.
- Highlight overlapping boxes with a red fill and border; show the total bbox count in the image corner.
- Show each part's total frame count in the left sidebar.

## 1.6.4 - 2026-10-19

- Fix the updater reporting the latest version while the popup still shows the old running version.
- Reload whenever files on disk are newer than Chrome's running extension, even if the native updater returns `up_to_date`.

## 1.6.3 - 2026-10-19

- Standardize body/hand/eye box shortcuts: `X` deletes all boxes, `1` / `2` delete left/right, and `Shift+X` deletes all and advances.
- Make `C` and `Shift+C` always copy all boxes from the previously viewed frame. Preserve `Ctrl+C/V`, `V`, `Ctrl+B`, and `Z`.
- Remove the floating shortcut bar at the bottom of the screen.

## 1.6.2 - 2026-10-19

- Apply body edge edits using absolute coordinates: target edges move to the source blue line's position instead of receiving a pixel offset.
- Make the body/hand/eye toolbar buttons clickable while retaining keyboard shortcuts.

## 1.6.1 - 2026-10-19

- Allow selecting one body, hand, or eye box and copying it with `Ctrl+B`. Replace the box at the same left/right rank and preserve other boxes.
- Prefer the selected box for `Ctrl+C` / `Ctrl+V` on labels with multiple boxes.
- Fix bulk bbox deletion from an `M` polygon for previous, next, or marked frames.

## 1.6.0 - 2026-10-19

- Add an always-visible shortcut bar for body, hand, and eye boxes.
- Add `X`, `Shift+X`, `1`, `2`, `C`, `Shift+C`, `Ctrl+C`, `Ctrl+V`, `V`, and `Z` for quick bbox editing.
- Support bulk copying/deletion by frame count, to the clip boundary, or across marked frames.
- Add double-click and drag for one body edge: show the old edge in white and the new edge in blue, and propagate only that edge.
- Undo an entire bbox batch with one `Z`.

## 1.5.9 - 2026-10-19

- Fix NOTA Updater installer encoding on Windows PowerShell 5.1.

## 1.5.8 - 2026-10-19

- Add NOTA Updater for Windows through Chrome Native Messaging.
- After one-time setup, **Update now** downloads a GitHub release, verifies SHA256, replaces files, and reloads the extension.
- Detect the ID associated with the current unpacked folder and restrict the native host to that ID.

## 1.5.7 - 2026-10-19

- Create a bbox with `N`, a click on the first corner, pointer movement without holding a button, and a click on the opposite corner.
- Cancel before the second click with `Esc`.

## 1.5.6 - 2026-10-19

- Add **Check for updates** to the popup.
- Check the Chrome Web Store first, then GitHub releases.
- Automate packaging and releases with GitHub Actions.
- Preserve 1.5.5 features: filtered-list navigation, three clip statuses, bulk actions for all label types, eye 15pt group transforms, bbox `N` / `M`, and CVAT-style image-boundary clipping.
