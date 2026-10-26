# NOTA Labeling Organizer — usage guide

**Version 1.6.54 · English**

For installation screenshots and the complete shortcut tables, see the [GitHub README](https://github.com/tanmainhat0502/dms_annotation_extension#readme).

## Start

1. Load this folder through **Load unpacked** at `chrome://extensions`.
2. Reload DMS and open **Labeling**.
3. Search for a part, such as `ciga`, `phone`, or `bottle`.
4. Expand a clip (`#01`, `#02`, etc.) and open a frame.

`A` / `D` navigate the visible list; `Shift+A` / `Shift+D` move 10 frames. `Space` plays that same list and stops at its end. Clearing the search with `Esc` or `×` restores all parts.

Playback reuses the frame-list index and updates only the previous/current rows to reduce stuttering on large lists, including when images are cached. It keeps the sidebar viewport fixed while Space advances through long collected parts such as **Other**, even if annotations finish loading or the list rebuilds between frames. Filter, label, session, and list changes refresh this index automatically.

For bbox labels, the **BBox** field below part search filters frames by exact box count for the selected label. Enter `2,3,4` to show frames with exactly 2, 3, or 4 boxes; click **⚠ Warn** to scan the full session and show only frames with likely bbox errors (`dup`, `tiny`, `size`, `ratio`, `pos`, `jump`, `count`, `drift`, while preserving normal multi-box `body` frames); click **All** or clear the field to show every frame. Counts and warnings include saved edits and refresh after an edit or Ctrl+B. `A` / `D` and `Space` follow the filtered frames. The filter reads auto-labels only while a count or warning filter is active, at most two segments at a time, starting at the current frame. Frames whose auto-labels cannot be read stay visible and are reported as unknown. A progress line below the field shows counted, matched, and unknown listed frames while counts load.

**Done all** at the end of the BBox row marks every unfinished frame currently listed in the sidebar Done, after confirmation: every frame of the label without filters, or only the frames still listed after part search and the BBox filter (collapsed clips included). Frames with unknown BBox counts are skipped. While a BBox filter is entered, part **Done all**, clip status buttons, `Ctrl+B`, and `C` also apply only to the filtered frames shown in the sidebar; when **BBox** is empty (**All**), they apply to all frames.

To prevent accidental jumps, click the **padlock to the right of the bottom timeline**. A closed, gold lock blocks clicks and drags on the timeline; the progress display, `A` / `D`, `Space`, and sidebar frame selection still work. Click the lock again to allow timeline navigation. The timeline starts unlocked and remembers your choice after a page reload.

Below the progress bar, tick **Show done**, **Show in progress**, and **Show not checked** to choose which frames appear. Any combination works; no choices shows an empty list. These choices combine with part search, apply to `A` / `D` and `Space`, and are remembered after reload. Filtering does not change saved statuses or the progress totals. While the checkboxes are visible, changing a filter keeps those controls at the same screen position. Farther down the list, the visible frame, clip, or part is kept in place. If the current frame is filtered out, loading its replacement does not scroll the sidebar away from the controls; deliberate frame navigation still reveals the selected frame.

Each clip has **Done**, **Not checked**, and **In progress** source buttons. Hover over or click one, then choose either of the other statuses. For example, **Done → In progress** changes only that clip's Done frames; its other frames stay unchanged. The menu shows how many source frames exist, including frames hidden by filters. A button is disabled if no frames have that source status. Hovering or opening the menu does not save anything. Click a destination to save, or press `Esc` to close; keyboard users can open with `Enter`, `Space`, or an arrow key and select with the arrow keys.

Status changes affect only the active label, preserve annotations, and send up to four requests at once. Errors stop new requests; retrying the same transition picks up frames still in the source status. Changing session, label, or mode stops queued requests. A checkpoint marks the last edited frame. The list preserves its scroll position during edits and brings newly opened frames into view.

To set an entire part's status, use **Done all ▾** below its frame count in the left column and choose **Done all** or **In progress all**. The checkbox remains a quick toggle: tick it for Done, untick it for In progress. A dash means only some frames are Done. The control stays visible while scrolling within that part.

This action covers the current label's whole part, including closed clips and frames hidden by status filters. It pauses playback, shows saved/total progress, and saves up to four frames at a time. BBox editing remains available, so `R`, `C`, and `Z` work immediately after clicking the checkbox, and **auto_load_img** continues with one background request; the open frame's status is saved last. Other parts, labels, and annotations stay unchanged. A failed request stops further saves; successful saves remain. Switching session, label, or mode stops queued requests. Enable **Show done** to see completed parts and reopen them with the checkbox.

While you scroll through an expanded clip, its header stays below the search/image-loading toolbar. You can collapse the clip or use its status buttons without scrolling back to the beginning. The next clip's header takes its place as you scroll into that clip.

Collapsing a clip keeps its header in view instead of jumping to another part, including after marking the clip Done or while its status is still saving.

## Load images while you work

Click **auto_load_img** below the part search box. It downloads images and raw bbox responses for the current part and the next part that has frames in the sidebar, using up to four image requests (six over HTTP/2 or HTTP/3) and two bbox-segment requests. Loading runs sequentially from the open frame to the end of the part, then fills earlier frames, including Done frames when **Show done** is enabled. Separate counters show stored images and stored bbox segments for those two parts. Editing and navigation remain available; loading continues while you pause playback or stop interacting.

When you move into the second part, or when all frames in the first part are hidden from the sidebar (for example, saved as Done while **Show done** is off), the extension releases the first part's cache and loads the next matching part: **1+2 → 2+3 → 3+4**. A failed Done save does not advance the pair. The last matching part loads alone.

**Stop** cancels background requests and keeps completed images. Click **auto_load_img** again to fill the current part and the next matching part, keeping any already loaded images in that pair. This also retries failed images. Navigating to another part while the loader is running slides the two-part window to start at that part.

Images and raw bbox responses are stored in local browser storage; background loading does not decode thousands of bitmaps or parse thousands of bbox objects into RAM. Normal viewing reads only what the current frame needs, and `A` / `D` prepare up to three nearby frames.

In Labeling, `Space` plays the selected list at an even **10 frames/second at 1×**. The speed control still applies, including the viewer's frame stepping above 2×. Source timestamp gaps/repeats do not interrupt the cadence. The current-row highlight advances without scrolling the sidebar away from the user's current position. Fast `A` / `D`, sidebar selection, timeline jumps, and `Space` retain the previous display until the target image and annotation data are both ready; stale rapid-navigation results are discarded, and face 7pt/eye 15pt reload from the destination global frame. Slow decoding/rendering delays presentation instead of showing a frame without its annotations or triggering a burst of overdue frames. Pause/resume and changing labels or sessions discard stale results. Review modes keep their original player.

The image background limit applies per tab and drops to one request while the viewer fetches frames or frame statuses are saving. Bbox loading uses at most two requests and also drops to one during foreground work. There is no fixed images-per-second limit. Speed and server load depend on the connection, server capacity, and number of users or tabs loading data.

The pair includes every frame in those two parts that matches the active status filters (**Show done**, **Show in progress**, **Show not checked**) and the **BBox** filter. With a **BBox** filter, frames whose counts are still loading wait until they are known. Changing status or BBox filters keeps already downloaded images and updates the two-part window automatically. Changing session, label, image size/quality, leaving Labeling, or reloading the tab clears the preloader's cache. No annotation data is changed by preloading.

## Bulk actions: Ctrl+B

The dialog has two tabs: **Label actions** and **Change status**. It remembers your last selected tab across closing, labels, and page reloads. Switching tabs does not apply an operation or discard your pending label edit. On macOS, use `Cmd+B`.

### Label actions

1. Edit or select an annotation in the source frame.
2. Press `Ctrl+B`, select **Label actions**, and choose what to apply.
3. Choose **Previous frames** or **Next frames** and enter a positive frame count or `end`. Alternatively, press `G` on the first target before opening the dialog, then move to the source frame. `Ctrl+B` automatically selects **From G to current frame** without a count.
4. Check the preview, then click **Apply** or press `Enter`.

The source frame is excluded from the count. Done targets are skipped; saved Not checked targets become In progress. Up to four saves run at a time. On an error, no new saves are started; earlier successful saves remain applied.

For every bbox label, `V` marks targets and this tab offers **Marked frames**. These targets can span clips in the same session and label.

The G range stays in one clip and excludes the current source frame for all label actions, including copy, delete, edge adjustment and seatbelt mask edits. The first G frame may be before or after the source.

`Esc` / **Cancel** discards the pending region; it does not undo edits already saved. A running bulk save cannot be canceled through this dialog.

### Change status

1. Open `Ctrl+B` and select **Change status**.
2. Choose **Not checked**, **In progress**, or **Done** as the destination.
3. Choose **Previous frames** / **Next frames** and a positive count or `end`, choose **Marked frames** to use frames selected with `V`, or press `G` on a start frame to automatically select **From G to current frame**.
4. Review the target count, then click **Apply** or press `Enter`.

This tab changes only the active label's frame status. It works without source annotations and includes Done frames. Previous/next counts include the current frame, then continue in the selected direction through hidden frames in the complete current-label clip. They stop at the clip boundary even if the count is larger than the remaining range. Marked targets may span clips, include hidden frames, and include the current frame if you marked it.

The G range includes both its start and current frame, in either direction, within one clip. It also includes frames hidden by status filters. A ✓ G badge marks the start beside the V counter and in the frame list. G clears automatically after a successful range action, but remains after cancellation or a failed save. Press `G` again on the marked frame to clear it manually, or press `G` on a different frame to move it. Changing session or label clears the G mark.

Existing annotations are preserved. Frames already at the destination status are not saved again. Up to four requests run at once; an error stops new requests and leaves successful saves intact. Retry to save the remaining frames. Session, label, or mode changes stop queued requests. Cancelling this tab does not discard a pending label edit.

## Bounding boxes

Supported labels: body, head, face, nose, mouth, eye, hand, cigarette, e-cigarette, phone, can, bottle, and mask. Face 7pt also supports copying its full point groups.

- **Create:** press `N`, click the first corner, then click the opposite corner. Either click can be in the black margin around the image: the preview and saved box snap to the image edge, including while zoomed. A box must have enough width and height inside the image to be saved.
- **Delete selected boxes:** select one or more boxes, then press `R`, `Delete`, or `Backspace`. `R` uses the same selection and save behavior as Delete; it does nothing without a selection and does not repeat when held. On seatbelt, `R` still accepts the SAM3 preview.
- **Delete a region:** press `M`, draw a polygon, then click its first point or right-click to delete boxes inside it. The red region stays available for `Ctrl+B`; `Esc` clears it.
- **Copy one:** select a box or create one, then use `Ctrl+B` with **Selected box only** or **Newly added box only**. Matching target boxes are replaced, duplicates collapsed, and unrelated boxes preserved. A missing match adds a new box.
- **Copy all:** choose **All boxes in the current frame** to replace the target box list completely.

Matching compares box geometry with the source layout; it does not recognize people or objects from image pixels. Small boxes inside larger boxes remain separate when their geometry identifies distinct objects. Boxes with at least 90% IoU are shown in red; the image corner shows the box count.

Dragging or resizing continues when the pointer crosses into the black margin, including horizontal drags along the bottom image edge. You can grab the part of a boundary handle that lies just outside the image. On release, the outside portion is clipped to the image boundary and the box is saved once. Losing window focus or canceling the pointer restores the unsaved drag.

### Shortcuts for every bbox label

`X` deletes all boxes; `1` / `2` delete the leftmost / rightmost box. For a single-box label such as head, mouth, or nose, either number deletes that box. `Shift+X` deletes all and advances one frame.

`C` replaces all boxes in the current frame with those from the **nearest earlier frame of the same label that has boxes**. It searches backward by frame number in the current session, skipping empty frames, including frames you have not opened and Done frames hidden by only-todo. Saved edits take precedence over auto-labels; a saved empty list remains empty. If no earlier frame has boxes, the current frame stays unchanged.

Example: C at frame 2 copies frame 1; after editing frame 3, C at frame 4 copies the edited frame 3. C at frame 6 uses frame 5 even if you did not edit it. If frame 7 is empty, C at frame 8 uses frame 6. `Shift+C` copies and advances once; `Z` restores the target's previous boxes. The notification identifies the source frame. Changing frames/labels/sessions or editing the target while source data loads cancels that pending copy.

`Ctrl+C` / `Ctrl+V` copy and paste between nonadjacent frames (`Cmd` also works). A selected box uses geometry matching; copying all boxes replaces the target list. `V` marks frames, `Ctrl+B` repeats the latest operation, and `Z` undoes it. One `Z` restores an entire bbox batch.

### Edge adjustment for every bbox label

For all 13 bbox labels listed above, double-click the middle handle of the **top, bottom, left, or right** edge, then drag it. The original edge is white and the edited edge is green. Only the chosen edge changes; it stays inside the image. This exact-edge drag also applies to small boxes such as nose, where the midpoint is close to corner handles.

Press `Ctrl+B`, choose previous or next frames, and enter a count or `end`. The matching box in each target frame receives that edge's **absolute position**, keeping its other three coordinates and its own width/height on the untouched axis. The operation never adds or removes boxes; a frame without a corresponding box stays unchanged. Other boxes stay; Done frames are skipped. A number larger than the remaining clip, such as `200` for 69 frames, stops at the same clip boundary as `end`. The dialog shows the active label and edge.

Press `Z` to undo the whole batch, then `Z` again to undo the source edge edit. This edge workflow applies to bounding boxes; face 7pt, eye 15pt, and seatbelt keep their own editing tools.

## Seatbelt masks

### Draw or erase a polygon

Press `N` to add or `M` / `Shift+N` to erase. Click at least three points, then right-click on the image or click the first point to close the polygon. Points placed in the surrounding black area snap to the image boundary.

Closing the polygon saves the current frame immediately. An add polygon exits drawing mode; an erase polygon stays red so it can be reused with `Ctrl+B`. Erasing affects only the mask inside the region.

`Z` removes the last point while drawing, or undoes the latest mask edit on the current frame. `Esc` clears the drawing or pending region; use `Z` to undo a saved edit.

`C` copies the full mask from the nearest earlier frame with a nonempty mask; `Shift+C` also advances. `Ctrl+C` copies the current full mask and `Ctrl+V` replaces the mask in another frame. `Z` undoes either paste or previous-frame copy. These shortcuts wait for any pending SAM3 preview or polygon to be resolved.

### SAM3

In **1 Point SAM**, left-click adds a positive prompt and right-click adds a negative prompt. Wait for the green preview, then press `R` or **Enter / Add** to add it. **Shift+Enter / Subtract** removes that area instead.

After adding, `Ctrl+B` defaults to **Latest added mask area only (SAM3)** and preserves existing target masks. After subtraction, it applies only the removed area. Choose **Entire mask from the current frame** when you intend to copy the full mask. If SAM3 changed no pixels, the extension reports that instead of silently copying the whole mask.

The dashed SAM3 box is a processing region, separate from the mask. It is remembered per frame and clip in the current tab and does not shrink to a newly added mask. Reloading the page or switching sessions clears this temporary memory.

`F` toggles Done / In progress, `Space` plays / pauses, and `K` toggles mask visibility without changing data.

## Eye 15pt

Press `N`, then click the center of an eye in the image to create a default 15-point group. Press `Esc` to cancel add mode. `R`, `Delete`, or `Backspace` deletes the selected eye; `X` deletes all eyes, and `1` / `2` delete the leftmost / rightmost eye. `Shift+X` deletes all and advances to the next frame. `C` copies all eye groups from the nearest earlier frame with eye points (skipping empty frames); `Shift+C` also advances. `Ctrl+C` copies only the selected eye; `Ctrl+V` replaces its matching eye on another frame and keeps the other eyes. `Z` undoes the latest eye edit, including point moves and group transforms. `Alt+C` toggles the selected eye's closed state; the **Closed eye** checkbox remains available.

Select an eye and press `Ctrl+B`. Choose **Selected eye only** or **All eyes in the current frame**, then choose whether to replace matching eyes and keep the others, or replace all target eyes. Matching uses the eye's image position; copying a left eye into a frame containing only the right eye adds the left eye and keeps the right.

Drag an empty area inside the dashed eye box to move all 15 points. Hold `Ctrl` while dragging to rotate; drag edge or corner handles to resize. Dragging a point edits only that point. `K` hides or shows the eye points without deleting them.

Double-click any upper eyelid point (2–7) to close the clicked eye along the upper lid, or any lower eyelid point (8–13) to close it along the lower lid. The other lid's six points move onto the clicked lid; the eye corners and pupil stay in place. `Z` undoes this change. The **Closed eye** checkbox and `Alt+C` remain available.

Clicking an empty image area clears the point selection without starting a dashed polygon. Drag across empty space to select multiple points with a rectangle; this also applies to face 7pt.

## Face 7pt

Press `N`, then click **between the eyes**, the **nose tip**, and the **mouth center**, in that order. After the second click, move the pointer to preview the seven numbered landmarks; the third click creates them automatically. The nose point stays on the exact second click. The eye corners and mouth corners are estimated from the three anchors, including face tilt, and can be dragged individually afterward. `Esc` or another `N` cancels before the third click.

The earlier rectangle method is available with `Shift+N`: drag over the visible face, from eyebrow level to the chin, and release to create. A small drag is ignored. Both methods fill an existing blank seven-point group or add a new group without replacing placed points. The rectangle is only a creation guide, not a saved face bbox.

`C` copies all seven points from the nearest earlier frame that has placed points; `Shift+C` also advances. `Ctrl+C` / `Ctrl+V` copy and paste the point group between frames. `Z` undoes creation, copying and point edits. `R`, `Delete`, `Backspace`, and `X` mark the selected point(s) as Not found. Seatbelt retains native `Delete` for mask selection and `R` for accepting a SAM3 preview.

## Mark frames with V

For every label, `V` marks or unmarks the current frame, whether it is Done, In progress, or Not checked. Mark any frames in the same session and label, then use **Ctrl+B → Change status → Marked frames** and select a destination. To reopen Done frames, choose **In progress**.

Marks remain after saving and when status filters hide the rows, so you can reuse the selection. Press `V` again or **Clear selection** to remove marks. Changing the session or label clears them. Every bbox label also uses the same marks in **Label actions**. `F` still toggles the current frame's Done / In progress status.

## Updates

Install the optional local updater once: on Windows, run `Install-NOTA-Updater.cmd`; on macOS, right-click `Install-NOTA-Updater.command` and select **Open**. The macOS binary is included in the GitHub release ZIP.

If prompted, copy the extension ID from `chrome://extensions`. Close and reopen the popup, then use **Check for updates** → **Update now**. The updater verifies SHA256 before replacing files and reloading the extension. Reload the DMS tab afterward.

For a manual update, extract the latest release into the same installation folder, reload the extension in Chrome, then reload DMS.

Supported sites: `https://ntt.dev.nota.ai/` and `http://10.169.1.102:8765/`. Search/grouping changes only the interface; annotation edits and status actions save through the open page.
