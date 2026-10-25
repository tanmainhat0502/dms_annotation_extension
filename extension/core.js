(() => {
  "use strict";

  const NL = window.__notaOrganizerV1 = window.__notaOrganizerV1 || {};
  const bboxCountCache = (...args) => NL.bboxCountCache(...args);
  const bboxCountForFrame = (...args) => NL.bboxCountForFrame(...args);
  const scheduleBboxFilterRefresh = (...args) => NL.scheduleBboxFilterRefresh(...args);

  const VERSION = "1.6.47";

  const ROOT_ID = "nota-labeling-organizer-v1";

  const STYLE_ID = "nota-labeling-organizer-style-v1";

  const STORAGE_KEY = "nota-labeling-organizer-filter-v1";

  const BBOX_FILTER_KEY = "nota-labeling-organizer-bbox-filter-v2";

  const BBOX_FILTER_API = "__notaBboxFilterV1";

  const BBOX_COUNT_PARALLEL = 2;

  const BBOX_REFRESH_MS = 200;

  const STATUS_FILTER_KEY = "nota-labeling-organizer-status-filter-v1";

  const BULK_TAB_KEY = "nota-labeling-organizer-bulk-tab-v1";

  const FRAME_STATES = ["done", "wip", "todo"];

  const TIMELINE_LOCK_KEY = "nota-labeling-organizer-timeline-lock-v1";

  const ALLOWED_ORIGINS = new Set([
    "https://ntt.dev.nota.ai",
    "http://10.169.1.102:8765"
  ]);

  const GENERIC_COPY_LABELS = new Set([
    "body", "head", "face", "nose", "mouth", "eye", "hand",
    "cigarette", "e_cigarette", "phone", "can", "bottle", "face_mask", "face_lmk"
  ]);

  const BBOX_LABELS = new Set([
    "body", "head", "face", "nose", "mouth", "eye", "hand",
    "cigarette", "e_cigarette", "phone", "can", "bottle", "face_mask"
  ]);

  const OBJECT_BBOX_LABELS = new Set(["cigarette", "e_cigarette", "phone", "can", "bottle"]);

  // Every bbox label uses the same quick-edit, clipboard, marking, and undo flow.
  const QUICK_BBOX_LABELS = new Set(BBOX_LABELS);

  const BBOX_OVERLAP_IOU_THRESHOLD = 0.9;

  const BBOX_COPY_DUPLICATE_IOU_THRESHOLD = 0.75;

  const BBOX_COPY_MATCH_IOU_THRESHOLD = 0.5;

  const BBOX_COPY_MATCH_CONTAINMENT_THRESHOLD = 0.75;

  const BBOX_COPY_MATCH_SIZE_THRESHOLD = 0.4;

  const BBOX_COPY_MATCH_NARROW_AXIS_THRESHOLD = 0.25;

  const BBOX_COPY_MATCH_LONG_AXIS_THRESHOLD = 0.6;

  const state = {
    list: null,
    pane: null,
    toolbar: null,
    toolbarObserver: null,
    timeline: null,
    navigation: null,
    currentClip: null,
    partIndex: null,
    partStatusOperation: null,
    partScopes: new WeakMap(),
    clipScopes: new WeakMap(),
    clipStatusMenu: null,
    partStatusMenu: null,
    clipMenuTimer: 0,
    statusFilters: null,
    input: null,
    status: null,
    bboxInput: null,
    bboxAllButton: null,
    bboxWarnButton: null,
    doneAllButton: null,
    bboxStatus: null,
    bboxProgressWrap: null,
    bboxProgressText: null,
    bboxProgressPct: null,
    bboxProgress: null,
    bboxFilter: readStoredBboxFilter(),
    bboxWarnActive: false,
    bboxWarnApplied: false,
    bboxEditRevision: 0,
    bboxActive: false,
    bboxHiddenApplied: false,
    bboxRevision: 0,
    bboxCounts: null,
    bboxLoad: null,
    bboxRefreshTimer: 0,
    bboxEditingInstalled: false,
    empty: null,
    observer: null,
    scheduled: false,
    applying: false,
    openClips: new Set(),
    manuallyClosedClips: new Set(),
    operationBusy: false,
    statusOperationBusy: false,
    bulkDialog: null,
    bulkContext: null,
    bulkMode: null,
    bulkDirection: "after",
    bulkTab: readBulkTab(),
    bulkStatusContext: null,
    bulkStatusDirection: "after",
    bulkStatusValue: "wip",
    markedFrames: new Set(),
    markedScope: null,
    rangeStart: null,
    rangeRow: null,
    bboxMarkedFrames: new Set(),
    bboxMarkedScope: null,
    markedBadge: null,
    markedRows: new Map(),
    markedRowsMode: null,
    renderedRows: new WeakMap(),
    manualMode: null,
    lastPatch: null,
    polygonDrawingInstalled: false,
    nativeEditingInstalled: false,
    committingPolygon: false,
    samAcceptHeld: false,
    pointerPerformanceInstalled: false,
    pointerInsideView: false,
    pointerMoveEvent: false,
    pointerMagnifyFrame: 0,
    pointerHover: null,
    zoomPerformanceInstalled: false,
    zoomFrame: 0,
    zoomPending: null,
    sidebarRenderingInstalled: false,
    statusRenderingInstalled: false,
    organizedPlaybackInstalled: false,
    organizedPlaybackLoopInstalled: false,
    organizedPlaybackPainting: false,
    annotationReadyShowInstalled: false,
    annotationShowToken: 0,
    landmarkEditorScope: null,
    labelVisibilityInstalled: false,
    eyePanelHintInstalled: false,
    eyeGroupDraggingInstalled: false,
    eyeTransformDrawingInstalled: false,
    eyeGroupDrag: null,
    eyeBulkDialog: null,
    eyeBulkContext: null,
    eyeBulkDirection: "after",
    lastCreatedBox: null,
    bboxMode: null,
    bboxCreateDraft: null,
    bboxDeleteRegion: null,
    bboxClipboard: null,
    bboxUndo: [],
    eyeUndo: [],
    eyeUndoPending: null,
    eyeUndoSkipCapture: false,
    eyeUndoInstalled: false,
    eyeClipboard: null,
    eyeCopyRequest: null,
    bboxCopyRequest: null,
    bboxPointerCapture: null,
    quickLastOperation: null,
    bboxEdgePatch: null,
    renderingSidebar: false,
    sidebarRenderPosition: null,
    filterNavigation: null,
    sidebarScope: null,
    regionScope: null,
    regionFrame: null,
    frameRegions: new Map(),
    clipRegions: new Map(),
    filter: readStoredFilter()
  };

  function readStoredFilter() {
    try {
      return localStorage.getItem(STORAGE_KEY) || "";
    } catch (_) {
      return "";
    }
  }

  function readBulkTab() {
    try { return localStorage.getItem(BULK_TAB_KEY) === "status" ? "status" : "label"; }
    catch (_) { return "label"; }
  }

  function storeFilter(value) {
    try {
      localStorage.setItem(STORAGE_KEY, value);
    } catch (_) {
      // The organizer still works when local storage is unavailable.
    }
  }

  function readStoredBboxFilter() {
    try {
      const value = JSON.parse(localStorage.getItem(BBOX_FILTER_KEY) || "null");
      if (Array.isArray(value) && value.every((count) => Number.isSafeInteger(count) && count >= 0)) {
        return [...new Set(value)];
      }
    } catch (_) {}
    return [];
  }

  function storeBboxFilter() {
    try { localStorage.setItem(BBOX_FILTER_KEY, JSON.stringify(state.bboxFilter)); } catch (_) {}
  }

  // "2, 3;4" -> [2, 3, 4]; "" -> [] (all counts); malformed -> null.
  function parseBboxCounts(value) {
    const trimmed = value.trim().replace(/[\s,;]+$/, "");
    if (!trimmed) return value.trim() ? null : [];
    if (!/^\d+(?:[\s,;]+\d+)*$/.test(trimmed)) return null;
    const counts = [...new Set(trimmed.split(/[\s,;]+/).map(Number))];
    return counts.every(Number.isSafeInteger) ? counts : null;
  }

  function ensureTimelineLock() {
    const bar = document.getElementById("bar");
    if (!bar || !bar.parentElement || state.timeline?.bar === bar) return;
    const row = document.createElement("div");
    row.id = "nl-timeline-controls";
    const button = document.createElement("button");
    button.id = "nl-timeline-lock";
    button.type = "button";
    button.setAttribute("aria-label", "Timeline lock");
    button.setAttribute("aria-controls", "bar");
    button.innerHTML = `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none"
      stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <path class="nl-lock-shackle"/><rect x="5" y="10" width="14" height="11" rx="2"/>
      <path d="M12 14v3"/></svg>`;
    let locked = false;
    try { locked = localStorage.getItem(TIMELINE_LOCK_KEY) === "1"; } catch (_) {}
    const update = () => {
      button.setAttribute("aria-pressed", String(locked));
      button.title = locked
        ? "Timeline locked: click to unlock. A / D / Space still work."
        : "Timeline unlocked: click to lock and prevent accidental frame jumps.";
      button.querySelector(".nl-lock-shackle").setAttribute("d", locked
        ? "M7 10V7a5 5 0 0 1 10 0v3" : "M7 10V7a5 5 0 0 1 9.6-2");
      bar.classList.toggle("nl-timeline-locked", locked);
    };
    button.addEventListener("click", (event) => {
      locked = !locked;
      try { localStorage.setItem(TIMELINE_LOCK_KEY, locked ? "1" : "0"); } catch (_) {}
      update();
      // Return mouse users to the viewer shortcuts; preserve keyboard focus.
      if (event.detail > 0) button.blur();
    });
    button.addEventListener("keydown", (event) => {
      if (event.code === "Space" || event.code === "Enter") event.stopPropagation();
    });
    const blockSeek = (event) => {
      if (!locked) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    // Capture before the native canvas click handler. Block gesture starts,
    // but let global mouseup handlers finish an annotation drag over the bar.
    for (const type of ["click", "dblclick", "auxclick", "mousedown", "pointerdown", "touchstart", "dragstart"]) {
      bar.addEventListener(type, blockSeek, { capture: true, passive: false });
    }
    bar.before(row);
    row.append(bar, button);
    const syncVisibility = () => { row.hidden = bar.hidden; };
    const visibilityObserver = new MutationObserver(syncVisibility);
    visibilityObserver.observe(bar, { attributes: true, attributeFilter: ["hidden"] });
    // The button takes a small amount of width. Redraw at the new canvas size
    // on installation and whenever the viewer/sidebar width changes.
    let redrawFrame = 0;
    const sizeObserver = new ResizeObserver(() => {
      cancelAnimationFrame(redrawFrame);
      redrawFrame = requestAnimationFrame(() => {
        if (bar.isConnected && !row.hidden && typeof drawBar === "function") drawBar();
      });
    });
    sizeObserver.observe(bar);
    state.timeline = { bar, row, button, visibilityObserver, sizeObserver };
    update();
    syncVisibility();
  }

  function normalize(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .trim();
  }

  function isLabelingMode() {
    const title = document.getElementById("labTitle");
    if (!state.pane || !title) return false;
    const text = normalize(title.textContent);
    return text.startsWith("labeling") && getComputedStyle(state.pane).display !== "none";
  }

  function pageLabelingReady(label = null) {
    try {
      return isLabelingMode() && typeof S !== "undefined" && S.mode === "label" && !!S.sess &&
        (!label || S.labelSel === label);
    } catch (_) {
      return false;
    }
  }

  function quickBboxReady() {
    try {
      return QUICK_BBOX_LABELS.has(S.labelSel) && pageLabelingReady(S.labelSel);
    } catch (_) {
      return false;
    }
  }

  function anyBulkDialogOpen() {
    return Boolean(state.bulkDialog?.open || state.eyeBulkDialog?.open);
  }

  function currentLabelScope() {
    return { session: S.sess, generation: S.gen, label: S.labelSel };
  }

  function sessionLabelFrames() {
    const raw = S.review && typeof rvG === "function"
      ? Object.values(S.review).filter((item) => item.labels?.includes(S.labelSel)).map(rvG)
      : Array.from(S.lseq || []);
    return [...new Set(raw.filter((g) => Number.isInteger(g) && g >= 0))].sort((a, b) => a - b);
  }

  function partStatusMatches(operation) {
    return Boolean(operation && pageLabelingReady(operation.label) &&
      S.sess === operation.session && S.gen === operation.generation);
  }

  function frameSegment(g) {
    try { return loc(g)[0]; } catch (_) { return null; }
  }

  function bboxCountsPendingFor(frames) {
    if (!state.bboxActive) return false;
    const cache = bboxCountCache();
    if (state.bboxWarnActive && !cache.warningsReady) return true;
    if (!state.bboxLoad || state.bboxLoad.queue.length + state.bboxLoad.running <= 0) return false;
    return frames.some((g) => bboxCountForFrame(g, cache) === null);
  }

  function sliceBulkCandidates(candidates, rawInput, emptyMessage) {
    const raw = rawInput.trim().toLowerCase();
    if (raw !== "end" && !/^[1-9]\d*$/.test(raw)) {
      return { targets: [], error: "Enter a positive whole number or end." };
    }
    const targets = candidates.slice(0, raw === "end" ? candidates.length : Number(raw));
    return { targets, error: targets.length ? "" : emptyMessage };
  }

  function insertBeforeFrameName(li, element) {
    const name = li.querySelector(".name");
    if (name) name.before(element);
    else li.prepend(element);
  }

  function clearEditorSelection() {
    if (typeof edClearSel === "function") edClearSel();
    else if (typeof ED !== "undefined") { ED.sel = -1; ED.selSet?.clear(); }
  }

  function singleSelectedEditorIndex() {
    const indexes = typeof edSelected === "function" ? edSelected() :
      ED.selSet?.size ? Array.from(ED.selSet) : Number.isInteger(ED.sel) && ED.sel >= 0 ? [ED.sel] : [];
    return indexes.length === 1 ? Number(indexes[0]) : -1;
  }

  function drawCanvasPolygonOverlay(points, showRubberBand, scale, strokeColor, fillColor) {
    const canvas = document.getElementById("view");
    const unit = typeof pxK === "function" ? pxK() : canvas.width / canvas.getBoundingClientRect().width;
    ctx.save();
    ctx.setLineDash([]);
    ctx.strokeStyle = strokeColor;
    ctx.fillStyle = fillColor;
    ctx.lineWidth = 2 * unit;
    ctx.beginPath();
    points.forEach(([x, y], index) => ctx[index ? "lineTo" : "moveTo"](x * scale, y * scale));
    if (points.length >= 3) {
      ctx.closePath();
      ctx.fill();
    }
    ctx.stroke();
    if (showRubberBand && typeof ED !== "undefined" && ED.mouse) {
      const [x, y] = points[points.length - 1];
      ctx.setLineDash([4 * unit, 4 * unit]);
      ctx.beginPath();
      ctx.moveTo(x * scale, y * scale);
      ctx.lineTo(ED.mouse[0], ED.mouse[1]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    for (const [x, y] of points) {
      ctx.beginPath();
      ctx.arc(x * scale, y * scale, 3.5 * unit, 0, Math.PI * 2);
      ctx.fillStyle = strokeColor;
      ctx.fill();
    }
    ctx.restore();
  }

  function pointerGestureActive() {
    try {
      return Boolean(state.manualMode || state.bboxMode || state.eyeGroupDrag ||
        (typeof VZ !== "undefined" && VZ.pan) ||
        (typeof ED !== "undefined" && (ED.drag || ED.marq || ED.poly?.length)) ||
        (typeof BT !== "undefined" && (BT.drag || BT.poly?.length)) ||
        (typeof LM !== "undefined" && (LM.drag || LM.marq || LM.poly?.length)));
    } catch (_) {
      return false;
    }
  }

  function pointerHoverSignature() {
    try {
      if (typeof beltActive === "function" && beltActive() && typeof BT !== "undefined") return `belt:${BT.hov ?? -1}`;
      if (typeof ED !== "undefined" && ED.hover) return `box:${ED.hover.n}:${ED.hover.corner}`;
    } catch (_) {}
    return "none";
  }

  function useNativePointerCursor() {
    const canvas = document.getElementById("view");
    if (!canvas || !isLabelingMode() || pointerGestureActive()) return;
    try {
      if (typeof beltActive === "function" && beltActive() && typeof BT !== "undefined" && BT.hov >= 0) {
        const cursors = ["nwse-resize", "nesw-resize", "nesw-resize", "nwse-resize",
          "ns-resize", "ns-resize", "ew-resize", "ew-resize"];
        canvas.style.cursor = cursors[BT.hov] || "crosshair";
        return;
      }
    } catch (_) {}
    if (canvas.style.cursor === "none" || !canvas.style.cursor) canvas.style.cursor = "crosshair";
  }

  function schedulePointerMagnifier() {
    if (state.pointerMagnifyFrame) return;
    state.pointerMagnifyFrame = requestAnimationFrame(() => {
      state.pointerMagnifyFrame = 0;
      try { if (state.pointerInsideView && typeof edMagnify === "function") edMagnify(); } catch (_) {}
    });
  }

  function ensurePointerPerformance() {
    if (state.pointerPerformanceInstalled || typeof paint !== "function" || typeof edRepaint !== "function") return;
    const canvas = document.getElementById("view");
    if (!canvas) return;
    const nativePaint = paint;
    const nativeRepaint = edRepaint;

    try {
      paint = function (...args) {
        const passivePointer = state.pointerInsideView && isLabelingMode() &&
          !pointerGestureActive() && typeof ED !== "undefined";
        if (!passivePointer) return nativePaint.apply(this, args);
        const mouse = ED.mouse;
        ED.mouse = null;
        let result;
        try {
          result = nativePaint.apply(this, args);
        } finally {
          ED.mouse = mouse;
        }
        try { if (mouse && typeof edMagnify === "function") edMagnify(); } catch (_) {}
        useNativePointerCursor();
        return result;
      };
      edRepaint = function (...args) {
        if (state.pointerMoveEvent && state.pointerInsideView && isLabelingMode() && !pointerGestureActive()) {
          const hover = pointerHoverSignature();
          const hoverChanged = hover !== state.pointerHover;
          state.pointerHover = hover;
          useNativePointerCursor();
          schedulePointerMagnifier();
          if (!hoverChanged) return;
        }
        return nativeRepaint.apply(this, args);
      };
    } catch (_) {
      return;
    }

    window.addEventListener("mousemove", (event) => {
      if (event.target !== canvas) return;
      state.pointerInsideView = true;
      state.pointerMoveEvent = true;
      setTimeout(() => { state.pointerMoveEvent = false; }, 0);
    }, true);
    canvas.addEventListener("mouseenter", () => {
      state.pointerInsideView = true;
      state.pointerHover = null;
      useNativePointerCursor();
    }, true);
    window.addEventListener("mouseleave", (event) => {
      if (event.target !== canvas) return;
      state.pointerInsideView = false;
      state.pointerMoveEvent = false;
      state.pointerHover = null;
    }, true);
    state.pointerPerformanceInstalled = true;
  }

  function ensureZoomPerformance() {
    if (state.zoomPerformanceInstalled || typeof paint !== "function" || typeof VZ === "undefined") return;
    const stage = document.getElementById("stage");
    const canvas = document.getElementById("view");
    if (!stage || !canvas) return;

    window.addEventListener("wheel", (event) => {
      if (!isLabelingMode() || !stage.contains(event.target) || !event.deltaY) return;
      try {
        if (typeof S === "undefined" || !S.sess) return;
      } catch (_) {
        return;
      }

      // The original page transforms the image for every wheel event, while
      // masks and boxes are painted on a separate canvas on the next frame.
      // Coalesce rapid wheel events so both layers change in the same frame.
      event.preventDefault();
      event.stopImmediatePropagation();

      let pending = state.zoomPending;
      if (!pending || pending.canvas !== canvas || !canvas.isConnected) {
        const rect = canvas.getBoundingClientRect();
        pending = {
          canvas,
          baseLeft: rect.left - (Number(VZ.tx) || 0),
          baseTop: rect.top - (Number(VZ.ty) || 0),
          z: Number(VZ.z) || 1,
          tx: Number(VZ.tx) || 0,
          ty: Number(VZ.ty) || 0
        };
      }

      const unitX = (event.clientX - pending.baseLeft - pending.tx) / pending.z;
      const unitY = (event.clientY - pending.baseTop - pending.ty) / pending.z;
      const nextZoom = Math.max(1, Math.min(8, pending.z * (event.deltaY < 0 ? 1.2 : 1 / 1.2)));
      pending.tx = event.clientX - pending.baseLeft - nextZoom * unitX;
      pending.ty = event.clientY - pending.baseTop - nextZoom * unitY;
      pending.z = nextZoom;
      if (nextZoom === 1) pending.tx = pending.ty = 0;
      state.zoomPending = pending;

      if (state.zoomFrame) return;
      state.zoomFrame = requestAnimationFrame(() => {
        state.zoomFrame = 0;
        const update = state.zoomPending;
        state.zoomPending = null;
        if (!update || !update.canvas.isConnected) return;

        VZ.z = update.z;
        VZ.tx = update.tx;
        VZ.ty = update.ty;
        update.canvas.style.transformOrigin = "0 0";
        update.canvas.style.transform = update.z === 1 && !update.tx && !update.ty
          ? ""
          : `translate(${update.tx}px, ${update.ty}px) scale(${update.z})`;

        // Paint synchronously inside this animation frame. Calling edRepaint
        // here would defer the overlay once more and recreate the short flash.
        try { paint(); } catch (_) {
          try { if (typeof edRepaint === "function") edRepaint(); } catch (_) {}
        }
        try { if (typeof lsTouch === "function") lsTouch(); } catch (_) {}
      });
    }, { capture: true, passive: false });

    state.zoomPerformanceInstalled = true;
  }

  function frameState(g) {
    try {
      if (typeof fsGet === "function") return fsGet(g);
    } catch (_) {}
    const li = state.list?.querySelector(`li[data-g="${g}"]`);
    const fs = li?.querySelector(".fs");
    return fs?.classList.contains("done") ? "done" : fs?.classList.contains("wip") ? "wip" : "todo";
  }

  function statusIcon(value) {
    try { if (typeof FS_ICON !== "undefined" && FS_ICON[value]) return FS_ICON[value]; } catch (_) {}
    return value === "done" ? "●" : value === "wip" ? "◐" : "○";
  }

  function statusName(value) {
    try { if (typeof FS_NAME !== "undefined" && FS_NAME[value]) return FS_NAME[value]; } catch (_) {}
    return value === "done" ? "Done" : value === "wip" ? "In progress" : "Not checked";
  }

  function notify(message) {
    try {
      if (typeof flash === "function") {
        flash(message);
        return;
      }
    } catch (_) {}
    console.info(`[NOTA Labeling Organizer] ${message}`);
  }

  async function requestJson(url, options) {
    const response = await fetch(url, options);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.detail || response.statusText || `HTTP ${response.status}`);
    return data;
  }

  async function runQueue(items, worker, onProgress, concurrency = 4) {
    let cursor = 0;
    let completed = 0;
    let firstError = null;

    async function consume() {
      while (!firstError) {
        const index = cursor;
        cursor += 1;
        if (index >= items.length) return;
        try {
          await worker(items[index], index);
          completed += 1;
          if (onProgress) onProgress(completed, items.length);
        } catch (error) {
          firstError = error;
        }
      }
    }

    await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, consume));
    return { completed, error: firstError };
  }

  function updateFrameState(g, label, value, responseData) {
    state.bboxRevision += 1;
    const key = typeof rvKey === "function" ? rvKey(g) : null;
    if (!key) return;
    if (responseData?.item && responseData.key) {
      S.fstat[responseData.key] = responseData.item;
      return;
    }
    const frame = (S.fstat[key] = S.fstat[key] || {});
    if (value === "todo") delete frame[label];
    else frame[label] = { s: value };
  }

  async function saveFrameState(g, label, value, expectedGeneration, expectedSession = S.sess) {
    if (S.gen !== expectedGeneration || S.sess !== expectedSession) throw new Error("The session has changed");
    const [segmentIndex, frameIndex] = loc(g);
    const segment = S.sess.segments[segmentIndex];
    const data = await requestJson("/api/frame_status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        bucket: S.sess.bucket,
        prefix: segPfx(segmentIndex),
        seg: segment.name,
        i: frameIndex,
        label,
        state: value
      })
    });
    if (S.gen !== expectedGeneration || S.sess !== expectedSession) throw new Error("The session has changed");
    updateFrameState(g, label, value, data);
  }

  async function loadAutoLabel(segmentIndex) {
    let data = S.al.get(segmentIndex);
    if (data instanceof Promise) {
      await data;
      data = S.al.get(segmentIndex);
    } else if (data === undefined && typeof ensureAL === "function") {
      const loading = ensureAL(segmentIndex);
      if (loading instanceof Promise) await loading;
      data = S.al.get(segmentIndex);
    }
    return data && !(data instanceof Promise) ? data : null;
  }

  async function postFrameLabelEdit(g, label, items, expectedGeneration) {
    if (S.gen !== expectedGeneration) throw new Error("The session has changed");
    const [segmentIndex, frameIndex] = loc(g);
    const segment = S.sess.segments[segmentIndex];
    const key = rvKey(g);
    await requestJson("/api/label_edit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        bucket: S.sess.bucket,
        prefix: segPfx(segmentIndex),
        seg: segment.name,
        i: frameIndex,
        t: Math.round(S.ts?.[g] || 0),
        label,
        items
      })
    });
    if (S.gen !== expectedGeneration) throw new Error("The session has changed");
    (S.ledits[key] = S.ledits[key] || {})[label] = items;
    state.bboxEditRevision += 1;
    return key;
  }

  function readCurrentEditorOrSavedItems(label, cloneFn) {
    if (!pageLabelingReady(label)) return [];
    try {
      const key = rvKey(S.shownG);
      if (typeof ED !== "undefined" && ED.key === key && ED.lab === label && Array.isArray(ED.items)) {
        return cloneFn(ED.items);
      }
      const saved = S.ledits?.[key]?.[label];
      if (saved) return cloneFn(saved);
      const [segmentIndex, frameIndex] = loc(S.shownG);
      const data = S.al.get(segmentIndex);
      const frame = data && !(data instanceof Promise) ? data.frames?.[String(frameIndex)] : null;
      return frame && typeof alBoxes === "function" ? cloneFn(alBoxes(frame, label)) : [];
    } catch (_) {
      return [];
    }
  }

  async function readFrameAutoOrSavedItems(g, label, expectedGeneration, cloneFn) {
    if (S.gen !== expectedGeneration) throw new Error("The session has changed");
    const key = rvKey(g);
    const saved = S.ledits?.[key]?.[label];
    if (saved) return cloneFn(saved);
    const [segmentIndex, frameIndex] = loc(g);
    const autoLabel = await loadAutoLabel(segmentIndex);
    if (S.gen !== expectedGeneration) throw new Error("The session has changed");
    const frame = autoLabel?.frames?.[String(frameIndex)];
    return frame && typeof alBoxes === "function" ? cloneFn(alBoxes(frame, label)) : [];
  }

  function cloneGenericItems(items) {
    return (items || []).map((item) => {
      if (Array.isArray(item?.box) && item.box.length === 4) {
        return { box: item.box.map(Number), ...(item.cls ? { cls: item.cls } : {}) };
      }
      if (Array.isArray(item?.pts)) {
        return {
          pts: item.pts.map((point) => Array.isArray(point) && point.length >= 2
            ? [Number(point[0]), Number(point[1])]
            : null),
          ...(item.closed ? { closed: true } : {})
        };
      }
      return null;
    }).filter(Boolean);
  }

  function genericLabelName(label) {
    try {
      if (typeof RV_NAME !== "undefined" && RV_NAME[label]) return RV_NAME[label];
    } catch (_) {}
    return label === "face_mask" ? "mask" : label === "face_lmk" ? "face 7pt" : label;
  }

  function currentGenericItems(label) {
    if (!GENERIC_COPY_LABELS.has(label)) return [];
    return readCurrentEditorOrSavedItems(label, cloneGenericItems);
  }

  async function getFrameGenericItems(g, label, expectedGeneration) {
    return readFrameAutoOrSavedItems(g, label, expectedGeneration, cloneGenericItems);
  }

  async function saveFrameGenericItems(g, label, items, expectedGeneration) {
    const round = (value) => Math.round(Number(value) * 10) / 10;
    const savedItems = cloneGenericItems(items).map((item) => item.pts
      ? {
          pts: item.pts.map((point) => point ? [round(point[0]), round(point[1])] : null),
          ...(item.closed ? { closed: true } : {})
        }
      : { box: item.box.map(round), ...(item.cls ? { cls: item.cls } : {}) });
    await postFrameLabelEdit(g, label, savedItems, expectedGeneration);
    scheduleBboxFilterRefresh();
    if (frameState(g) === "todo") await saveFrameState(g, label, "wip", expectedGeneration);
  }

  function sameGenericItem(left, right) {
    const a = cloneGenericItems([left])[0];
    const b = cloneGenericItems([right])[0];
    return !!a && !!b && JSON.stringify(a) === JSON.stringify(b);
  }

  function parseBoxBounds(box) {
    if (!Array.isArray(box) || box.length < 4) return null;
    const [x1, y1, x2, y2] = box.slice(0, 4).map(Number);
    if (![x1, y1, x2, y2].every(Number.isFinite)) return null;
    return [Math.min(x1, x2), Math.min(y1, y2), Math.max(x1, x2), Math.max(y1, y2)];
  }

  function bboxOverlapMetrics(left, right) {
    const a = parseBoxBounds(left);
    const b = parseBoxBounds(right);
    if (!a || !b) return null;
    const widthA = a[2] - a[0];
    const heightA = a[3] - a[1];
    const widthB = b[2] - b[0];
    const heightB = b[3] - b[1];
    const intersection = Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])) *
      Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
    return { widthA, heightA, widthB, heightB, areaA: widthA * heightA, areaB: widthB * heightB, intersection };
  }

  function bboxIntersectionOverUnion(left, right) {
    const metrics = bboxOverlapMetrics(left, right);
    if (!metrics) return 0;
    const union = metrics.areaA + metrics.areaB - metrics.intersection;
    return union > 0 ? metrics.intersection / union : 0;
  }

  function bboxIntersectionOverSmaller(left, right) {
    const metrics = bboxOverlapMetrics(left, right);
    if (!metrics) return 0;
    const smallerArea = Math.min(metrics.areaA, metrics.areaB);
    return smallerArea > 0 ? metrics.intersection / smallerArea : 0;
  }

  function clampBboxEdgeCoord(box, coord, width, height) {
    if (coord === 0) box[0] = Math.max(0, Math.min(box[2] - 1, box[0]));
    else if (coord === 1) box[1] = Math.max(0, Math.min(box[3] - 1, box[1]));
    else if (coord === 2) box[2] = Math.min(width, Math.max(box[0] + 1, box[2]));
    else if (coord === 3) box[3] = Math.min(height, Math.max(box[1] + 1, box[3]));
  }

  Object.assign(NL, {
    VERSION, ROOT_ID, STYLE_ID, STORAGE_KEY, BBOX_FILTER_KEY, BBOX_FILTER_API,
    BBOX_COUNT_PARALLEL, BBOX_REFRESH_MS, STATUS_FILTER_KEY, BULK_TAB_KEY, FRAME_STATES,
    TIMELINE_LOCK_KEY, ALLOWED_ORIGINS, GENERIC_COPY_LABELS, BBOX_LABELS, OBJECT_BBOX_LABELS,
    QUICK_BBOX_LABELS, BBOX_OVERLAP_IOU_THRESHOLD, BBOX_COPY_DUPLICATE_IOU_THRESHOLD,
    BBOX_COPY_MATCH_IOU_THRESHOLD, BBOX_COPY_MATCH_CONTAINMENT_THRESHOLD,
    BBOX_COPY_MATCH_SIZE_THRESHOLD, BBOX_COPY_MATCH_NARROW_AXIS_THRESHOLD,
    BBOX_COPY_MATCH_LONG_AXIS_THRESHOLD, state, readStoredFilter, readBulkTab, storeFilter,
    readStoredBboxFilter, storeBboxFilter, parseBboxCounts, ensureTimelineLock, normalize,
    isLabelingMode, pageLabelingReady, quickBboxReady, anyBulkDialogOpen, currentLabelScope,
    sessionLabelFrames, partStatusMatches, frameSegment, bboxCountsPendingFor, sliceBulkCandidates,
    insertBeforeFrameName, clearEditorSelection, singleSelectedEditorIndex,
    drawCanvasPolygonOverlay, pointerGestureActive, pointerHoverSignature,
    useNativePointerCursor, schedulePointerMagnifier, ensurePointerPerformance,
    ensureZoomPerformance, frameState, statusIcon, statusName, notify, requestJson, runQueue,
    updateFrameState, saveFrameState, loadAutoLabel, postFrameLabelEdit,
    readCurrentEditorOrSavedItems, readFrameAutoOrSavedItems, cloneGenericItems,
    genericLabelName, currentGenericItems, getFrameGenericItems, saveFrameGenericItems,
    sameGenericItem, parseBoxBounds, bboxOverlapMetrics, bboxIntersectionOverUnion,
    bboxIntersectionOverSmaller, clampBboxEdgeCoord
  });
})();
