(() => {
  "use strict";

  const NL = window.__notaOrganizerV1 = window.__notaOrganizerV1 || {};
  const {
    activeClipBaseContext, clipKey, drawCanvasPolygonOverlay, frameState, getClipNo,
    loadAutoLabel, notify, pageLabelingReady, postFrameLabelEdit,
    readCurrentEditorOrSavedItems, readFrameAutoOrSavedItems, saveFrameState, state
  } = NL;

  function eyeLandmarkActive() {
    try {
      return pageLabelingReady("eye_lmk") && typeof lmkActive === "function" && lmkActive();
    } catch (_) {
      return false;
    }
  }

  function eyeSelectionGeometry(event = null) {
    if (!eyeLandmarkActive() || S.showAl === false || typeof LM === "undefined" ||
        typeof lmkCur !== "function" || typeof view === "undefined" || !view) return null;
    const items = lmkCur();
    const item = items?.[LM.n];
    const points = item?.pts?.filter((point) => Array.isArray(point));
    if (!points?.length) return null;
    const rect = view.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const scale = view.width / S.sess.src_w;
    const k = typeof pxK === "function" ? pxK() : view.width / rect.width;
    const bounds = [
      Math.min(...points.map((point) => point[0])),
      Math.min(...points.map((point) => point[1])),
      Math.max(...points.map((point) => point[0])),
      Math.max(...points.map((point) => point[1]))
    ];
    const padding = 14 * k;
    const display = [bounds[0] * scale - padding, bounds[1] * scale - padding,
      bounds[2] * scale + padding, bounds[3] * scale + padding];
    const [x1, y1, x2, y2] = display;
    const handles = [
      { key: "nw", x: x1, y: y1, cursor: "nwse-resize" },
      { key: "ne", x: x2, y: y1, cursor: "nesw-resize" },
      { key: "se", x: x2, y: y2, cursor: "nwse-resize" },
      { key: "sw", x: x1, y: y2, cursor: "nesw-resize" },
      { key: "n", x: (x1 + x2) / 2, y: y1, cursor: "ns-resize" },
      { key: "s", x: (x1 + x2) / 2, y: y2, cursor: "ns-resize" },
      { key: "w", x: x1, y: (y1 + y2) / 2, cursor: "ew-resize" },
      { key: "e", x: x2, y: (y1 + y2) / 2, cursor: "ew-resize" }
    ];
    const canvasPoint = event ? [
      (event.clientX - rect.left) * view.width / rect.width,
      (event.clientY - rect.top) * view.height / rect.height
    ] : null;
    return { item, points, rect, scale, k, bounds, display, handles, canvasPoint };
  }

  function eyeResizeAtEvent(event) {
    const geometry = eyeSelectionGeometry(event);
    if (!geometry) return null;
    const tolerance = 7 * geometry.k;
    const handle = geometry.handles.find((candidate) =>
      Math.abs(candidate.x - geometry.canvasPoint[0]) <= tolerance &&
      Math.abs(candidate.y - geometry.canvasPoint[1]) <= tolerance);
    if (!handle) return null;
    return {
      ...geometry,
      handle: handle.key,
      cursor: handle.cursor,
      paddingSource: 14 * geometry.k / geometry.scale,
      start: [geometry.canvasPoint[0] / geometry.scale, geometry.canvasPoint[1] / geometry.scale],
      original: geometry.item.pts.map((point) => Array.isArray(point) ? point.slice() : null),
      moved: false
    };
  }

  function eyeGroupAtEvent(event, allowPoint = false) {
    const geometry = eyeSelectionGeometry(event);
    if (!geometry) return null;
    const { item, points, scale, k, display, canvasPoint } = geometry;
    const hitTolerance = 10 * k;
    const hitsPoint = points.some((point) =>
      Math.hypot(point[0] * scale - canvasPoint[0], point[1] * scale - canvasPoint[1]) <= hitTolerance);
    if (hitsPoint && !allowPoint) return null;
    if (canvasPoint[0] < display[0] || canvasPoint[0] > display[2] ||
        canvasPoint[1] < display[1] || canvasPoint[1] > display[3]) return null;
    return {
      item,
      bounds: geometry.bounds,
      paddingSource: 14 * k / scale,
      start: [canvasPoint[0] / scale, canvasPoint[1] / scale],
      original: item.pts.map((point) => Array.isArray(point) ? point.slice() : null),
      moved: false
    };
  }

  function onEyeGroupMouseDown(event) {
    if (event.button !== 0 || event.metaKey || event.altKey || event.shiftKey || state.eyeGroupDrag) return;
    if (typeof LM !== "undefined" && LM.addEye) return;
    const resize = event.ctrlKey ? null : eyeResizeAtEvent(event);
    const drag = resize || eyeGroupAtEvent(event, event.ctrlKey);
    if (!drag) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    drag.mode = resize ? "resize" : event.ctrlKey ? "rotate" : "move";
    if (drag.mode === "rotate") {
      const points = drag.original.filter((point) => Array.isArray(point));
      drag.center = [
        points.reduce((sum, point) => sum + point[0], 0) / points.length,
        points.reduce((sum, point) => sum + point[1], 0) / points.length
      ];
      drag.startAngle = Math.atan2(drag.start[1] - drag.center[1], drag.start[0] - drag.center[0]);
    }
    state.eyeGroupDrag = drag;
    try { if (typeof pause === "function") pause(); } catch (_) {}
    try { view.style.cursor = drag.cursor || "grabbing"; } catch (_) {}
    if (drag.mode === "rotate") notify("Rotating the entire eye 15pt group");
  }

  function onEyeGroupMouseMove(event) {
    const drag = state.eyeGroupDrag;
    if (!drag || typeof view === "undefined" || !view) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const rect = view.getBoundingClientRect();
    const scale = view.width / S.sess.src_w;
    const current = [
      (event.clientX - rect.left) * view.width / rect.width / scale,
      (event.clientY - rect.top) * view.height / rect.height / scale
    ];
    const round = (value) => Math.round(value * 10) / 10;
    if (drag.mode === "rotate") {
      const angle = Math.atan2(current[1] - drag.center[1], current[0] - drag.center[0]) - drag.startAngle;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      drag.item.pts = drag.original.map((point) => point ? [
        round(drag.center[0] + (point[0] - drag.center[0]) * cos - (point[1] - drag.center[1]) * sin),
        round(drag.center[1] + (point[0] - drag.center[0]) * sin + (point[1] - drag.center[1]) * cos)
      ] : null);
      drag.moved = drag.moved || Math.abs(angle) >= 0.001;
    } else if (drag.mode === "resize") {
      const [left, top, right, bottom] = drag.bounds;
      const next = [left, top, right, bottom];
      const pad = drag.paddingSource;
      const minSize = 2;
      if (drag.handle.includes("w")) next[0] = Math.min(right - minSize, current[0] + pad);
      if (drag.handle.includes("e")) next[2] = Math.max(left + minSize, current[0] - pad);
      if (drag.handle.includes("n")) next[1] = Math.min(bottom - minSize, current[1] + pad);
      if (drag.handle.includes("s")) next[3] = Math.max(top + minSize, current[1] - pad);
      const scaleX = (next[2] - next[0]) / Math.max(minSize, right - left);
      const scaleY = (next[3] - next[1]) / Math.max(minSize, bottom - top);
      drag.item.pts = drag.original.map((point) => point ? [
        round(next[0] + (point[0] - left) * scaleX),
        round(next[1] + (point[1] - top) * scaleY)
      ] : null);
      drag.moved = drag.moved || next.some((value, index) => Math.abs(value - drag.bounds[index]) >= 0.05);
    } else {
      const dx = current[0] - drag.start[0];
      const dy = current[1] - drag.start[1];
      drag.item.pts = drag.original.map((point) => point ? [round(point[0] + dx), round(point[1] + dy)] : null);
      drag.moved = drag.moved || Math.abs(dx) >= 0.05 || Math.abs(dy) >= 0.05;
    }
    try { LM.sig = null; } catch (_) {}
    try { if (typeof edRepaint === "function") edRepaint(); } catch (_) {}
  }

  function onEyeTransformHover(event) {
    if (state.eyeGroupDrag || !eyeLandmarkActive() || S.showAl === false) return;
    const resize = eyeResizeAtEvent(event);
    if (resize && !event.ctrlKey) {
      view.style.cursor = resize.cursor;
      return;
    }
    const group = eyeGroupAtEvent(event, event.ctrlKey);
    if (group) view.style.cursor = event.ctrlKey ? "crosshair" : "grab";
  }

  function onEyeGroupMouseUp(event) {
    const drag = state.eyeGroupDrag;
    if (!drag) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    state.eyeGroupDrag = null;
    try { view.style.cursor = ""; } catch (_) {}
    if (drag.moved) {
      try { if (typeof lmkChanged === "function") lmkChanged(); } catch (_) {}
    }
  }

  function ensureEyeGroupDragging() {
    if (state.eyeGroupDraggingInstalled || typeof view === "undefined" || !view) return;
    window.addEventListener("mousedown", onEyeGroupMouseDown, true);
    window.addEventListener("mousemove", onEyeGroupMouseMove, true);
    window.addEventListener("mouseup", onEyeGroupMouseUp, true);
    view.addEventListener("mousemove", onEyeTransformHover);
    state.eyeGroupDraggingInstalled = true;
  }

  function drawEyeTransformBox() {
    const geometry = eyeSelectionGeometry();
    if (!geometry || typeof ctx === "undefined") return;
    const [x1, y1, x2, y2] = geometry.display;
    const size = 7 * geometry.k;
    ctx.save();
    ctx.setLineDash([4 * geometry.k, 3 * geometry.k]);
    ctx.strokeStyle = "#ffea00";
    ctx.lineWidth = 1.2 * geometry.k;
    ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
    ctx.setLineDash([]);
    for (const handle of geometry.handles) {
      ctx.fillStyle = "#fff";
      ctx.fillRect(handle.x - size / 2, handle.y - size / 2, size, size);
      ctx.strokeStyle = "#111";
      ctx.lineWidth = geometry.k;
      ctx.strokeRect(handle.x - size / 2, handle.y - size / 2, size, size);
    }
    ctx.restore();
  }

  function ensureEyeTransformDrawing() {
    if (state.eyeTransformDrawingInstalled || typeof lmkDraw !== "function") return;
    const nativeDraw = lmkDraw;
    lmkDraw = function (...args) {
      const result = nativeDraw.apply(this, args);
      if (eyeLandmarkActive() && S.showAl !== false) drawEyeTransformBox();
      return result;
    };
    state.eyeTransformDrawingInstalled = true;
  }

  function ensureEyePanelHint() {
    if (state.eyePanelHintInstalled || typeof lmkPanel !== "function") return;
    const nativePanel = lmkPanel;
    lmkPanel = function (...args) {
      const result = nativePanel.apply(this, args);
      if (pageLabelingReady("eye_lmk")) {
        const panel = document.getElementById("lmkRef");
        if (panel && !panel.querySelector(".nl-eye-group-hint")) {
          const hint = document.createElement("div");
          hint.className = "nl-eye-group-hint";
          hint.innerHTML = "N: add eye · C: copy previous · R: delete selected · X: delete all · Z: undo<br>Alt+C: closed eye · Drag inside the box to move · Ctrl + drag to rotate<br>Drag an edge or corner handle to resize";
          panel.appendChild(hint);
        }
      }
      return result;
    };
    state.eyePanelHintInstalled = true;
  }

  function cloneEyeItems(items) {
    return (items || []).map((item) => {
      if (!Array.isArray(item?.pts)) return null;
      return {
        pts: item.pts.map((point) => Array.isArray(point) && point.length >= 2
          ? [Number(point[0]), Number(point[1])]
          : null),
        ...(item.closed ? { closed: true } : {})
      };
    }).filter(Boolean);
  }

  function currentEyeItems() {
    return readCurrentEditorOrSavedItems("eye_lmk", cloneEyeItems);
  }

  function currentEyeClipContext() {
    const base = activeClipBaseContext("eye_lmk");
    if (!base) return null;
    const sourceItems = currentEyeItems();
    let selected = [];
    try {
      if (typeof LM !== "undefined" && Number.isInteger(LM.n) && LM.n >= 0 && LM.n < sourceItems.length) {
        selected = [LM.n];
      }
    } catch (_) {}
    return {
      ...base,
      label: "eye_lmk",
      labelName: "eye 15pt",
      sourceItems,
      selected
    };
  }

  async function getFrameEyeItems(g, expectedGeneration) {
    return readFrameAutoOrSavedItems(g, "eye_lmk", expectedGeneration, cloneEyeItems);
  }

  function sameEyeItem(left, right) {
    if (!Array.isArray(left?.pts) || !Array.isArray(right?.pts) || left.pts.length !== right.pts.length) return false;
    if (Boolean(left.closed) !== Boolean(right.closed)) return false;
    return left.pts.every((point, index) => {
      const other = right.pts[index];
      if (!point || !other) return point === other;
      return Math.abs(point[0] - other[0]) < 0.05 && Math.abs(point[1] - other[1]) < 0.05;
    });
  }

  async function saveFrameEyeItems(g, items, expectedGeneration) {
    const round = (value) => Math.round(Number(value) * 10) / 10;
    const savedItems = cloneEyeItems(items).map((item) => ({
      pts: item.pts.map((point) => point ? [round(point[0]), round(point[1])] : null),
      ...(item.closed ? { closed: true } : {})
    }));
    await postFrameLabelEdit(g, "eye_lmk", savedItems, expectedGeneration);
    if (frameState(g) === "todo") await saveFrameState(g, "eye_lmk", "wip", expectedGeneration);
  }

  function eyeCenterX(item) {
    const points = item?.pts?.filter((point) => Array.isArray(point));
    return points?.length ? points.reduce((sum, point) => sum + point[0], 0) / points.length : Infinity;
  }

  function eyeGeometry(item) {
    const points = item?.pts?.filter((point) => Array.isArray(point));
    if (!points?.length) return null;
    const xs = points.map((point) => point[0]);
    const ys = points.map((point) => point[1]);
    const left = Math.min(...xs), right = Math.max(...xs);
    const top = Math.min(...ys), bottom = Math.max(...ys);
    return { x: (left + right) / 2, y: (top + bottom) / 2,
      width: Math.max(1, right - left), height: Math.max(1, bottom - top) };
  }

  function mergeEyeLandmarks(targetItems, sourceItems, context, scope) {
    const nextItems = cloneEyeItems(targetItems);
    const sourceIndexes = scope === "selected" ? context.selected : context.sourceItems.map((_, index) => index);
    const available = new Set(nextItems.map((_, index) => index));
    for (const sourceIndex of sourceIndexes) {
      const source = context.sourceItems[sourceIndex];
      const copy = cloneEyeItems([source])[0];
      if (!copy) continue;
      const from = eyeGeometry(copy);
      let best = null;
      if (from) for (const index of available) {
        const to = eyeGeometry(nextItems[index]);
        if (!to) continue;
        // Opposite eyes can be the only objects in their frames. Match by
        // image position, not by rank, or one eye erases the other.
        const dx = Math.abs(from.x - to.x) / Math.max(from.width, to.width);
        const dy = Math.abs(from.y - to.y) / Math.max(from.height, to.height);
        const score = dx * dx + dy * dy;
        const belongsToAnotherEye = context.sourceItems.some((other, otherIndex) => {
          if (otherIndex === sourceIndex) return false;
          const candidate = eyeGeometry(other);
          if (!candidate) return false;
          const otherDx = Math.abs(candidate.x - to.x) / Math.max(candidate.width, to.width);
          const otherDy = Math.abs(candidate.y - to.y) / Math.max(candidate.height, to.height);
          return otherDx * otherDx + otherDy * otherDy < score;
        });
        if (belongsToAnotherEye) continue;
        if (dx <= 1.25 && dy <= 2 && (!best || score < best.score)) best = { index, score };
      }
      if (best) {
        nextItems[best.index] = copy;
        available.delete(best.index);
      } else if (!nextItems.some((existing) => sameEyeItem(existing, copy))) nextItems.push(copy);
    }
    return nextItems;
  }

  function manualPolygonAvailable() {
    try {
      return pageLabelingReady("seatbelt") && typeof BT !== "undefined" && typeof beltLoad === "function" &&
        typeof beltActive === "function" && beltActive() && beltLoad();
    } catch (_) {
      return false;
    }
  }

  function patchMatchesContext(context) {
    return Boolean(state.lastPatch && state.lastPatch.key === context.sourceKey &&
      state.lastPatch.generation === context.generation);
  }

  function ensureNativeEditing() {
    if (state.nativeEditingInstalled || typeof beltChanged !== "function" ||
        typeof beltMode !== "function" || typeof beltApply !== "function" || typeof samRun !== "function" ||
        typeof beltLoad !== "function") return;
    // A native SAM/edit operation replaces the manual polygon as the latest
    // edit. Never let Ctrl+B reuse an earlier red deletion region afterwards.
    const nativeChanged = beltChanged;
    beltChanged = function (...args) {
      if (!state.committingPolygon) discardManualPolygon();
      return nativeChanged.apply(this, args);
    };
    const nativeApply = beltApply;
    beltApply = function (subtract, ...args) {
      const patch = captureSamPatch(Boolean(subtract));
      const result = nativeApply.call(this, subtract, ...args);
      if (patch && patch.key === BT.key && patch.generation === S.gen) {
        state.lastPatch = patch;
        updatePolygonTools(`${subtract ? "Removed" : "Added"} ${patch.pixelCount.toLocaleString()} px with SAM3. Ctrl+B applies only the latest edit.`);
      }
      return result;
    };
    const nativeMode = beltMode;
    beltMode = function (...args) {
      discardManualPolygon();
      return nativeMode.apply(this, args);
    };
    const nativeSam = samRun;
    samRun = function (...args) {
      cancelManualMode();
      return nativeSam.apply(this, args);
    };
    const nativeLoad = beltLoad;
    beltLoad = function (...args) {
      const key = BT.key;
      const regionContext = prepareBeltRegionContext();
      if (regionContext) rememberBeltRegion();
      const result = nativeLoad.apply(this, args);
      if (result && regionContext && BT.key === regionContext.key) {
        const entering = !state.regionFrame || state.regionFrame.key !== BT.key;
        if (entering || !validBeltRegion(BT.region)) {
          const saved = state.frameRegions.get(BT.key) || state.clipRegions.get(regionContext.clip);
          if (validBeltRegion(saved)) BT.region = saved.slice();
        }
        state.regionFrame = regionContext;
        rememberBeltRegion();
      }
      if (BT.key !== key) discardManualPolygon();
      return result;
    };
    if (typeof beltPanel === "function") {
      const nativePanel = beltPanel;
      beltPanel = function (...args) {
        const result = nativePanel.apply(this, args);
        if (pageLabelingReady("seatbelt")) {
          const status = document.getElementById("btStat");
          if (BT.prev && status?.textContent.includes("Enter add")) {
            status.textContent = status.textContent.replace("Enter add", "R add");
          }
          const add = document.getElementById("btAdd");
          if (add?.textContent.includes("(Enter)")) {
            add.textContent = add.textContent.replace("(Enter)", "(R)");
          }
        }
        return result;
      };
    }
    state.nativeEditingInstalled = true;
  }

  function prepareBeltRegionContext() {
    if (!pageLabelingReady("seatbelt")) return null;
    const previous = state.regionScope;
    if (!previous || previous.generation !== S.gen || previous.session !== S.sess ||
        previous.width !== S.sess.src_w || previous.height !== S.sess.src_h) {
      state.regionScope = { generation: S.gen, session: S.sess,
        width: S.sess.src_w, height: S.sess.src_h };
      state.frameRegions.clear();
      state.clipRegions.clear();
      state.regionFrame = null;
      if (previous) {
        // A new session can reuse segment/frame keys. Reload its mask and ROI
        // instead of retaining an editor buffer from the previous session.
        BT.key = null;
        BT.region = null;
        discardManualPolygon();
      }
    }
    const li = state.list?.querySelector(`li[data-g="${S.shownG}"]`);
    const row = li?.closest(".grp");
    const part = row?.dataset.partName || row?.querySelector(":scope > .vlab")?.textContent?.trim();
    const clip = li?.closest(".nl-clip")?.dataset.key || (part ? clipKey(part, getClipNo(li)) : null);
    return { key: rvKey(S.shownG), clip };
  }

  function validBeltRegion(region) {
    return Array.isArray(region) && region.length === 4 && region.every(Number.isFinite) &&
      region[0] >= 0 && region[1] >= 0 && region[2] <= BT.W && region[3] <= BT.H &&
      region[2] > region[0] && region[3] > region[1];
  }

  function rememberBeltRegion() {
    const frame = state.regionFrame;
    if (!frame || frame.key !== BT.key || !validBeltRegion(BT.region)) return;
    // ROI is a local SAM crop, separate from the mask copied by Ctrl+B.
    // Remember each frame's crop and inherit it only within the same clip.
    state.frameRegions.set(frame.key, BT.region.slice());
    if (frame.clip) state.clipRegions.set(frame.clip, BT.region.slice());
  }

  function captureSamPatch(subtract) {
    if (!pageLabelingReady("seatbelt") || !BT.prev || !BT.mask || BT.key !== rvKey(S.shownG)) return null;
    const mask = new Uint8Array(BT.mask.length);
    let pixelCount = 0;
    for (let index = 0; index < mask.length; index += 1) {
      // A SAM prediction can overlap the pre-existing belt. Keep only pixels
      // changed by this Apply, so bulk copy cannot carry old segments along.
      if (BT.prev[index] && BT.mask[index] === (subtract ? 1 : 0)) {
        mask[index] = 1;
        pixelCount += 1;
      }
    }
    return { key: BT.key, generation: S.gen, kind: "sam", mask, pixelCount,
      operation: subtract ? "subtract" : "add" };
  }

  function ensurePolygonDrawing() {
    if (state.polygonDrawingInstalled || typeof beltDraw !== "function") return;
    const nativeDraw = beltDraw;
    beltDraw = function (...args) {
      // K controls the page's Auto-label visibility. On an editable seatbelt
      // frame the native editor draws its blue mask independently, so it used
      // to remain visible until the frame was Done. Honor the same switch
      // while the frame is In progress, including ROI, SAM preview and drafts.
      if (pageLabelingReady("seatbelt") && typeof S !== "undefined" && S.showAl === false) return;
      // Suppress the native white selection polygon while our colored editing
      // polygon is active. Keep the page's mask, ROI and other tools intact.
      const manual = state.manualMode && pageLabelingReady("seatbelt") &&
        typeof BT !== "undefined" && BT.key === rvKey(S.shownG);
      const key = manual ? BT.key : null;
      const points = manual ? BT.poly : null;
      const completed = manual ? BT.polyDone : null;
      if (manual) { BT.poly = []; BT.polyDone = null; }
      let result;
      try {
        result = nativeDraw.apply(this, args);
      } finally {
        // beltLoad resets editing state when navigation changes the frame.
        if (manual && BT.key === key) { BT.poly = points; BT.polyDone = completed; }
      }
      drawManualPolygon();
      return result;
    };
    state.polygonDrawingInstalled = true;
  }

  function drawManualPolygon() {
    if (!state.manualMode || !pageLabelingReady("seatbelt") || typeof BT === "undefined" ||
        typeof ctx === "undefined" || !BT.W || BT.key !== rvKey(S.shownG)) return;
    const draft = BT.poly || [];
    const last = patchMatchesContext({ sourceKey: BT.key, generation: S.gen }) &&
      state.lastPatch.operation === state.manualMode ? state.lastPatch : null;
    const points = draft.length ? draft : last?.points;
    if (!points?.length) return;
    const canvas = document.getElementById("view");
    const subtract = state.manualMode === "subtract";
    drawCanvasPolygonOverlay(
      points,
      draft.length > 0,
      canvas.width / BT.W,
      subtract ? "#ff4d5a" : "#39ff88",
      subtract ? "rgba(255,77,90,.22)" : "rgba(57,255,136,.16)"
    );
  }

  function ensurePolygonTools() {
    const beltTools = document.getElementById("beltTools");
    if (!beltTools || document.getElementById("nl-polygon-tools")) return;
    const tools = document.createElement("div");
    tools.id = "nl-polygon-tools";
    tools.innerHTML = `
      <div class="nl-poly-buttons">
        <button type="button" data-poly="add">＋ Polygon (N)</button>
        <button type="button" data-poly="subtract">− Erase region (M)</button>
      </div>
      <div class="nl-poly-help">Click points on the image; click the first point again or right-click to close the region.</div>
    `;
    const modes = beltTools.querySelector(".btModes");
    if (modes) modes.after(tools);
    else beltTools.prepend(tools);
    for (const button of tools.querySelectorAll("[data-poly]")) {
      button.addEventListener("click", () => setManualMode(button.dataset.poly));
    }
    updatePolygonTools();
  }

  function updatePolygonTools(message = "") {
    const tools = document.getElementById("nl-polygon-tools");
    if (!tools) return;
    for (const button of tools.querySelectorAll("[data-poly]")) {
      button.classList.toggle("on", button.dataset.poly === state.manualMode);
    }
    const help = tools.querySelector(".nl-poly-help");
    if (message) help.textContent = message;
    else if (state.manualMode === "add") help.textContent = "Draw an add region · click points · click the first point or right-click to create the mask and finish · Esc to cancel.";
    else if (state.manualMode === "subtract") help.textContent = "Red erase region · click the first point or right-click to close · Ctrl+B to erase across frames · Esc to discard the pending region · Z to undo.";
    else help.textContent = "SAM3: left-click (+), right-click (−), R to add the green preview · F: Done/In progress · Space: play/pause · N: polygon · M: erase region · Z: undo.";
  }

  function discardManualPolygon() {
    state.manualMode = null;
    state.lastPatch = null;
    if (typeof BT !== "undefined") {
      BT.poly = [];
      BT.polyDone = null;
      BT.dirty = true;
    }
    updatePolygonTools();
  }

  function cancelManualMode() {
    discardManualPolygon();
    try {
      if (typeof edRepaint === "function") edRepaint();
    } catch (_) {}
  }

  function setManualMode(mode) {
    if (state.operationBusy) return;
    if (!manualPolygonAvailable()) {
      notify("Done frames are locked. Set In progress before drawing a polygon");
      return;
    }
    if (state.manualMode === mode) {
      cancelManualMode();
      return;
    }
    state.lastPatch = null;
    try {
      BT.prev = null;
      BT.info = null;
      BT.points = [];
      BT.poly = [];
      BT.polyDone = null;
      BT.req += 1;
      BT.busy = false;
      if (BT.sel) BT.sel.fill(0);
      BT.dirty = true;
    } catch (_) {}
    state.manualMode = mode;
    ensurePolygonDrawing();
    updatePolygonTools();
    if (typeof edRepaint === "function") edRepaint();
    notify(mode === "add" ? "Add polygon: click points, then click the first point or right-click" : "Erase polygon: click points, then click the first point or right-click");
  }

  function pointOnView(event) {
    const canvas = document.getElementById("view");
    const rect = canvas.getBoundingClientRect();
    const width = typeof BT !== "undefined" && BT.W ? BT.W : canvas.width;
    const height = typeof BT !== "undefined" && BT.H ? BT.H : canvas.height;
    return [
      Math.max(0, Math.min(width - 1, (event.clientX - rect.left) * width / rect.width)),
      Math.max(0, Math.min(height - 1, (event.clientY - rect.top) * height / rect.height))
    ];
  }

  function manualPolygonStageTarget(event) {
    if (!state.manualMode) return false;
    const stage = document.getElementById("stage");
    return !!stage && event.target === stage;
  }

  function onManualMouseMove(event) {
    if (!manualPolygonStageTarget(event) || !manualPolygonAvailable() || typeof ED === "undefined") return;
    const canvas = document.getElementById("view");
    if (!canvas || !BT.W) return;
    const point = pointOnView(event);
    const scale = canvas.width / BT.W;
    ED.mouse = [point[0] * scale, point[1] * scale];
    if (typeof edRepaint === "function") edRepaint();
  }

  function polygonPatch(points, width, height) {
    const patch = new Uint8Array(width * height);
    const ys = points.map((point) => point[1]);
    const y0 = Math.max(0, Math.floor(Math.min(...ys)));
    const y1 = Math.min(height - 1, Math.ceil(Math.max(...ys)));
    for (let y = y0; y <= y1; y += 1) {
      const scanY = y + 0.5;
      const intersections = [];
      for (let index = 0, previous = points.length - 1; index < points.length; previous = index, index += 1) {
        const [x1, y1p] = points[index];
        const [x2, y2p] = points[previous];
        if ((y1p > scanY) !== (y2p > scanY)) intersections.push(((x2 - x1) * (scanY - y1p)) / (y2p - y1p) + x1);
      }
      intersections.sort((a, b) => a - b);
      for (let index = 0; index + 1 < intersections.length; index += 2) {
        const x0 = Math.max(0, Math.ceil(intersections[index]));
        const x1 = Math.min(width - 1, Math.floor(intersections[index + 1]));
        for (let x = x0; x <= x1; x += 1) patch[y * width + x] = 1;
      }
    }
    return patch;
  }

  function commitManualPolygon() {
    if (!manualPolygonAvailable() || !state.manualMode || BT.poly.length < 3) {
      notify("A polygon needs at least 3 points");
      return;
    }
    const points = BT.poly.map((point) => point.slice());
    const patch = polygonPatch(points, BT.W, BT.H);
    const subtract = state.manualMode === "subtract";
    let changed = 0;
    for (let index = 0; index < patch.length; index += 1) {
      if (patch[index] && BT.mask[index] === (subtract ? 1 : 0)) changed += 1;
    }
    if (changed) {
      if (typeof pushUndo === "function") pushUndo();
      for (let index = 0; index < patch.length; index += 1) {
        if (patch[index]) BT.mask[index] = subtract ? 0 : 1;
      }
    }
    state.lastPatch = { key: BT.key, generation: S.gen, kind: "polygon", mask: patch, points,
      operation: subtract ? "subtract" : "add" };
    if (subtract) {
      try { if (typeof polyFlash === "function") polyFlash(BT, points); } catch (_) {}
    } else {
      // The add polygon is finished: show the saved blue mask immediately.
      // Keep lastPatch available for Ctrl+B, without retaining drawing handles.
      state.manualMode = null;
      BT.polyDone = null;
    }
    BT.poly = [];
    BT.dirty = true;
    if (changed && typeof beltChanged === "function") {
      state.committingPolygon = true;
      try { beltChanged(); } finally { state.committingPolygon = false; }
    }
    else if (typeof edRepaint === "function") edRepaint();
    updatePolygonTools(`${subtract ? "Removed" : "Added"} polygon (${changed.toLocaleString()} px). Ctrl+B to apply to other frames.` +
      (subtract ? " Esc to exit erase mode." : " Press N to draw another polygon."));
    notify(`${subtract ? "Removed" : "Added"} polygon · ${changed.toLocaleString()} px`);
  }

  function onManualMouseDown(event) {
    if (!state.manualMode) return;
    const onView = event.target === document.getElementById("view");
    const onStage = manualPolygonStageTarget(event);
    if (!onView && !onStage) return;
    // N and M may place a point from the black area around the image. The
    // coordinate is clamped by pointOnView, so the saved point stays on-image.
    // Keep right-click closing limited to the image itself.
    if (onStage && event.button !== 0) return;
    if (!manualPolygonAvailable()) {
      cancelManualMode();
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    try { if (typeof pause === "function") pause(); } catch (_) {}

    if (event.button === 2) {
      commitManualPolygon();
      return;
    }
    if (event.button !== 0) return;
    const point = pointOnView(event);
    if (BT.poly.length >= 3) {
      const first = BT.poly[0];
      const tolerance = 12 * BT.W / document.getElementById("view").getBoundingClientRect().width;
      if (Math.hypot(point[0] - first[0], point[1] - first[1]) <= tolerance) {
        commitManualPolygon();
        return;
      }
    }
    if (!BT.poly.length) {
      state.lastPatch = null;
      BT.polyDone = null;
    }
    BT.poly.push(point);
    if (typeof edRepaint === "function") edRepaint();
    updatePolygonTools(`${BT.poly.length} points placed · click the first point or right-click to close.`);
  }

  function samAcceptAvailable() {
    return !state.manualMode && pageLabelingReady("seatbelt") && typeof BT !== "undefined" &&
      !(typeof RV_OPEN !== "undefined" && RV_OPEN) && typeof beltActive === "function" && beltActive() &&
      (BT.mode === "pt" || BT.mode === "box");
  }

  function acceptSamPreview() {
    if (state.operationBusy || state.bulkDialog?.open || !manualPolygonAvailable()) return;
    if (BT.busy) {
      notify("SAM3 is processing. Wait for the green preview, then press R to add it");
      return;
    }
    if (!BT.prev) {
      notify("No green SAM3 preview to add yet");
      return;
    }
    try { if (typeof pause === "function") pause(); } catch (_) {}
    beltApply(false);
    notify("Added the SAM3 mask · Ctrl+B to apply only the latest added area");
  }

  function undoSeatbelt() {
    if (state.operationBusy || !manualPolygonAvailable()) return;
    if (state.manualMode && BT.poly.length) {
      BT.poly.pop();
      BT.dirty = true;
      if (typeof edRepaint === "function") edRepaint();
      updatePolygonTools(`Undid the last point · ${BT.poly.length} points remaining.`);
      return;
    }
    if (typeof beltUndo !== "function" || !BT.undo.length) {
      notify("No more operations to undo in this frame");
      return;
    }
    // Do not keep propagating a polygon that the user has just undone.
    if (patchMatchesContext({ sourceKey: BT.key, generation: S.gen })) state.lastPatch = null;
    BT.polyDone = null;
    beltUndo();
    updatePolygonTools("Undid the latest mask edit in this frame.");
  }

  function maskBulkBlockReason() {
    if (typeof BT === "undefined") return "";
    if (state.manualMode && BT.poly?.length) return "Close the polygon before copying, or cancel drawing with Esc.";
    if (BT.busy) return "SAM3 is generating a mask. Wait, then press R to add it before copying.";
    if (BT.prev || BT.points?.length) return "Press R to add the SAM3 preview before copying, or cancel it with Esc.";
    return "";
  }

  function decodeRle(counts, size) {
    const mask = new Uint8Array(size);
    let position = 0;
    let value = 0;
    for (const count of counts || []) {
      if (value) mask.fill(1, position, Math.min(size, position + count));
      position += count;
      value ^= 1;
      if (position >= size) break;
    }
    return mask;
  }

  function encodeRle(mask) {
    const counts = [];
    let value = 0;
    let run = 0;
    for (let index = 0; index < mask.length; index += 1) {
      if (mask[index] !== value) {
        counts.push(run);
        run = 0;
        value ^= 1;
      }
      run += 1;
    }
    counts.push(run);
    return counts;
  }

  function polygonsToMask(items, width, height) {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    context.fillStyle = "#fff";
    for (const item of items || []) {
      for (const polygon of item.poly || []) {
        if (polygon.length < 6) continue;
        context.beginPath();
        for (let index = 0; index < polygon.length; index += 2) {
          context[index ? "lineTo" : "moveTo"](polygon[index], polygon[index + 1]);
        }
        context.closePath();
        context.fill();
      }
    }
    const pixels = context.getImageData(0, 0, width, height).data;
    const mask = new Uint8Array(width * height);
    for (let index = 0; index < mask.length; index += 1) mask[index] = pixels[index * 4 + 3] > 127 ? 1 : 0;
    return mask;
  }

  async function getFrameMask(g, expectedGeneration) {
    if (S.gen !== expectedGeneration) throw new Error("The session has changed");
    const width = S.sess.src_w;
    const height = S.sess.src_h;
    const key = rvKey(g);
    const saved = S.ledits?.[key]?.seatbelt;
    if (saved) {
      const mask = new Uint8Array(width * height);
      for (const item of saved) {
        const decoded = decodeRle(item.rle?.counts, mask.length);
        for (let index = 0; index < mask.length; index += 1) if (decoded[index]) mask[index] = 1;
      }
      return mask;
    }

    const [segmentIndex, frameIndex] = loc(g);
    const autoLabel = await loadAutoLabel(segmentIndex);
    if (S.gen !== expectedGeneration) throw new Error("The session has changed");
    const frame = autoLabel?.frames?.[String(frameIndex)];
    return polygonsToMask(frame?.sam?.seatbelt || [], width, height);
  }

  async function saveFrameMask(g, mask, expectedGeneration) {
    const items = [{ rle: { size: [S.sess.src_h, S.sess.src_w], counts: encodeRle(mask) } }];
    const key = await postFrameLabelEdit(g, "seatbelt", items, expectedGeneration);
    try { if (typeof _beltCache !== "undefined") _beltCache.delete(key); } catch (_) {}
    if (frameState(g) === "todo") await saveFrameState(g, "seatbelt", "wip", expectedGeneration);
  }

  Object.assign(NL, {
    eyeLandmarkActive, eyeSelectionGeometry, eyeResizeAtEvent, eyeGroupAtEvent,
    onEyeGroupMouseDown, onEyeGroupMouseMove, onEyeTransformHover, onEyeGroupMouseUp,
    ensureEyeGroupDragging, drawEyeTransformBox, ensureEyeTransformDrawing, ensureEyePanelHint,
    cloneEyeItems, currentEyeItems, currentEyeClipContext, getFrameEyeItems, sameEyeItem,
    saveFrameEyeItems, eyeCenterX, mergeEyeLandmarks, manualPolygonAvailable,
    patchMatchesContext, ensureNativeEditing, prepareBeltRegionContext, validBeltRegion,
    rememberBeltRegion, captureSamPatch, ensurePolygonDrawing, drawManualPolygon,
    ensurePolygonTools, updatePolygonTools, discardManualPolygon, cancelManualMode,
    setManualMode, pointOnView, manualPolygonStageTarget, onManualMouseMove, polygonPatch,
    commitManualPolygon, onManualMouseDown, samAcceptAvailable, acceptSamPreview, undoSeatbelt,
    maskBulkBlockReason, decodeRle, encodeRle, polygonsToMask, getFrameMask, saveFrameMask
  });
})();
