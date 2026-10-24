# NOTA Labeling Organizer

A Chrome extension for faster annotation in **DMS Labeling**. Group frames by clip, edit labels with keyboard shortcuts, and repeat changes across multiple frames.

**Version 1.6.44 · English**

[Download the latest release](https://github.com/tanmainhat0502/dms_annotation_extension/releases/latest) · [Detailed usage guide](extension/README.md) · [Changelog](CHANGELOG.md)

## Install in Chrome

### 1. Download and extract

Download `NOTA_Labeling_Organizer_Extension_vX.Y.Z.zip` from [Releases](https://github.com/tanmainhat0502/dms_annotation_extension/releases/latest) and extract it into a permanent folder.

The screenshots below show version 1.6.17. Follow the same steps with the latest version.

### 2. Enable Developer mode

Open `chrome://extensions` in Chrome. Turn on **Developer mode** at the top right.

![Chrome Extensions page with the Developer mode switch at the top right](docs/images/01-developer-mode.png)

### 3. Click Load unpacked

The **Load unpacked** button appears at the top left when Developer mode is enabled.

![Load unpacked button at the top left of the Extensions page](docs/images/02-load-unpacked.png)

### 4. Select the extension folder

Choose the extracted folder that contains `manifest.json`, then click **Select Folder**. If you cloned or downloaded this repository, select its **extension** folder.

![Select the extracted NOTA Labeling Organizer folder and click Select Folder](docs/images/03-select-folder.png)

### 5. Confirm it is enabled

Find **NOTA Labeling Organizer** and check that its switch is on. Keep only one Organizer version enabled.

![NOTA Labeling Organizer installed with its enable switch on](docs/images/04-extension-enabled.png)

### 6. Pin it and open DMS

Click Chrome's **Extensions** puzzle icon, then the pin beside **NOTA Labeling Organizer**. Click the extension icon to open its help and update controls.

![Chrome Extensions menu showing NOTA Labeling Organizer and its pin button](docs/images/05-pin-extension.png)

Reload your DMS tab and open **Labeling**. Search for a part, expand a clip such as `#01`, and select a frame.

## What it does

| Feature | How it works |
| --- | --- |
| Organize frames | Search part names, group frames by clip, and see frame counts and the last edited checkpoint. The clip header stays visible while scrolling; collapsing it keeps that header in view instead of jumping to another part. Navigation follows the filtered list. |
| Filter by box count | For bbox labels, type exact counts such as `2,3,4` in **BBox** below part search to show only frames with that many boxes. **All** or an empty field shows every frame. Counts include saved edits and update after editing. A progress line below shows how many listed frames are counted, matched, or unknown. `A` / `D`, `Space`, and **auto_load_img** follow the filtered frames. |
| Filter error warnings (`⚠ Warn`) | Click **⚠ Warn** next to **All** to load all auto-label segments across the session, compute session-wide and clip-temporal bbox anomalies (`dup`, `tiny`, `size`, `ratio`, `pos`, `jump`, `count`, `drift`), and list only flagged frames in the sidebar with reason badges. Multi-box `body` frames are preserved by convention unless they exhibit flicker/dropout or geometric anomalies. All navigation (`A` / `D`, `Space`), copy/paste (`C`, `Ctrl+B`), **Done all**, and **auto_load_img** follow the listed warning frames. |
| Done all listed frames | **Done all** at the end of the BBox row marks every unfinished frame currently listed in the sidebar Done, after confirmation. Without filters that is every frame of the label; with part search or a BBox filter, only the frames still listed (collapsed clips included). Frames with unknown BBox counts are skipped. |
| Lock the timeline | Click the padlock to the right of the bottom timeline. When locked, clicking or dragging the timeline cannot jump to another frame. `A` / `D`, `Space`, and sidebar frame selection still work. Click again to unlock; your choice is remembered after reload. |
| Load images and boxes ahead | Click **auto_load_img** to download the images and raw bbox data for the current part and the next part that has frames in the sidebar (matching active status and BBox filters, including Done frames when **Show done** is enabled). Separate counters show loaded images and bbox segments; **Stop** pauses and keeps completed downloads. |
| Filter frame status | Tick **Show done**, **Show in progress**, and **Show not checked** below the progress bar. Combine any choices with the part search; navigation follows the filtered frames. Choices are remembered after reload. The checkboxes stay in view while you use them; farther down the list, the visible frame/clip/part stays in place. |
| Change clip status | Hover over or click **Done**, **Not checked**, or **In progress** on a clip, then choose one of the other two statuses. Only frames currently in the chosen source status change, including hidden frames in that clip. |
| Set the whole part Done | Tick **Done all** below the part's frame count in the left column. Untick to set all its frames to **In progress**. The control follows scrolling within the part; a dash means only some frames are Done. |
| Edit bounding boxes | Press `N` and click two opposite corners to create a box. Use `M` to draw a region that deletes boxes inside it. Handles keep tracking the pointer across image edges; boxes dragged outside are clipped on release. |
| Bulk action tabs | `Ctrl+B` has **Label actions** for copy/delete/adjust and **Change status** for Not checked, In progress, or Done. It remembers the last selected tab, including after reload. |
| Change frame status in bulk | In **Change status**, select previous/next frames with a count or `end`, or choose **Marked frames** from your `V` selection. The count includes the current frame. Includes Done and hidden frames, skips frames already at the destination status, and preserves annotations. |
| Copy annotations | Press `Ctrl+B` → **Label actions** to copy boxes, eye 15pt, face 7pt, or seatbelt edits to previous/next frames. Enter a frame count or `end` to reach the clip boundary. |
| Copy one box | Select a box, then use `Ctrl+B`. Matching target boxes are replaced and duplicates merged; other objects stay. If there is no match, a new box is added. Choosing all boxes replaces the entire target box list. |
| Adjust any bbox edge | For every bbox label, double-click the middle handle of the top, bottom, left, or right edge and drag it. `Ctrl+B` changes only that coordinate on each existing matching box; its other three coordinates and the number of boxes stay unchanged. |
| Edit seatbelt masks | Draw an add polygon with `N`, erase with `M`, or accept a green SAM3 preview with `R`. Bulk edits can use just the latest change or the entire mask. |
| Transform eye 15pt | Drag inside the dashed box to move the eye, `Ctrl` + drag to rotate, or drag its handles to resize all 15 points. |
| Review and undo | Mark frames with `V`, repeat bbox operations on marked frames, or reopen selected Done frames. `Z` undoes edits; one bbox undo can restore an entire batch. |

**Label actions:** the frame count excludes the current frame. Previous/next operations stay inside the current clip and skip **Done** frames. Saved **Not checked** frames become **In progress**. For every bbox label, marked targets may span clips within the same session and label.

**Change status:** affects the active label only. Previous/next counts include the current frame, then continue in the selected direction through the complete current-label clip, including frames hidden by filters. **Marked frames** can span clips and include the current frame if marked. `V` marks/unmarks any status for every label. Marks remain available after saving; use `V` or **Clear selection** to remove them. Changing session or label clears that selection.

**Box matching uses geometry**, not visual object recognition. Boxes that overlap by at least 90% IoU are highlighted red. The image also shows a bbox count.

**Done all** affects the current label across the entire part, including collapsed clips and frames hidden by status filters. It shows save progress and sends at most four status requests at once. While those statuses save, bbox editing such as `R`, `C`, and `Z` stays available immediately after clicking the checkbox, and **auto_load_img** continues with one background request. The currently open frame is saved last. If a save fails, completed saves remain and the checkbox reflects the actual result. Enable **Show done** to see completed parts and untick one to reopen it.

**Clip status example:** **Done → In progress** reopens only Done frames in that clip; existing Not checked and In progress frames stay as they are. The menu shows the source-frame count. No frames change until you choose a destination. **In progress** and **Not checked** work the same way. A source button is disabled when the clip has no frames in that status. Changes affect only the active label and preserve annotations.

**BBox filter:** counts and warnings come from auto-labels, which the filter reads per segment only while a count or **⚠ Warn** is active: up to two requests at a time, starting at the current frame (limited to parts matching the part search for exact counts, or across all segments in the session for **⚠ Warn**). Each segment is read once per session and label. Frames whose auto-labels cannot be read stay visible and are reported as unknown. While a BBox count or **⚠ Warn** filter is active, part **Done all**, clip status buttons, toolbar **Done all**, `Ctrl+B`, and `C` operate only on the filtered frames shown in the sidebar; when **BBox** is empty (**All**), they cover all frames.

## Automatic image loading

1. Open a frame in the part you are working on and click **auto_load_img** under the part search box.
2. The extension downloads that part, then the next part with frames shown in the sidebar, with up to **4 parallel image requests** (6 when the server uses HTTP/2 or HTTP/3) and **2 bbox-segment requests**. It downloads sequentially from the open frame to the end of the part, then fills earlier frames, for all frames matching the active sidebar filters (including Done frames when **Show done** is enabled). Separate counters show images stored / total matching images and bbox segments stored / total segments in those **2 parts**.
3. Continue editing or leave the tab open. Loading continues even while playback is paused. Once both parts are loaded, **Ready** means the loader is still watching for navigation and filter/status changes.
4. When you move into the second part, or when **every frame** of the first part is hidden from the sidebar (for example, saved as Done while **Show done** is unchecked), the first part's image cache is released and the next matching part loads automatically: **1+2 → 2+3 → 3+4**. Completing only the last clip does not advance if earlier frames remain visible in the sidebar.
5. **Stop** cancels background downloads but keeps completed images. Click **auto_load_img** again to fill the missing images for the part currently open and its next matching part. Failed downloads are retried on restart.

Compressed images and raw bbox responses are stored in the browser's local IndexedDB storage. They are decoded or parsed only when the viewer needs them, so loading two parts does not fill RAM with thousands of decoded images or bbox objects. `A` / `D` also prepare up to three nearby frames.

`Space` playback reuses an index of the frame list for navigation and lookahead. Moving to another frame updates only the previous/current sidebar rows, instead of rescanning every row and refreshing every clip. During playback the current highlight advances without pulling the sidebar viewport downward through a long **Other** part, including when annotations or the list update between frames. Changing the filter, label, session, or frame list rebuilds the index. This reduces interface work even when all images are already downloaded. Every navigation path, including fast `A` / `D`, sidebar clicks, timeline jumps, and `Space`, keeps the previous image visible until both the target image and its annotation data are ready. Rapid key presses discard stale results and reload face 7pt/eye 15pt state for the destination global frame, so cached images do not appear with missing boxes or stale landmark points.

In Labeling, `Space` presents selected frames at an even **10 frames/second at 1×**, adjusted by the viewer's speed control. Timestamp gaps or repeats do not create pauses or bursts. Each image gets a browser rendering opportunity; after a slow decode or render, playback resumes its normal cadence without rushing through overdue frames. The next image is requested before warming up to three successors, using the same cache as `D`. A slow device or an uncached image can still delay playback.

The loader allows up to four background image requests per tab over HTTP/1.1, leaving two of Chrome's six connections per host for the viewer and saves, or six over HTTP/2/HTTP/3. Bbox preloading uses at most two requests and drops to one while the viewer or status saves are active. There is no fixed images-per-second limit; actual speed depends on the server and connection. Multiple users or tabs add to the server's load.

The counter covers all frames in the two-part window that match the active status filters (**Show done**, **Show in progress**, **Show not checked**) and the **BBox** filter in the sidebar. Frames whose BBox counts are still loading wait (`awaiting BBox counts`). The window updates when you move to the next part or when status/BBox filters change; the final matching part runs alone. Changing the filter keeps already downloaded images. Stop first if you only want to inspect another part temporarily.

Switching sessions, labels, image size/quality, or leaving Labeling stops loading and clears this cache. Reloading the tab also starts fresh. Browser storage limits or network failures may stop/limit loading and are shown in the toolbar. Loading ahead reduces network waits; it cannot remove image decoding time or waits for other DMS data.

## Keyboard shortcuts

Use these on the labeling canvas, outside text fields. On macOS, `Cmd+B`, `Cmd+C`, and `Cmd+V` also work for the extension's bulk and clipboard actions.

### Navigation and common actions

| Shortcut | Action |
| --- | --- |
| `A` / `D` | Previous / next frame in the visible list. |
| `Shift+A` / `Shift+D` | Move backward / forward 10 frames. |
| `Space` | Play / pause; playback stops at the end of the visible list. |
| `F` | Toggle the current frame between Done and In progress. |
| `K` | Show / hide seatbelt masks or eye 15pt without changing data. |
| `Ctrl+B` | Open **Label actions** or **Change status**, remembering the last selected tab. |
| `V` | Mark/unmark a frame in any status for bulk status changes. Every bbox label also uses these marks for label actions. |
| `Enter` | Apply the action in an open bulk dialog. |
| `Esc` | Cancel drawing or a pending bulk edit; in the part search field, clear the filter. Already saved edits require Undo. |

### Bounding boxes

| Shortcut / gesture | Action |
| --- | --- |
| `N` | Click one corner, then the opposite corner to create a box. Clicks in the black margin snap to the image edge. No mouse hold needed. |
| `M` | Draw a red delete region; right-click or click its first point to close it. `Esc` exits. |
| `R` / `Delete` / `Backspace` | Delete the selected bounding box(es). `R` does nothing without a selection; hold-to-repeat is disabled for `R`. |
| `X` / `Shift+X` | Every bbox label: delete all boxes / delete all and move to the next frame. |
| `1` / `2` | Every bbox label: delete the leftmost / rightmost box. For a single-box label, either key deletes that box. |
| `C` / `Shift+C` | Every bbox label: replace current boxes with all boxes from the nearest earlier frame of the same label that has boxes, skipping empty frames / copy and move to the next frame. |
| `Ctrl+C` / `Ctrl+V` | Every bbox label: copy / paste the selected box, or all boxes when none is selected. |
| `Z` | Undo the latest bbox edit or its whole bulk batch for every bbox label. |
| Double-click an edge handle, then drag | All bbox labels: adjust the top, bottom, left, or right edge; use `Ctrl+B` to repeat its position across frames. |

### Seatbelt and eye 15pt

| Shortcut / gesture | Action |
| --- | --- |
| `N` / `M` (`Shift+N` also erases) | Seatbelt: draw an add / erase polygon. Close it with a right-click on the image or a click on its first point. |
| Left-click / right-click | 1 Point SAM: add a positive / negative prompt. |
| `R` or `Enter` / **Add** | Add the ready green SAM3 preview to the mask. |
| `Shift+Enter` / **Subtract** | Remove the green SAM3 preview area from the mask. |
| `Z` | Seatbelt: remove the last polygon point, or undo the latest mask edit on this frame. |
| Drag inside the dashed eye box | Move all 15 eye points. |
| `Ctrl` + drag inside the eye box | Rotate all 15 eye points. |
| Drag an eye edge / corner handle | Resize the eye group; dragging an individual point edits only that point. |

## Updates

For one-click updates, install **NOTA Updater** once from the extracted release folder:

- **Windows:** double-click `Install-NOTA-Updater.cmd`.
- **macOS:** right-click `Install-NOTA-Updater.command` → **Open**. Use the release ZIP, which includes the macOS binary.

If asked for an extension ID, copy it from `chrome://extensions`. Reopen the popup, click **Check for updates**, then **Update now**. The updater downloads the release, verifies SHA256, replaces files, and reloads the extension. No administrator access is needed.

To update manually, extract the new ZIP into the same installation folder, click the extension's reload icon in `chrome://extensions`, then reload DMS. Reload DMS after a one-click update as well.

## Supported pages and data

- `https://ntt.dev.nota.ai/*`
- `http://10.169.1.102:8765/*`

Search, grouping, and label visibility change only the interface. Annotation edits and status actions save through the open DMS page. The popup reads this repository's releases through `api.github.com`; the native updater downloads release packages.

## Development

| Path | Contents |
| --- | --- |
| `extension/` | Extension source (`core.js`, `styles.js`, `sidebar.js`, `bbox-warn.js`, `bbox-filter.js`, `bbox-tools.js`, `seatbelt-eye.js`, `bulk-dialogs.js`, `content.js`, `preload.js`, `popup.js`); load this folder in Chrome. |
| `docs/images/` | Installation screenshots used above. |
| `dist/` | Versioned release ZIPs. |
| `native-updater/` | Windows and macOS updater source. |
| `scripts/package.ps1` | Package the version from `extension/manifest.json`. |
| `tests/` | Sidebar scrolling, image preloading, bbox shortcuts/boundaries, and edge adjustment regression checks. |
| `.github/workflows/` | Build the macOS updater; publish releases on `vX.Y.Z` tags. |

To release: update the version in `extension/manifest.json` and `extension/core.js`, update the docs/changelog, run `native-updater/build.ps1` if the Windows updater changed, then run `scripts/package.ps1`. Commit and push, then push a matching `vX.Y.Z` tag. GitHub Actions publishes the ZIP with Windows and universal macOS updaters.
