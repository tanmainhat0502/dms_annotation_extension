(() => {
  "use strict";

  const NL = window.__notaOrganizerV1 = window.__notaOrganizerV1 || {};
  const {
    BBOX_LABELS, BBOX_OVERLAP_IOU_THRESHOLD, GENERIC_COPY_LABELS, OBJECT_BBOX_LABELS,
    QUICK_BBOX_LABELS, activeClipBaseContext, anyBulkDialogOpen, bboxIntersectionOverUnion,
    clampBboxEdgeCoord, clearEditorSelection, cloneGenericItems, currentGenericItems,
    currentLabelScope, drawCanvasPolygonOverlay, genericLabelName, getFrameGenericItems,
    navigateOrganizedFrames, notify, organizedNavigationIndex, pageLabelingReady,
    parseBoxBounds, quickBboxReady, refreshStatusControls, runQueue, saveFrameGenericItems,
    scheduleBboxFilterRefresh, sessionLabelFrames, singleSelectedEditorIndex, state
  } = NL;
  const mergeCopiedGenericBbox = (...args) => NL.mergeCopiedGenericBbox(...args);

  function bboxLabelingReady() {
    try {
      return typeof S !== "undefined" && BBOX_LABELS.has(S.labelSel) && pageLabelingReady(S.labelSel);
    } catch (_) {
      return false;
    }
  }

  function bboxEditingAvailable() {
    try {
      return bboxLabelingReady() && typeof ED !== "undefined" && Array.isArray(ED.items) &&
        (typeof edActive !== "function" || edActive());
    } catch (_) {
      return false;
    }
  }

  function drawBboxOverlapWarnings() {
    const canvas = document.getElementById("view");
    if (!canvas) return;
    if (!bboxLabelingReady() || typeof S === "undefined" || S.showAl === false ||
        typeof ED === "undefined" || !Array.isArray(ED.items) || typeof ctx === "undefined") {
      delete canvas.dataset.nlBboxCount;
      delete canvas.dataset.nlBboxOverlap;
      return;
    }

    const boxes = ED.items.map((item, index) => {
      const box = parseBoxBounds(item?.box);
      return box ? { index, box } : null;
    }).filter(Boolean);
    const overlapping = new Set();
    for (let left = 0; left < boxes.length; left += 1) {
      for (let right = left + 1; right < boxes.length; right += 1) {
        if (bboxIntersectionOverUnion(boxes[left].box, boxes[right].box) >= BBOX_OVERLAP_IOU_THRESHOLD) {
          overlapping.add(boxes[left].index);
          overlapping.add(boxes[right].index);
        }
      }
    }

    canvas.dataset.nlBboxCount = String(boxes.length);
    canvas.dataset.nlBboxOverlap = String(overlapping.size);
    const scale = canvas.width / (Number(S.sess?.src_w) || canvas.width || 1);
    const rect = canvas.getBoundingClientRect();
    const k = typeof pxK === "function" ? pxK() : canvas.width / (rect.width || canvas.width || 1);
    ctx.save();
    ctx.setLineDash([]);
    for (const entry of boxes) {
      if (!overlapping.has(entry.index)) continue;
      const [x1, y1, x2, y2] = entry.box.map((value) => value * scale);
      ctx.fillStyle = "rgba(255, 38, 64, .16)";
      ctx.fillRect(x1, y1, x2 - x1, y2 - y1);
      ctx.strokeStyle = "#ff263f";
      ctx.lineWidth = 3 * k;
      ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
    }

    const text = `BBox: ${boxes.length}`;
    ctx.font = `700 ${Math.round(14 * k)}px Consolas, monospace`;
    ctx.textBaseline = "top";
    const paddingX = 8 * k;
    const paddingY = 5 * k;
    const width = ctx.measureText(text).width + paddingX * 2;
    const height = 14 * k + paddingY * 2;
    const x = Math.max(4 * k, canvas.width - width - 8 * k);
    const y = 8 * k;
    ctx.fillStyle = overlapping.size ? "rgba(176, 0, 28, .92)" : "rgba(18, 24, 32, .86)";
    ctx.fillRect(x, y, width, height);
    ctx.strokeStyle = overlapping.size ? "#ff5268" : "#70c8ff";
    ctx.lineWidth = 1.5 * k;
    ctx.strokeRect(x, y, width, height);
    ctx.fillStyle = "#fff";
    ctx.fillText(text, x + paddingX, y + paddingY);
    ctx.restore();
  }

  function ensureBboxEditing() {
    if (state.bboxEditingInstalled || typeof edSave !== "function") return;
    const nativeSave = edSave;
    edSave = function (...args) {
      state.bboxEditRevision += 1;
      const result = nativeSave.apply(this, args);
      scheduleBboxFilterRefresh();
      if (result instanceof Promise) result.then(scheduleBboxFilterRefresh, scheduleBboxFilterRefresh);
      return result;
    };
    state.bboxEditingInstalled = true;
  }

  function ensureLabelVisibility() {
    if (state.labelVisibilityInstalled || typeof edDraw !== "function") return;
    const nativeDraw = edDraw;
    edDraw = function (...args) {
      // K toggles S.showAl on the original page. Eye landmarks are drawn by
      // edDraw separately from auto-labels, so honor K while In progress too.
      if (pageLabelingReady("eye_lmk") && typeof S !== "undefined" && S.showAl === false) {
        try { if (typeof edMagnify === "function") edMagnify(); } catch (_) {}
        return;
      }
      // Bbox M uses the same red deletion-region presentation as seatbelt M.
      // Hide the editor's native grey dashed polygon while drawing, then
      // restore its points because they are still used for input handling.
      const bboxDelete = state.bboxMode === "delete" && bboxLabelingReady() &&
        typeof ED !== "undefined" && Array.isArray(ED.poly);
      const polygonKey = bboxDelete ? ED.key : null;
      const polygon = bboxDelete ? ED.poly : null;
      if (bboxDelete) ED.poly = [];
      let result;
      try {
        result = nativeDraw.apply(this, args);
      } finally {
        if (bboxDelete && ED.key === polygonKey) ED.poly = polygon;
      }
      drawBboxDeletePolygon();
      drawBboxOverlapWarnings();
      drawBboxEdgePatch();
      return result;
    };
    state.labelVisibilityInstalled = true;
  }

  function currentGenericClipContext() {
    const label = typeof S !== "undefined" ? S.labelSel : "";
    if (!GENERIC_COPY_LABELS.has(label)) return null;
    const base = activeClipBaseContext(label);
    if (!base) return null;
    const { source } = base;
    const sourceItems = currentGenericItems(label);
    let selected = [];
    let selectedMode = "";
    let selectedRank = -1;
    try {
      if (QUICK_BBOX_LABELS.has(label) && typeof ED !== "undefined" && ED.key === rvKey(source) &&
          ED.lab === label && Array.isArray(ED.items)) {
        const index = singleSelectedEditorIndex();
        if (index >= 0 && index < sourceItems.length) {
          selected = [index];
          selectedMode = "clicked";
          selectedRank = bboxHorizontalOrder(sourceItems).findIndex((entry) => entry.index === index);
        }
      }
      const created = state.lastCreatedBox;
      if (!selected.length && label !== "face_lmk" && created && created.generation === S.gen && created.label === label &&
          created.key === rvKey(source) && typeof ED !== "undefined" && ED.key === created.key && ED.lab === label) {
        const index = ED.items.indexOf(created.item);
        if (index >= 0 && index < sourceItems.length) {
          selected = [index];
          selectedMode = "created";
        }
      }
    } catch (_) {}
    return {
      ...base,
      label,
      labelName: genericLabelName(label),
      sourceItems,
      selected,
      selectedMode,
      selectedRank,
      operation: quickOperationMatches() ? { ...state.quickLastOperation } : null
    };
  }

  function quickOperationMatches(operation = state.quickLastOperation) {
    return Boolean(operation && (operation.type === "edge" ? bboxLabelingReady() : quickBboxReady()) &&
      operation.generation === S.gen && operation.session === S.sess &&
      operation.label === S.labelSel && Number(operation.source ?? operation.g) === Number(S.shownG));
  }

  function rememberBboxUndo(frames, remote = false) {
    if (!bboxLabelingReady() || !frames?.length) return;
    state.bboxUndo.push({
      ...currentLabelScope(),
      remote,
      frames: frames.map((frame) => ({ g: frame.g, items: cloneGenericItems(frame.items) }))
    });
    if (state.bboxUndo.length > 30) state.bboxUndo.splice(0, state.bboxUndo.length - 30);
  }

  function replaceCurrentBboxItems(items, operation, message) {
    if (!quickBboxReady() || !bboxEditingAvailable()) return false;
    const before = cloneGenericItems(ED.items);
    rememberBboxUndo([{ g: Number(S.shownG), items: before }]);
    ED.items.splice(0, ED.items.length, ...cloneGenericItems(items));
    clearEditorSelection();
    state.lastCreatedBox = null;
    state.bboxEdgePatch = null;
    if (operation) state.quickLastOperation = {
      ...operation,
      ...currentLabelScope(),
      source: Number(S.shownG)
    };
    try { if (typeof lsTouch === "function") lsTouch(); } catch (_) {}
    if (typeof edSave === "function") edSave();
    if (typeof edRepaint === "function") edRepaint();
    if (message) notify(message);
    return true;
  }

  function bboxHorizontalOrder(items = ED.items) {
    return items.map((item, index) => ({
      index,
      x: Array.isArray(item?.box) ? (Number(item.box[0]) + Number(item.box[2])) / 2 : Infinity
    })).sort((left, right) => left.x - right.x || left.index - right.index);
  }

  function deleteQuickBbox(selector, advance = false) {
    if (!quickBboxReady() || !bboxEditingAvailable() || !ED.items.length) {
      notify("This frame has no boxes to delete");
      return false;
    }
    const items = cloneGenericItems(ED.items);
    const order = bboxHorizontalOrder(items);
    let indexes = [];
    let operation = { type: "delete", selector };
    if (selector === "all") indexes = items.map((_, index) => index);
    else if (selector === "left") indexes = order.length ? [order[0].index] : [];
    else if (selector === "right") indexes = order.length ? [order[order.length - 1].index] : [];
    else {
      let index = Number.isInteger(ED.hover?.n) ? ED.hover.n : Number.isInteger(ED.sel) && ED.sel >= 0 ? ED.sel : -1;
      if (items.length === 1) index = 0;
      if (index < 0 || index >= items.length) {
        notify("Multiple boxes: hover over the box to delete, then press X");
        return false;
      }
      indexes = [index];
      operation = { type: "delete", selector: "rank", rank: order.findIndex((entry) => entry.index === index) };
    }
    const removed = new Set(indexes);
    const next = items.filter((_, index) => !removed.has(index));
    const label = selector === "all" ? "all boxes" : selector === "left" ? "the leftmost box" : selector === "right" ? "the rightmost box" : "the selected box";
    const changed = replaceCurrentBboxItems(next, operation, `Deleted ${label} · Ctrl+B to repeat across frames`);
    if (changed && advance) setTimeout(() => navigateOrganizedFrames(1), 40);
    return changed;
  }

  function previousQuickBboxFrames(target) {
    if (state.bboxActive) {
      const navigation = organizedNavigationIndex();
      if (!navigation) return [];
      const { visible, all, ranks } = navigation;
      let end = visible.positions.get(target);
      if (end === undefined) {
        const allIndex = all.positions.get(target);
        end = allIndex !== undefined && ranks ? ranks[allIndex] : -1;
      }
      const rows = end >= 0 ? visible.rows.slice(0, end) : visible.rows;
      return rows.map((li) => Number(li.dataset.g))
        .filter((g) => Number.isInteger(g) && g >= 0 && (end >= 0 || g < target))
        .reverse();
    }
    // Include Done frames hidden by only-todo, and frames never opened in this
    // tab. Read only frames authorized for the current session and label.
    return sessionLabelFrames().filter((g) => g < target).reverse();
  }

  function quickBboxCopyAvailable() {
    return quickBboxReady() && bboxEditingAvailable() && !state.operationBusy &&
      !state.bboxMode && !ED.drag && !ED.marq && !ED.poly?.length && !anyBulkDialogOpen() &&
      !(typeof RV_OPEN !== "undefined" && RV_OPEN) && ED.lab === S.labelSel &&
      ED.key === rvKey(S.shownG) && Number(S.g) === Number(S.shownG);
  }

  async function copyPreviousQuickBbox(advance = false) {
    if (!quickBboxCopyAvailable()) return false;
    const request = {
      session: S.sess, generation: S.gen, label: S.labelSel,
      g: Number(S.shownG), key: ED.key, items: ED.items,
      snapshot: JSON.stringify(cloneGenericItems(ED.items))
    };
    const stillHere = () => quickBboxCopyAvailable() && S.sess === request.session &&
      S.gen === request.generation && S.labelSel === request.label && Number(S.shownG) === request.g &&
      ED.key === request.key && ED.items === request.items &&
      JSON.stringify(cloneGenericItems(ED.items)) === request.snapshot;
    const previousRequest = state.bboxCopyRequest;
    if (previousRequest?.session === request.session && previousRequest.generation === request.generation &&
        previousRequest.label === request.label && previousRequest.g === request.g) return false;
    state.bboxCopyRequest = request;
    try {
      if (typeof pause === "function") pause();
      const frames = previousQuickBboxFrames(request.g);
      for (let index = 0; index < frames.length; index++) {
        if (state.bboxCopyRequest !== request || !stillHere()) return false;
        const g = frames[index];
        const loaded = await getFrameGenericItems(g, request.label, request.generation);
        if (state.bboxCopyRequest !== request || !stillHere()) return false;
        // A saved edit (including an explicit empty array) always wins over
        // auto-label data, including edits arriving while a segment was loading.
        const saved = S.ledits?.[rvKey(g)]?.[request.label];
        const [segmentIndex] = loc(g);
        if (!Array.isArray(saved) && S.sess.segments?.[segmentIndex]?.al && !S.al?.get(segmentIndex)) {
          throw new Error("Source annotations are unavailable. Reload DMS and try again.");
        }
        const items = cloneGenericItems(Array.isArray(saved) ? saved : loaded).filter((item) =>
          Array.isArray(item.box) && item.box.every(Number.isFinite) &&
          item.box[2] > item.box[0] && item.box[3] > item.box[1]);
        if (items.length) {
          const changed = replaceCurrentBboxItems(items, { type: "copy" },
            `Copied ${items.length} ${genericLabelName(request.label)} boxes from frame ${g + 1} · Z to undo`);
          request.snapshot = JSON.stringify(cloneGenericItems(ED.items));
          if (changed && advance) setTimeout(() => {
            if (stillHere()) navigateOrganizedFrames(1);
          }, 40);
          return changed;
        }
        // A long run of empty frames must not monopolize the UI microtask queue.
        if (index % 64 === 63) await new Promise((resolve) => setTimeout(resolve, 0));
      }
      if (state.bboxCopyRequest === request && stillHere()) {
        notify(`No earlier ${genericLabelName(request.label)} frame with boxes to copy from`);
      }
      return false;
    } catch (error) {
      if (state.bboxCopyRequest === request && stillHere()) notify(`Could not copy boxes: ${error.message}`);
      return false;
    } finally {
      if (state.bboxCopyRequest === request) state.bboxCopyRequest = null;
    }
  }

  function copyQuickBboxToClipboard() {
    if (!quickBboxReady() || !Array.isArray(ED?.items)) return;
    const selectedIndex = singleSelectedEditorIndex();
    const selected = selectedIndex >= 0 && selectedIndex < ED.items.length;
    state.bboxClipboard = {
      ...currentLabelScope(),
      items: cloneGenericItems(selected ? [ED.items[selectedIndex]] : ED.items),
      sourceItems: cloneGenericItems(ED.items),
      mode: selected ? "selected" : "all",
      rank: selected ? bboxHorizontalOrder(ED.items).findIndex((entry) => entry.index === selectedIndex) : -1
    };
    notify(selected
      ? `Copied the selected ${S.labelSel} box · switch frames and press Ctrl+V`
      : `Copied ${ED.items.length} ${S.labelSel} boxes · switch frames and press Ctrl+V`);
  }

  function pasteQuickBboxFromClipboard() {
    const clipboard = state.bboxClipboard;
    if (!quickBboxReady() || !bboxEditingAvailable()) return;
    if (!clipboard || clipboard.session !== S.sess || clipboard.label !== S.labelSel) {
      notify(`The clipboard has no ${S.labelSel} boxes`);
      return;
    }
    let nextItems = clipboard.items;
    if (clipboard.mode === "selected") {
      const copied = cloneGenericItems(clipboard.items)[0];
      nextItems = mergeCopiedGenericBbox(ED.items, copied, clipboard.sourceItems);
    }
    replaceCurrentBboxItems(nextItems, { type: "copy" }, clipboard.mode === "selected"
      ? `Pasted the ${S.labelSel} box · replaced a matching box or added a new one`
      : `Pasted ${clipboard.items.length} ${S.labelSel} boxes`);
  }

  async function undoQuickBbox() {
    if (state.operationBusy || !bboxLabelingReady()) return;
    let index = state.bboxUndo.length - 1;
    while (index >= 0) {
      const entry = state.bboxUndo[index];
      if (entry.generation === S.gen && entry.session === S.sess && entry.label === S.labelSel) break;
      index -= 1;
    }
    if (index < 0) {
      notify(`No more ${S.labelSel} operations to undo`);
      return;
    }
    const [entry] = state.bboxUndo.splice(index, 1);
    state.operationBusy = true;
    try {
      const currentG = Number(S.shownG);
      const remoteFrames = [];
      for (const frame of entry.frames) {
        if (frame.g === currentG && bboxEditingAvailable()) {
          ED.items.splice(0, ED.items.length, ...cloneGenericItems(frame.items));
          if (typeof edClearSel === "function") edClearSel();
          if (typeof edSave === "function") edSave();
        } else remoteFrames.push(frame);
      }
      const result = await runQueue(remoteFrames, (frame) =>
        saveFrameGenericItems(frame.g, entry.label, frame.items, entry.generation), null, 4);
      if (result.error) throw result.error;
      state.quickLastOperation = null;
      state.bboxEdgePatch = null;
      if (typeof fsRender === "function") fsRender();
      if (typeof edRepaint === "function") edRepaint();
      notify(`Undid ${entry.frames.length > 1 ? `the entire batch of ${entry.frames.length} frames` : "the latest operation"}`);
    } catch (error) {
      state.bboxUndo.splice(index, 0, entry);
      notify(`Could not undo: ${error.message}`);
    } finally {
      state.operationBusy = false;
      refreshStatusControls();
    }
  }

  function bboxEdgeGeometry(event) {
    if (!bboxEditingAvailable() || !ED.items.length || ED.lab !== S.labelSel ||
        ED.key !== rvKey(S.shownG)) return null;
    const point = bboxEventPoint(event);
    const tolerance = 13 * point.sourceWidth / point.rect.width;
    let best = null;
    ED.items.forEach((item, itemIndex) => {
      if (!Array.isArray(item?.box) || item.box.length !== 4 || !item.box.every(Number.isFinite)) return;
      const [x1, y1, x2, y2] = item.box.map(Number);
      const handles = [
        { edge: "top", coord: 1, point: [(x1 + x2) / 2, y1] },
        { edge: "right", coord: 2, point: [x2, (y1 + y2) / 2] },
        { edge: "bottom", coord: 3, point: [(x1 + x2) / 2, y2] },
        { edge: "left", coord: 0, point: [x1, (y1 + y2) / 2] }
      ];
      for (const handle of handles) {
        const distance = Math.hypot(point.rawSourcePoint[0] - handle.point[0], point.rawSourcePoint[1] - handle.point[1]);
        if (distance <= tolerance && (!best || distance < best.distance)) {
          best = { ...handle, itemIndex, distance, box: item.box.slice() };
        }
      }
    });
    return best;
  }

  function onBboxEdgeDoubleClick(event) {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey ||
        state.bboxMode || state.operationBusy || anyBulkDialogOpen() ||
        (typeof RV_OPEN !== "undefined" && RV_OPEN) ||
        (event.target !== document.getElementById("view") && event.target !== document.getElementById("stage"))) return;
    const geometry = bboxEdgeGeometry(event);
    if (!geometry) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    state.bboxEdgePatch = {
      generation: S.gen,
      session: S.sess,
      label: S.labelSel,
      g: Number(S.shownG),
      key: ED.key,
      itemIndex: geometry.itemIndex,
      edge: geometry.edge,
      coord: geometry.coord,
      originalBox: geometry.box.slice(),
      delta: 0,
      ready: false
    };
    ED.sel = geometry.itemIndex;
    ED.selSet?.clear();
    if (typeof edRepaint === "function") edRepaint();
    notify(`Selected the ${S.labelSel} ${geometry.edge} edge · drag it, then press Ctrl+B`);
  }

  function bboxEdgePatchMatches(patch = state.bboxEdgePatch) {
    return Boolean(patch && bboxLabelingReady() && typeof ED !== "undefined" &&
      patch.generation === S.gen && patch.session === S.sess && patch.label === S.labelSel &&
      ED.lab === patch.label && patch.key === ED.key && ED.key === rvKey(S.shownG) &&
      patch.g === Number(S.shownG) && Array.isArray(ED.items?.[patch.itemIndex]?.box));
  }

  function finalizeBboxEdgePatch() {
    const patch = state.bboxEdgePatch;
    if (!bboxEdgePatchMatches(patch) || !bboxEditingAvailable() || patch.ready ||
        !ED.drag?.moved || ED.drag.n !== patch.itemIndex) return;
    const box = ED.items[patch.itemIndex].box.slice();
    const beforeItems = cloneGenericItems(ED.items);
    beforeItems[patch.itemIndex].box = patch.originalBox.slice();
    const next = patch.originalBox.slice();
    next[patch.coord] = box[patch.coord];
    const width = Number(S.sess?.src_w) || 0;
    const height = Number(S.sess?.src_h) || 0;
    clampBboxEdgeCoord(next, patch.coord, width, height);
    patch.delta = next[patch.coord] - patch.originalBox[patch.coord];
    if (Math.abs(patch.delta) < 0.05) return;
    ED.items[patch.itemIndex].box = next;
    patch.ready = true;
    patch.currentBox = next.slice();
    rememberBboxUndo([{ g: patch.g, items: beforeItems }]);
    state.quickLastOperation = {
      ...patch,
      type: "edge",
      source: patch.g,
      value: next[patch.coord]
    };
    notify(`Set the ${patch.edge} edge to ${next[patch.coord].toFixed(1)} px · Ctrl+B to apply this position`);
  }

  function drawBboxEdgePatch() {
    const patch = state.bboxEdgePatch;
    if (!bboxEdgePatchMatches(patch) || typeof ctx === "undefined") return;
    const canvas = document.getElementById("view");
    const scale = canvas.width / S.sess.src_w;
    const unit = typeof pxK === "function" ? pxK() : canvas.width / canvas.getBoundingClientRect().width;
    const original = patch.originalBox.map((value) => value * scale);
    const current = ED.items[patch.itemIndex].box.map((value) => value * scale);
    const line = (box, edge) => edge === "top" ? [box[0], box[1], box[2], box[1]] :
      edge === "right" ? [box[2], box[1], box[2], box[3]] :
      edge === "bottom" ? [box[0], box[3], box[2], box[3]] : [box[0], box[1], box[0], box[3]];
    const oldLine = line(original, patch.edge);
    const newLine = line(current, patch.edge);
    ctx.save();
    ctx.setLineDash([]);
    ctx.lineWidth = 2 * unit;
    ctx.strokeStyle = "#ffffff";
    ctx.beginPath(); ctx.moveTo(oldLine[0], oldLine[1]); ctx.lineTo(oldLine[2], oldLine[3]); ctx.stroke();
    ctx.strokeStyle = "#42f58d";
    ctx.beginPath(); ctx.moveTo(newLine[0], newLine[1]); ctx.lineTo(newLine[2], newLine[3]); ctx.stroke();
    if (patch.ready || Math.abs(newLine[0] - oldLine[0]) + Math.abs(newLine[1] - oldLine[1]) > .1) {
      ctx.setLineDash([4 * unit, 3 * unit]);
      ctx.beginPath();
      ctx.moveTo(oldLine[0], oldLine[1]); ctx.lineTo(newLine[0], newLine[1]);
      ctx.moveTo(oldLine[2], oldLine[3]); ctx.lineTo(newLine[2], newLine[3]);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    const mx = (newLine[0] + newLine[2]) / 2;
    const my = (newLine[1] + newLine[3]) / 2;
    ctx.fillStyle = "#42f58d";
    ctx.fillRect(mx - 4 * unit, my - 4 * unit, 8 * unit, 8 * unit);
    ctx.restore();
  }

  function trackCreatedBoxOnMouseUp() {
    try {
      const label = typeof S !== "undefined" ? S.labelSel : "";
      if (!GENERIC_COPY_LABELS.has(label) || label === "face_lmk" || typeof ED === "undefined" ||
          !ED.drag?.create || !Array.isArray(ED.items)) return;
      const item = ED.items[ED.drag.n];
      if (!Array.isArray(item?.box) || item.box.length !== 4) return;
      state.lastCreatedBox = {
        generation: S.gen,
        key: ED.key,
        label,
        item
      };
      if (state.bboxMode === "create") {
        state.bboxMode = null;
        setTimeout(() => {
          if (typeof ED !== "undefined" && ED.items?.includes(item)) {
            notify("Created a box · Ctrl+B to copy it");
          } else if (state.lastCreatedBox?.item === item) {
            state.lastCreatedBox = null;
          }
        }, 0);
      }
    } catch (_) {}
  }

  function bboxEventPoint(event) {
    const canvas = document.getElementById("view");
    const rect = canvas.getBoundingClientRect();
    const sourceWidth = Number(S.sess?.src_w) || canvas.width;
    const sourceHeight = Number(S.sess?.src_h) || canvas.height;
    const canvasPoint = [
      (event.clientX - rect.left) * canvas.width / rect.width,
      (event.clientY - rect.top) * canvas.height / rect.height
    ];
    const clampedCanvasPoint = [
      Math.max(0, Math.min(canvas.width, canvasPoint[0])),
      Math.max(0, Math.min(canvas.height, canvasPoint[1]))
    ];
    const rawSourcePoint = [
      (event.clientX - rect.left) * sourceWidth / rect.width,
      (event.clientY - rect.top) * sourceHeight / rect.height
    ];
    const sourcePoint = [
      Math.max(0, Math.min(sourceWidth, rawSourcePoint[0])),
      Math.max(0, Math.min(sourceHeight, rawSourcePoint[1]))
    ];
    return { canvas, rect, canvasPoint, clampedCanvasPoint, rawSourcePoint, sourcePoint, sourceWidth, sourceHeight };
  }

  function discardBboxCreateDraft() {
    const draft = state.bboxCreateDraft;
    state.bboxCreateDraft = null;
    if (!draft || typeof ED === "undefined" || !Array.isArray(ED.items)) return;
    const index = ED.items.indexOf(draft.item);
    if (index >= 0) ED.items.splice(index, 1);
    if (ED.drag?.create && ED.drag.n === index) ED.drag = null;
    if (ED.sel === index) ED.sel = -1;
    ED.selSet?.delete(index);
  }

  function cancelBboxMode() {
    discardBboxCreateDraft();
    state.bboxMode = null;
    state.bboxDeleteRegion = null;
    try {
      if (typeof ED !== "undefined") {
        ED.poly = [];
        ED.marq = null;
      }
      const canvas = document.getElementById("view");
      if (canvas) canvas.style.cursor = "";
      if (typeof edRepaint === "function") edRepaint();
    } catch (_) {}
  }

  function setBboxMode(mode) {
    if (!bboxLabelingReady()) return;
    if (state.bboxMode === mode) {
      cancelBboxMode();
      return;
    }
    if (state.bboxMode) cancelBboxMode();
    state.bboxMode = mode;
    state.bboxDeleteRegion = null;
    if (typeof ED !== "undefined") {
      ED.poly = [];
      ED.marq = null;
      clearEditorSelection();
    }
    const canvas = document.getElementById("view");
    if (canvas) canvas.style.cursor = "crosshair";
    if (typeof edRepaint === "function") edRepaint();
    notify(mode === "create"
      ? "Create a box: click one corner, move the pointer, then click the opposite corner"
      : "Delete boxes: draw a polygon, then click its first point or right-click · Esc to exit");
  }

  function updateBboxCreateDraft(event) {
    const draft = state.bboxCreateDraft;
    if (!draft || !bboxEditingAvailable() || draft.generation !== S.gen || draft.key !== ED.key ||
        draft.label !== S.labelSel || !ED.items?.includes(draft.item)) return false;
    const point = bboxEventPoint(event);
    const [x0, y0] = draft.startSource;
    const [x1, y1] = point.sourcePoint;
    draft.currentSource = [x1, y1];
    draft.currentCanvas = point.clampedCanvasPoint.slice();
    draft.item.box = [Math.min(x0, x1), Math.min(y0, y1), Math.max(x0, x1), Math.max(y0, y1)];
    ED.mouse = point.clampedCanvasPoint.slice();
    if (typeof edRepaint === "function") edRepaint();
    return true;
  }

  function finishBboxCreateDraft(event) {
    const draft = state.bboxCreateDraft;
    if (!draft || !updateBboxCreateDraft(event)) return false;
    const widthOnCanvas = Math.abs(draft.currentCanvas[0] - draft.startCanvas[0]);
    const heightOnCanvas = Math.abs(draft.currentCanvas[1] - draft.startCanvas[1]);
    if (widthOnCanvas < 4 || heightOnCanvas < 4) {
      notify("Box too small · move the pointer farther away and click again");
      return true;
    }
    // Both corners are already clipped. Validate their visible size above,
    // so two clicks outside the same edge cannot save a zero-area box.
    if (quickBboxReady()) {
      rememberBboxUndo([{
        g: Number(S.shownG),
        items: cloneGenericItems(ED.items.filter((item) => item !== draft.item))
      }]);
    }
    state.lastCreatedBox = {
      generation: S.gen,
      key: ED.key,
      label: S.labelSel,
      item: draft.item
    };
    state.bboxCreateDraft = null;
    state.bboxMode = null;
    ED.drag = null;
    ED.marq = null;
    const canvas = document.getElementById("view");
    if (canvas) canvas.style.cursor = "";
    try { if (typeof lsTouch === "function") lsTouch(); } catch (_) {}
    if (typeof edSave === "function") edSave();
    if (typeof edRepaint === "function") edRepaint();
    notify("Created a box · Ctrl+B to copy it");
    return true;
  }

  function bboxDeleteTarget(event) {
    const canvas = document.getElementById("view");
    const stage = document.getElementById("stage");
    return event.target === canvas || (!!stage && event.target === stage);
  }

  function commitBboxDeletePolygon() {
    if (!bboxEditingAvailable() || state.bboxMode !== "delete") return;
    if (!Array.isArray(ED.poly) || ED.poly.length < 3) {
      notify("The delete region needs at least 3 points");
      return;
    }
    const points = ED.poly.map((point) => point.slice());
    state.bboxDeleteRegion = { generation: S.gen, key: ED.key, label: S.labelSel, points };
    const removed = [];
    const beforeItems = cloneGenericItems(ED.items);
    ED.items.forEach((item, index) => {
      try {
        if (Array.isArray(item?.box) && typeof boxInPoly === "function" && boxInPoly(item.box, points)) removed.push(index);
      } catch (_) {}
    });
    for (const index of removed.reverse()) ED.items.splice(index, 1);
    if (quickBboxReady()) {
      // The polygon itself is the bulk operation. Keep it even when it does
      // not hit a box on the source frame, because matching boxes can still
      // exist inside the same region on the destination frames.
      if (removed.length) {
        rememberBboxUndo([{ g: Number(S.shownG), items: beforeItems }]);
      }
      state.quickLastOperation = {
        type: "delete",
        selector: "region",
        region: points.map((point) => point.slice()),
        ...currentLabelScope(),
        source: Number(S.shownG)
      };
    }
    ED.poly = [];
    clearEditorSelection();
    if (removed.length && typeof edSave === "function") edSave();
    if (typeof lsTouch === "function") lsTouch();
    if (typeof edRepaint === "function") edRepaint();
    notify(removed.length
      ? `Deleted ${removed.length} boxes · draw another region or press Esc`
      : "No boxes in the delete region · keep drawing or press Esc");
  }

  function bboxPointerDragAvailable() {
    return !state.bboxMode && !state.operationBusy && bboxEditingAvailable() && !ED.poly?.length &&
      !(typeof RV_OPEN !== "undefined" && RV_OPEN) && ED.lab === S.labelSel &&
      ED.key === rvKey(S.shownG) && Number(S.g) === Number(S.shownG);
  }

  function onBboxPointerDown(event) {
    if (event.button !== 0 || event.shiftKey || !bboxPointerDragAvailable()) return;
    const canvas = document.getElementById("view");
    const stage = document.getElementById("stage");
    if ((event.target !== canvas && event.target !== stage) || typeof hitTest !== "function") return;
    const hit = hitTest(bboxEventPoint(event).canvasPoint);
    if (!hit || (event.target !== canvas && hit.corner < 0)) return;
    // Native bbox movement listens only on the canvas. Capture the pointer so
    // that crossing an image edge keeps delivering the same native gesture,
    // with its original starting point, through the final mouseup.
    try {
      canvas.setPointerCapture(event.pointerId);
      state.bboxPointerCapture = {
        id: event.pointerId, canvas, session: S.sess, generation: S.gen,
        label: S.labelSel, key: ED.key, items: ED.items, index: hit.n
      };
    } catch (_) {}
  }

  function releaseBboxPointer(event) {
    const captured = state.bboxPointerCapture;
    if (!captured || (event.type !== "blur" && event.pointerId !== captured.id)) return;
    state.bboxPointerCapture = null;
    // Normal mouseup has already saved and cleared ED.drag. If the browser
    // cancels capture or loses focus instead, discard only this unsaved drag.
    if (S.sess === captured.session && S.gen === captured.generation && S.labelSel === captured.label &&
        ED.key === captured.key && ED.items === captured.items && ED.drag?.n === captured.index) {
      const item = ED.items[captured.index];
      if (item && Array.isArray(ED.drag.box0)) item.box = ED.drag.box0.slice();
      ED.drag = null;
      if (bboxEdgePatchMatches() && !state.bboxEdgePatch.ready) state.bboxEdgePatch = null;
      if (typeof edRepaint === "function") edRepaint();
    }
    try {
      if (captured.canvas.hasPointerCapture(captured.id)) captured.canvas.releasePointerCapture(captured.id);
    } catch (_) {}
  }

  function tryStartBboxEdgePatchDrag(event, edgePatch) {
    if (edgePatch?.ready || !bboxEdgePatchMatches(edgePatch) || event.shiftKey) return false;
    const geometry = bboxEdgeGeometry(event);
    if (!geometry || geometry.itemIndex !== edgePatch.itemIndex || geometry.coord !== edgePatch.coord) return false;
    // Small boxes (nose in particular) can have a midpoint handle inside
    // the native corner tolerance. Start the exact selected edge here so
    // sideways pointer drift cannot resize a second edge.
    event.preventDefault();
    event.stopImmediatePropagation();
    try { if (typeof pause === "function") pause(); } catch (_) {}
    try { if (typeof lsTouch === "function") lsTouch(); } catch (_) {}
    const nativeCorner = { 0: 6, 1: 4, 2: 7, 3: 5 }[edgePatch.coord];
    ED.sel = edgePatch.itemIndex;
    ED.selSet?.clear();
    ED.drag = {
      n: edgePatch.itemIndex,
      corner: nativeCorner,
      p0: bboxEventPoint(event).canvasPoint,
      box0: ED.items[edgePatch.itemIndex].box.slice(),
      moved: false,
      edgeAdjust: true
    };
    if (typeof edRepaint === "function") edRepaint();
    return true;
  }

  function tryForwardStageCornerMouseDown(event, stage, canvas) {
    if (event.target !== stage || event.shiftKey || !bboxPointerDragAvailable() || typeof hitTest !== "function") {
      return false;
    }
    const hit = hitTest(bboxEventPoint(event).canvasPoint);
    // A handle centered on the boundary has half of its hit area in the
    // black margin. Let that half start the same native drag as the image.
    if (!hit || hit.corner < 0) return false;
    event.preventDefault();
    event.stopImmediatePropagation();
    canvas.dispatchEvent(new MouseEvent("mousedown", {
      bubbles: true, cancelable: true, view: window,
      clientX: event.clientX, clientY: event.clientY,
      button: event.button, buttons: event.buttons,
      ctrlKey: event.ctrlKey, altKey: event.altKey, metaKey: event.metaKey
    }));
    return true;
  }

  function handleBboxDeletePolygonMouseDown(event, canvas) {
    if (!bboxDeleteTarget(event)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const point = bboxEventPoint(event).sourcePoint;
    if (ED.poly.length >= 3) {
      const first = ED.poly[0];
      const tolerance = 12 * S.sess.src_w / canvas.getBoundingClientRect().width;
      if (Math.hypot(point[0] - first[0], point[1] - first[1]) <= tolerance) {
        commitBboxDeletePolygon();
        return;
      }
    }
    if (!ED.poly.length) state.bboxDeleteRegion = null;
    ED.poly.push(point);
    if (typeof edRepaint === "function") edRepaint();
  }

  function handleBboxCreateCornerMouseDown(event) {
    event.preventDefault();
    event.stopImmediatePropagation();
    if (state.bboxCreateDraft) {
      finishBboxCreateDraft(event);
      return;
    }
    try { if (typeof pause === "function") pause(); } catch (_) {}
    const point = bboxEventPoint(event);
    const item = { box: [point.sourcePoint[0], point.sourcePoint[1], point.sourcePoint[0], point.sourcePoint[1]] };
    if (OBJECT_BBOX_LABELS.has(S.labelSel)) item.cls = S.labelSel;
    ED.items.push(item);
    clearEditorSelection();
    ED.sel = ED.items.length - 1;
    ED.drag = null;
    ED.marq = null;
    state.bboxCreateDraft = {
      generation: S.gen,
      key: ED.key,
      label: S.labelSel,
      item,
      startSource: point.sourcePoint.slice(),
      currentSource: point.sourcePoint.slice(),
      startCanvas: point.clampedCanvasPoint.slice(),
      currentCanvas: point.clampedCanvasPoint.slice()
    };
    if (typeof edRepaint === "function") edRepaint();
    notify("First corner placed · move the pointer and click to finish the box");
  }

  function onBboxMouseDown(event) {
    if (!bboxLabelingReady() || event.button !== 0) return;
    const canvas = document.getElementById("view");
    const stage = document.getElementById("stage");
    if (state.bboxEdgePatch?.ready && (event.target === canvas || event.target === stage)) {
      state.bboxEdgePatch = null;
      if (state.quickLastOperation?.type === "edge") state.quickLastOperation = null;
    }
    if (state.bboxMode && !bboxEditingAvailable()) {
      event.preventDefault();
      event.stopImmediatePropagation();
      notify("Set the frame to In progress before editing boxes");
      return;
    }
    if (!bboxEditingAvailable()) return;
    if (tryStartBboxEdgePatchDrag(event, state.bboxEdgePatch)) return;
    if (tryForwardStageCornerMouseDown(event, stage, canvas)) return;
    if (state.bboxMode === "delete") {
      handleBboxDeletePolygonMouseDown(event, canvas);
      return;
    }
    // The black margin belongs to the drawing surface too. Keep clicks on
    // actual viewer controls and the sidebar out of the create action.
    const onCanvas = event.target === canvas;
    if (!onCanvas && !(state.bboxMode === "create" && event.target === stage)) return;
    if (state.bboxMode === "create") {
      handleBboxCreateCornerMouseDown(event);
      return;
    }
    if (event.shiftKey) {
      event.preventDefault();
      event.stopImmediatePropagation();
      notify("Press N, click one corner, then the opposite corner to create a box");
    }
  }

  function settleBboxInsideImage() {
    if (!bboxEditingAvailable() || !ED.drag || !ED.items?.[ED.drag.n]) return;
    const item = ED.items[ED.drag.n];
    if (!Array.isArray(item.box) || item.box.length !== 4) return;
    const width = Number(S.sess?.src_w) || 0;
    const height = Number(S.sess?.src_h) || 0;
    if (!width || !height) return;
    let [x1, y1, x2, y2] = item.box;
    // Crop each coordinate independently. The part that remains inside stays
    // exactly where the pointer put it; only the outside portion is cut.
    x1 = Math.max(0, Math.min(width, x1));
    x2 = Math.max(0, Math.min(width, x2));
    y1 = Math.max(0, Math.min(height, y1));
    y2 = Math.max(0, Math.min(height, y2));
    item.box = [Math.min(x1, x2), Math.min(y1, y2), Math.max(x1, x2), Math.max(y1, y2)];
    const canvas = document.getElementById("view");
    if (canvas && state.bboxMode) canvas.style.cursor = "crosshair";
  }

  function onBboxMouseMove(event) {
    if (!bboxLabelingReady()) return;
    if (state.bboxMode === "create" && state.bboxCreateDraft) {
      event.preventDefault();
      event.stopImmediatePropagation();
      updateBboxCreateDraft(event);
      const canvas = document.getElementById("view");
      if (canvas) canvas.style.cursor = "crosshair";
      return;
    }
    if (state.bboxMode === "delete" && bboxEditingAvailable() && bboxDeleteTarget(event)) {
      const point = bboxEventPoint(event);
      ED.mouse = point.canvasPoint.map((value, index) => index ?
        Math.max(0, Math.min(point.canvas.height, value)) : Math.max(0, Math.min(point.canvas.width, value)));
      if (event.target !== point.canvas && typeof edRepaint === "function") edRepaint();
    }
    if (state.bboxMode) document.getElementById("view").style.cursor = "crosshair";
  }

  function drawBboxDeletePolygon() {
    if (state.bboxMode !== "delete" || !bboxLabelingReady() || typeof ED === "undefined" ||
        typeof ctx === "undefined" || !Array.isArray(ED.poly)) return;
    const saved = state.bboxDeleteRegion;
    const sameSavedRegion = saved && saved.generation === S.gen && saved.key === ED.key && saved.label === S.labelSel;
    const draft = ED.poly;
    const points = draft.length ? draft : sameSavedRegion ? saved.points : null;
    if (!points?.length) return;
    const canvas = document.getElementById("view");
    drawCanvasPolygonOverlay(points, draft.length > 0, canvas.width / S.sess.src_w, "#ff4d5a", "rgba(255,77,90,.22)");
  }

  function onBboxMouseUp(event) {
    if (state.bboxMode === "create" && state.bboxCreateDraft) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    // Closing an M polygon by clicking its first point commits on mousedown.
    // Do not let the matching mouseup fall through to the native bbox drag
    // cleanup, which would discard the just-created bulk delete operation.
    if (state.bboxMode === "delete") {
      if (bboxDeleteTarget(event)) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
      ED.drag = null;
      ED.marq = null;
      return;
    }
    // Match CVAT: while dragging, let the box follow the pointer outside the
    // image. On release, crop the outside portion at the nearest image edge,
    // then let the native editor save the resulting smaller box.
    settleBboxInsideImage();
    if (bboxLabelingReady() && ED.drag && !ED.drag.create &&
        !(bboxEdgePatchMatches() && !state.bboxEdgePatch.ready && state.bboxEdgePatch.itemIndex === ED.drag.n)) {
      state.quickLastOperation = null;
    }
    if (quickBboxReady() && ED.drag?.moved && !ED.drag.create && Array.isArray(ED.drag.box0) &&
        !(bboxEdgePatchMatches() && !state.bboxEdgePatch.ready &&
          state.bboxEdgePatch.itemIndex === ED.drag.n)) {
      const beforeItems = cloneGenericItems(ED.items);
      if (beforeItems[ED.drag.n]) beforeItems[ED.drag.n].box = ED.drag.box0.slice();
      rememberBboxUndo([{ g: Number(S.shownG), items: beforeItems }]);
    }
    finalizeBboxEdgePatch();
    trackCreatedBoxOnMouseUp();
    if (!bboxEditingAvailable() || state.bboxMode || !ED.marq) return;
    const marquee = ED.marq;
    if (Math.abs(marquee.x1 - marquee.x0) >= 4 || Math.abs(marquee.y1 - marquee.y0) >= 4) return;
    ED.marq = null;
    ED.poly = [];
    clearEditorSelection();
    if (typeof edRepaint === "function") edRepaint();
  }

  Object.assign(NL, {
    bboxLabelingReady, bboxEditingAvailable, drawBboxOverlapWarnings, ensureBboxEditing,
    ensureLabelVisibility, currentGenericClipContext, quickOperationMatches, rememberBboxUndo,
    replaceCurrentBboxItems, bboxHorizontalOrder, deleteQuickBbox, previousQuickBboxFrames,
    quickBboxCopyAvailable, copyPreviousQuickBbox, copyQuickBboxToClipboard,
    pasteQuickBboxFromClipboard, undoQuickBbox, bboxEdgeGeometry, onBboxEdgeDoubleClick,
    bboxEdgePatchMatches, finalizeBboxEdgePatch, drawBboxEdgePatch, trackCreatedBoxOnMouseUp,
    bboxEventPoint, discardBboxCreateDraft, cancelBboxMode, setBboxMode, updateBboxCreateDraft,
    finishBboxCreateDraft, bboxDeleteTarget, commitBboxDeletePolygon, bboxPointerDragAvailable,
    onBboxPointerDown, releaseBboxPointer, tryStartBboxEdgePatchDrag,
    tryForwardStageCornerMouseDown, handleBboxDeletePolygonMouseDown,
    handleBboxCreateCornerMouseDown, onBboxMouseDown, settleBboxInsideImage, onBboxMouseMove,
    drawBboxDeletePolygon, onBboxMouseUp
  });
})();
