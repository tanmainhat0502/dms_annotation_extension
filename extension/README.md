# NOTA Labeling Organizer — usage guide

**Version 1.6.30 · English**

For installation screenshots and the complete shortcut tables, see the [GitHub README](https://github.com/tanmainhat0502/dms_annotation_extension#readme).

## Start

1. Load this folder through **Load unpacked** at `chrome://extensions`.
2. Reload DMS and open **Labeling**.
3. Search for a part, such as `ciga`, `phone`, or `bottle`.
4. Expand a clip (`#01`, `#02`, etc.) and open a frame.

`A` / `D` navigate the visible list; `Shift+A` / `Shift+D` move 10 frames. `Space` plays that same list and stops at its end. Clearing the search with `Esc` or `×` restores all parts.

Playback reuses the frame-list index and updates only the previous/current rows to reduce stuttering on large lists, including when images are cached. Filter, label, session, and list changes refresh this index automatically.

For bbox labels, the **BBox** field below part search filters frames by exact box count for the selected label. Enter `2,3,4` to show frames with exactly 2, 3, or 4 boxes; click **All** or clear the field to show every frame. Counts include saved edits and refresh after an edit or Ctrl+B. `A` / `D` and `Space` follow the filtered frames. The filter reads auto-labels only while a count is entered, at most two segments at a time, starting at the current frame and limited to parts matching the search. Frames whose auto-labels cannot be read stay visible and are reported as unknown.

To prevent accidental jumps, click the **padlock to the right of the bottom timeline**. A closed, gold lock blocks clicks and drags on the timeline; the progress display, `A` / `D`, `Space`, and sidebar frame selection still work. Click the lock again to allow timeline navigation. The timeline starts unlocked and remembers your choice after a page reload.

Each clip has **Done**, **Not checked**, and **In progress** buttons that set the entire clip's status. A checkpoint marks the last edited frame. The list preserves its scroll position during edits and brings newly opened frames into view.

To set an entire part's status, use **Done all** below its frame count in the left column. Tick it to mark all frames **Done**; untick it to make all frames **In progress**. A dash means only some frames are Done. The count and checkbox stay visible while scrolling within that part.

This action covers the current label's whole part, including closed clips and frames hidden by **Show only unfinished**. It pauses playback, shows saved/total progress, and saves up to four frames at a time. Other parts, labels, and annotations stay unchanged. A failed request stops further saves; successful saves remain. Switching session, label, or mode stops queued requests. When the unfinished filter hides a completed part, turn it off to reopen that part with the checkbox.

While you scroll through an expanded clip, its header stays below the search/image-loading toolbar. You can collapse the clip or use its status buttons without scrolling back to the beginning. The next clip's header takes its place as you scroll into that clip.

Collapsing a clip keeps its header in view instead of jumping to another part, including after marking the clip Done or while its status is still saving.

## Load images while you work

Click **auto_load_img** below the part search box. It downloads the current part and the next unfinished part, using up to three background requests. The progress counter is the number of images stored / all images in those two parts. Editing and navigation remain available; loading continues while you pause playback or stop interacting.

When all frames in the first part are saved as Done, the extension releases that part's cache and loads the next unfinished part: **1+2 → 2+3 → 3+4**. A failed Done save does not advance the pair. The last part loads alone.

**Stop** cancels background requests and keeps completed images. Click **auto_load_img** again to fill the current part and the next unfinished part, keeping any already loaded images in that pair. This also retries failed images. Opening a part outside the pair while the loader is running starts a new pair there.

Images are stored compressed in local browser storage; background loading does not decode thousands of bitmaps into RAM. Normal viewing uses those stored images, and `A` / `D` prepare up to three nearby frames. Some decoding or annotation loading delay may remain.

The three-request background limit applies per tab; there is no fixed images-per-second limit. Speed and server load depend on the connection, server capacity, and number of users or tabs loading images.

The pair uses the complete parts for the current label, even when the sidebar is filtered or Done frames are hidden. Changing session, label, image size/quality, leaving Labeling, or reloading the tab clears the preloader's cache. No annotation data is changed by preloading.

With a **BBox** filter, only frames the filter shows are downloaded and counted. Frames whose counts are still loading wait until they are known. A part is complete for loading once all its filtered frames are Done. Changing the filter keeps already downloaded images.

## Bulk actions: Ctrl+B

1. Edit or select an annotation in the source frame.
2. Press `Ctrl+B` and choose what to apply.
3. Choose **Previous frames** or **Next frames**.
4. Enter a positive frame count, or `end` to reach the clip boundary.
5. Check the preview, then click **Apply** or press `Enter`.

The source frame is excluded from the count. Done targets are skipped; saved Not checked targets become In progress. Up to four saves run at a time. On an error, no new saves are started; earlier successful saves remain applied.

For body/hand/eye boxes, `V` marks targets and the dialog offers **Marked frames**. These targets can span clips in the same session and label. On macOS, `Cmd+B` also opens the dialog.

`Esc` / **Cancel** discards the pending region; it does not undo edits already saved. A running bulk save cannot be canceled through this dialog.

## Bounding boxes

Supported labels: body, head, face, nose, mouth, eye, hand, cigarette, e-cigarette, phone, can, bottle, and mask. Face 7pt also supports copying its full point groups.

- **Create:** press `N`, click the first corner, then click the opposite corner. Either click can be in the black margin around the image: the preview and saved box snap to the image edge, including while zoomed. A box must have enough width and height inside the image to be saved.
- **Delete selected boxes:** select one or more boxes, then press `R`, `Delete`, or `Backspace`. `R` uses the same selection and save behavior as Delete; it does nothing without a selection and does not repeat when held. On seatbelt, `R` still accepts the SAM3 preview.
- **Delete a region:** press `M`, draw a polygon, then click its first point or right-click to delete boxes inside it. The red region stays available for `Ctrl+B`; `Esc` clears it.
- **Copy one:** select a box or create one, then use `Ctrl+B` with **Selected box only** or **Newly added box only**. Matching target boxes are replaced, duplicates collapsed, and unrelated boxes preserved. A missing match adds a new box.
- **Copy all:** choose **All boxes in the current frame** to replace the target box list completely.

Matching compares box geometry with the source layout; it does not recognize people or objects from image pixels. Small boxes inside larger boxes remain separate when their geometry identifies distinct objects. Boxes with at least 90% IoU are shown in red; the image corner shows the box count.

Dragging or resizing continues when the pointer crosses into the black margin, including horizontal drags along the bottom image edge. You can grab the part of a boundary handle that lies just outside the image. On release, the outside portion is clipped to the image boundary and the box is saved once. Losing window focus or canceling the pointer restores the unsaved drag.

### Body, hand, and eye box shortcuts

`X` deletes all boxes; `1` / `2` delete the leftmost / rightmost box. `Shift+X` deletes all and advances one frame.

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

### SAM3

In **1 Point SAM**, left-click adds a positive prompt and right-click adds a negative prompt. Wait for the green preview, then press `R` or **Enter / Add** to add it. **Shift+Enter / Subtract** removes that area instead.

After adding, `Ctrl+B` defaults to **Latest added mask area only (SAM3)** and preserves existing target masks. After subtraction, it applies only the removed area. Choose **Entire mask from the current frame** when you intend to copy the full mask. If SAM3 changed no pixels, the extension reports that instead of silently copying the whole mask.

The dashed SAM3 box is a processing region, separate from the mask. It is remembered per frame and clip in the current tab and does not shrink to a newly added mask. Reloading the page or switching sessions clears this temporary memory.

`F` toggles Done / In progress, `Space` plays / pauses, and `K` toggles mask visibility without changing data.

## Eye 15pt

Select an eye and press `Ctrl+B`. Choose **Selected eye only** or **All eyes in the current frame**, then choose whether to replace matching eyes and keep the others, or replace all target eyes.

Drag an empty area inside the dashed eye box to move all 15 points. Hold `Ctrl` while dragging to rotate; drag edge or corner handles to resize. Dragging a point edits only that point. `K` hides or shows the eye points without deleting them.

## Reopen Done frames

For labels outside the body/hand/eye box marking workflow:

1. Open a Done frame and press `V` to select it; press `V` again to deselect.
2. Repeat on any other Done frames in the same session and label, including other clips.
3. Press `Ctrl+B`, then **Set In progress** or `Enter`.

Existing masks and tags are preserved. **Clear selection** removes all selections. For body/hand/eye boxes, `V` marks bulk-edit targets instead; use `F` to reopen an individual Done frame.

## Updates

Install the optional local updater once: on Windows, run `Install-NOTA-Updater.cmd`; on macOS, right-click `Install-NOTA-Updater.command` and select **Open**. The macOS binary is included in the GitHub release ZIP.

If prompted, copy the extension ID from `chrome://extensions`. Close and reopen the popup, then use **Check for updates** → **Update now**. The updater verifies SHA256 before replacing files and reloading the extension. Reload the DMS tab afterward.

For a manual update, extract the latest release into the same installation folder, reload the extension in Chrome, then reload DMS.

Supported sites: `https://ntt.dev.nota.ai/` and `http://10.169.1.102:8765/`. Search/grouping changes only the interface; annotation edits and status actions save through the open page.
