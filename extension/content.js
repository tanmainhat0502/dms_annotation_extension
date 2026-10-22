(() => {
  "use strict";

  const VERSION = "1.6.35";
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
  const QUICK_BBOX_LABELS = new Set(["body", "hand", "eye"]);
  const BBOX_OVERLAP_IOU_THRESHOLD = 0.9;
  const BBOX_COPY_DUPLICATE_IOU_THRESHOLD = 0.75;
  const BBOX_COPY_MATCH_IOU_THRESHOLD = 0.5;
  const BBOX_COPY_MATCH_CONTAINMENT_THRESHOLD = 0.75;
  const BBOX_COPY_MATCH_SIZE_THRESHOLD = 0.4;
  const BBOX_COPY_MATCH_NARROW_AXIS_THRESHOLD = 0.25;
  const BBOX_COPY_MATCH_LONG_AXIS_THRESHOLD = 0.6;

  if (!ALLOWED_ORIGINS.has(location.origin) || document.getElementById(ROOT_ID)) return;

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
    clipMenuTimer: 0,
    statusFilters: null,
    input: null,
    status: null,
    bboxInput: null,
    bboxAllButton: null,
    bboxStatus: null,
    bboxFilter: readStoredBboxFilter(),
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
    bboxMarkedFrames: new Set(),
    bboxMarkedScope: null,
    markedBadge: null,
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
    bboxCopyRequest: null,
    bboxPointerCapture: null,
    quickLastOperation: null,
    bboxEdgePatch: null,
    renderingSidebar: false,
    sidebarRenderPosition: null,
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

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      #nl-status-filters { display: flex; flex-wrap: wrap; gap: 5px 10px; margin-top: 6px; }
      #nl-status-filters label { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; cursor: pointer; }
      #nl-status-filters input { margin: 0; accent-color: #55aaff; }
      #nl-clip-status-menu {
        position: fixed; z-index: 10000; width: 205px; max-width: calc(100vw - 16px);
        box-sizing: border-box; padding: 6px; border: 1px solid #596273; border-radius: 5px;
        background: #202630; color: #dce4ee; font: 12px/1.4 "Segoe UI", sans-serif;
        box-shadow: 0 4px 16px #0008;
      }
      #nl-clip-status-menu .nl-menu-title { padding: 3px 5px 6px; color: #aeb9c8; }
      #nl-clip-status-menu button {
        display: block; width: 100%; padding: 7px; text-align: left; font: inherit;
        color: inherit; background: transparent; border: 0; border-radius: 3px; cursor: pointer;
      }
      #nl-clip-status-menu button:hover, #nl-clip-status-menu button:focus-visible { background: #354355; }
      #nl-timeline-controls {
        display: flex; align-items: center; gap: 6px;
        flex: none; min-width: 0; height: 44px;
      }
      #nl-timeline-controls[hidden] { display: none !important; }
      #nl-timeline-controls > #bar { flex: 1 1 0; width: 0; min-width: 0; height: 44px; }
      #bar.nl-timeline-locked { cursor: not-allowed; touch-action: none; }
      #nl-timeline-lock {
        display: inline-flex; align-items: center; justify-content: center;
        flex: 0 0 32px; width: 32px; height: 32px; box-sizing: border-box; padding: 4px;
        border: 1px solid var(--line, #353b45); border-radius: 4px;
        background: var(--panel, #1d2128); color: var(--dim, #aab2bf); cursor: pointer;
      }
      #nl-timeline-lock:hover { border-color: var(--accent, #69b8ff); }
      #nl-timeline-lock:focus-visible { outline: 2px solid var(--accent, #69b8ff); outline-offset: 2px; }
      #nl-timeline-lock[aria-pressed="true"] { color: #ffd278; border-color: #a98136; background: #352d1e; }
      #${ROOT_ID} {
        display: flex;
        flex-wrap: wrap;
        flex-shrink: 0;
        align-items: center;
        gap: 6px;
        padding: 8px 6px;
        border-bottom: 1px solid var(--line, #353b45);
        background: var(--panel, #1d2128);
        position: sticky;
        top: 0;
        z-index: 4;
      }
      #${ROOT_ID}[hidden] { display: none !important; }
      #${ROOT_ID} .nl-search-wrap {
        position: relative;
        flex: 1;
        min-width: 0;
      }
      #${ROOT_ID} .nl-search {
        box-sizing: border-box;
        width: 100%;
        height: 32px;
        padding: 5px 30px 5px 9px;
        border: 1px solid #606978;
        border-radius: 5px;
        background: #11141a;
        color: #f4f6fa;
        font: inherit;
        outline: none;
      }
      #${ROOT_ID} .nl-search:focus {
        border-color: #55aaff;
        box-shadow: 0 0 0 2px rgba(85, 170, 255, .2);
      }
      #${ROOT_ID} .nl-clear {
        position: absolute;
        right: 3px;
        top: 3px;
        width: 26px;
        height: 26px;
        border: 0;
        border-radius: 4px;
        color: #c9d1dc;
        background: transparent;
        cursor: pointer;
        font-size: 17px;
        line-height: 24px;
      }
      #${ROOT_ID} .nl-clear:hover { background: #303641; color: #fff; }
      #${ROOT_ID} .nl-status {
        flex: none;
        min-width: 46px;
        color: #aeb9c8;
        font-size: 11px;
        text-align: right;
        white-space: nowrap;
      }
      #${ROOT_ID} .nl-bbox-controls {
        display: flex;
        align-items: center;
        gap: 5px;
        flex: 0 0 100%;
        min-width: 0;
        font-size: 11px;
        color: #cbd5e1;
      }
      #${ROOT_ID} .nl-bbox-controls input {
        box-sizing: border-box;
        width: 94px;
        height: 27px;
        padding: 3px 5px;
        border: 1px solid #606978;
        border-radius: 4px;
        background: #11141a;
        color: #f4f6fa;
        font: inherit;
      }
      #${ROOT_ID} .nl-bbox-controls input[aria-invalid="true"] { border-color: #ff6b78; }
      #${ROOT_ID} .nl-bbox-all {
        flex: none;
        height: 27px;
        padding: 3px 6px;
        border: 1px solid #606978;
        border-radius: 4px;
        background: #242a33;
        color: #dce4ee;
        font: inherit;
        cursor: pointer;
      }
      #${ROOT_ID} .nl-bbox-all[aria-pressed="true"] { border-color: #55aaff; color: #d9f3ff; background: #17384c; }
      #${ROOT_ID} .nl-bbox-controls :disabled { opacity: .5; cursor: default; }
      #${ROOT_ID} .nl-bbox-status {
        flex: 1;
        min-width: 0;
        text-align: right;
        color: #aeb9c8;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      #labList .nl-clip[hidden], #labList li[data-g][hidden] { display: none !important; }
      #labList .nl-organized > .nl-clips {
        flex: 1;
        min-width: 0;
      }
      #labList .nl-organized > .vlab {
        position: relative;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: flex-start;
        writing-mode: horizontal-tb;
      }
      #labList .nl-part-name { writing-mode: vertical-rl; text-orientation: upright; }
      #labList .nl-part-tools {
        position: sticky;
        top: calc(var(--nl-toolbar-height, 0px) + 4px);
        z-index: 2;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 6px;
        margin-top: 7px;
        background: #23272e;
        border-radius: 4px;
        letter-spacing: 0;
      }
      #labList .nl-part-total {
        display: inline-flex;
        align-items: center;
        padding: 5px 2px;
        border: 1px solid #397a9f;
        border-radius: 4px;
        color: #d9f3ff;
        background: #17384c;
        font-size: 10px;
        font-weight: 750;
        line-height: 1;
        white-space: nowrap;
        writing-mode: vertical-rl;
      }
      #labList .nl-part-done-label {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 4px;
        padding: 4px 1px;
        color: #8cffaa;
        font-size: 10px;
        line-height: 1.1;
        cursor: pointer;
      }
      #labList .nl-part-done-label > span { writing-mode: vertical-rl; text-orientation: mixed; }
      #labList .nl-part-done { width: 16px; height: 16px; margin: 0; accent-color: #39b767; cursor: pointer; }
      #labList .nl-part-done:disabled { cursor: progress; }
      #labList .nl-part-tools[aria-busy="true"] { opacity: .7; }
      #labList > .grp[hidden] { display: none !important; }
      #labList .nl-clip {
        border-bottom: 1px solid rgba(255,255,255,.06);
      }
      #labList .nl-clip:last-child { border-bottom: 0; }
      #labList .nl-clip > summary {
        position: sticky;
        top: var(--nl-toolbar-height, 0px);
        z-index: 3;
        scroll-margin-top: var(--nl-toolbar-height, 0px);
        display: flex;
        align-items: center;
        gap: 7px;
        min-height: 30px;
        padding: 4px 7px;
        box-sizing: border-box;
        cursor: pointer;
        user-select: none;
        color: #f1f5f9;
        background: #222832;
        list-style: none;
      }
      #labList .nl-clip li[data-g] {
        scroll-margin-top: calc(var(--nl-toolbar-height, 0px) + 36px);
      }
      #labList .nl-clip > summary::-webkit-details-marker { display: none; }
      #labList .nl-clip > summary::before {
        content: "▶";
        width: 10px;
        flex: none;
        color: #65b5ff;
        font-size: 9px;
        transition: transform .12s ease;
      }
      #labList .nl-clip[open] > summary::before { transform: rotate(90deg); }
      #labList .nl-clip > summary:hover { background: #2a313d; }
      #labList .nl-clip.nl-current > summary {
        background: #29384a;
        box-shadow: inset 3px 0 0 #55aaff;
      }
      #labList .nl-clip-no {
        min-width: 30px;
        color: #fff;
      }
      #labList .nl-clip-meta {
        flex: 1;
        min-width: 0;
        color: #aeb9c8;
        font-size: 11px;
        text-align: right;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      #labList .nl-clip-status-actions {
        display: inline-flex;
        align-items: center;
        gap: 3px;
        flex: none;
      }
      #labList .nl-clip-status-actions button {
        min-height: 24px;
        padding: 2px 5px;
        border: 1px solid #596273;
        border-radius: 4px;
        background: #202630;
        color: #dce4ee;
        font: inherit;
        font-size: 9px;
        font-weight: 650;
        line-height: 1.1;
        white-space: nowrap;
        cursor: pointer;
      }
      #labList .nl-clip-status-actions button:hover:not(:disabled) { background: #303947; }
      #labList .nl-clip-status-actions button[data-state="done"] { border-color: #318f50; color: #8cffaa; }
      #labList .nl-clip-status-actions button[data-state="todo"] { border-color: #788394; color: #d9e0e8; }
      #labList .nl-clip-status-actions button[data-state="wip"] { border-color: #bd7b20; color: #ffc86f; }
      #labList .nl-clip-status-actions button.current { box-shadow: inset 0 0 0 1px currentColor; background: #303947; }
      #labList .nl-clip-status-actions button:disabled { opacity: .42; cursor: default; }
      #labList .nl-clip-status-actions[aria-busy="true"] { opacity: .62; }
      #labList .nl-checkpoint {
        flex: none;
        color: #ffd166;
        font-size: 11px;
        line-height: 1;
      }
      #labList li.nl-marked-frame {
        box-shadow: inset 3px 0 0 #bd76ee;
        background: rgba(116, 64, 161, .28);
      }
      #labList .nl-frame-mark {
        flex: none;
        color: #e3b6ff;
        font-size: 10px;
        font-weight: 700;
      }
      #labList .nl-clip > ul { width: 100%; }
      #labList .nl-empty-filter {
        margin: 10px 7px;
        padding: 10px;
        border: 1px dashed #596273;
        border-radius: 5px;
        color: #bac3cf;
        text-align: center;
        font-size: 12px;
      }
      body.sideMin #${ROOT_ID} { display: none !important; }
      body.sideMin #labList .nl-clip > summary { padding: 3px 4px; min-height: 25px; }
      body.sideMin #labList .nl-clip-meta { display: none; }
      body.sideMin #labList .nl-clip-status-actions { display: none; }

      #nl-polygon-tools {
        margin: 8px 0;
        padding: 7px;
        border: 1px solid #596273;
        border-radius: 5px;
        background: #171b22;
      }
      #nl-polygon-tools .nl-poly-buttons { display: grid; grid-template-columns: 1fr 1fr; gap: 5px; }
      #nl-polygon-tools button {
        padding: 6px 5px;
        border: 1px solid #596273;
        border-radius: 4px;
        color: #dce4ee;
        background: #202630;
        cursor: pointer;
        font-size: 11px;
      }
      #nl-polygon-tools button.on {
        border-color: #b56cff;
        color: #fff;
        background: #543074;
      }
      #nl-polygon-tools button[data-poly="subtract"] { color: #ff9ba4; border-color: #98515a; }
      #nl-polygon-tools button[data-poly="subtract"].on { color: #fff; border-color: #ff4d5a; background: #782b35; }
      #nl-polygon-tools .nl-poly-help { margin-top: 5px; color: #aeb9c8; font-size: 10px; line-height: 1.35; }

      .nl-bulk-dialog {
        width: min(520px, calc(100vw - 28px));
        padding: 0;
        border: 1px solid #8751b3;
        border-radius: 10px;
        color: #f1f3f7;
        background: #1c1e25;
        box-shadow: 0 20px 70px rgba(0,0,0,.55);
      }
      .nl-bulk-dialog::backdrop { background: rgba(0,0,0,.68); }
      .nl-bulk-dialog .nl-modal { padding: 20px; }
      .nl-bulk-dialog .nl-bulk-tabs { margin-bottom: 16px; }
      .nl-bulk-dialog .nl-label-panel[hidden], .nl-bulk-dialog .nl-status-panel[hidden] { display: none !important; }
      .nl-bulk-dialog h2 { margin: 0 0 5px; font-size: 20px; }
      .nl-bulk-dialog .nl-sub { margin: 0 0 15px; color: #c1c8d2; font-size: 13px; }
      .nl-bulk-dialog .nl-label { display: block; margin: 12px 0 6px; color: #e7eaf0; font-size: 13px; }
      .nl-bulk-dialog .nl-choice { display: grid; grid-template-columns: 1fr 1fr; gap: 7px; }
      .nl-bulk-dialog .nl-choice button,
      .nl-bulk-dialog .nl-actions button {
        min-height: 38px;
        border: 1px solid #596273;
        border-radius: 6px;
        color: #e9edf3;
        background: #171a20;
        cursor: pointer;
        font-weight: 600;
      }
      .nl-bulk-dialog .nl-choice button.on,
      .nl-bulk-dialog .nl-actions .primary { border-color: #bd76ee; background: #7440a1; color: #fff; }
      .nl-bulk-dialog .nl-scope { display: grid; gap: 6px; padding: 9px; border: 1px solid #414754; border-radius: 6px; }
      .nl-bulk-dialog .nl-scope[hidden], .nl-bulk-dialog .nl-label[hidden],
      .nl-bulk-dialog .nl-choice button[hidden] { display: none !important; }
      .nl-bulk-dialog .nl-scope label { display: flex; gap: 7px; align-items: flex-start; font-size: 12px; }
      .nl-bulk-dialog .nl-scope label[hidden] { display: none !important; }
      .nl-bulk-dialog .nl-mask-only[hidden] { display: none !important; }
      .nl-bulk-dialog .nl-count, .nl-bulk-dialog .nl-status-count {
        box-sizing: border-box;
        width: 100%;
        height: 40px;
        padding: 7px 10px;
        border: 1px solid #687181;
        border-radius: 6px;
        color: #fff;
        background: #101319;
        font: inherit;
      }
      .nl-bulk-dialog .nl-preview { margin-top: 10px; padding: 10px; border-radius: 6px; color: #ddd5e6; background: #2b2235; font-size: 12px; line-height: 1.45; }
      .nl-bulk-dialog .nl-preview.err { color: #ffb4b4; background: #3a2024; }
      .nl-bulk-dialog .nl-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 15px; }
      .nl-bulk-dialog .nl-actions button { min-width: 100px; padding: 0 12px; }
      .nl-bulk-dialog button:disabled { opacity: .5; cursor: default; }
      .nl-bulk-dialog.nl-subtract h2 { color: #ff9ba4; }
      .nl-bulk-dialog.nl-subtract .nl-preview { color: #ffd8dc; background: #3d252d; }
      .nl-bulk-dialog.nl-subtract .nl-actions .primary { border-color: #ff6b78; background: #9b3542; }
      .nl-bulk-dialog.nl-status-mode h2 { color: #e3b6ff; }
      .nl-bulk-dialog.nl-status-mode .nl-actions .primary { border-color: #bd76ee; background: #7440a1; }

      #nl-marked-frames {
        position: fixed;
        z-index: 20;
        display: flex;
        align-items: center;
        gap: 8px;
        min-height: 34px;
        padding: 5px 8px;
        border: 1px solid #8751b3;
        border-radius: 6px;
        color: #f1e8f7;
        background: rgba(31, 25, 39, .94);
        box-shadow: 0 5px 18px rgba(0,0,0,.35);
        font-size: 12px;
        pointer-events: none;
      }
      #nl-marked-frames[hidden] { display: none !important; }
      #nl-marked-frames .nl-mark-box {
        display: inline-grid;
        place-items: center;
        width: 15px;
        height: 15px;
        border: 1px solid #c6a0df;
        border-radius: 2px;
        color: #fff;
        background: #7440a1;
        font-size: 11px;
      }
      #nl-marked-frames[data-count="0"] .nl-mark-box { color: transparent; background: transparent; }
      #nl-marked-frames button {
        padding: 3px 7px;
        border: 1px solid #65566f;
        border-radius: 4px;
        color: #eee7f3;
        background: #31293a;
        cursor: pointer;
        font: inherit;
        pointer-events: auto;
      }
      #nl-marked-frames button[hidden] { display: none; }
      .nl-eye-group-hint {
        margin-top: 7px;
        padding: 7px 8px;
        border: 1px solid #4b5667;
        border-radius: 5px;
        color: #d7dce5;
        background: #242a33;
        font-size: 11px;
        line-height: 1.4;
      }
    `;
    document.head.appendChild(style);
  }

  function buildToolbar() {
    const toolbar = document.createElement("div");
    toolbar.id = ROOT_ID;
    toolbar.dataset.version = VERSION;
    toolbar.innerHTML = `
      <div class="nl-search-wrap">
        <input class="nl-search" type="search" autocomplete="off" spellcheck="false"
          aria-label="Search parts" placeholder="Search parts, e.g. ciga">
        <button class="nl-clear" type="button" title="Clear search" aria-label="Clear search">×</button>
      </div>
      <span class="nl-status" aria-live="polite"></span>
      <div class="nl-bbox-controls">
        <label for="nl-bbox-counts">BBox</label>
        <input id="nl-bbox-counts" type="search" inputmode="numeric" autocomplete="off" spellcheck="false"
          aria-label="Exact BBox counts, separated by commas" placeholder="2,3,4">
        <button class="nl-bbox-all" type="button" title="Show all BBox counts" aria-pressed="true">All</button>
        <span class="nl-bbox-status" aria-live="polite"></span>
      </div>
    `;

    state.input = toolbar.querySelector(".nl-search");
    state.status = toolbar.querySelector(".nl-status");
    state.bboxInput = toolbar.querySelector("#nl-bbox-counts");
    state.bboxAllButton = toolbar.querySelector(".nl-bbox-all");
    state.bboxStatus = toolbar.querySelector(".nl-bbox-status");
    state.input.value = state.filter;
    state.bboxInput.value = state.bboxFilter.join(",");

    state.input.addEventListener("input", () => {
      state.filter = state.input.value;
      storeFilter(state.filter);
      applyFilter();
    });

    state.input.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && state.input.value) {
        event.preventDefault();
        state.input.value = "";
        state.input.dispatchEvent(new Event("input", { bubbles: true }));
      }
    });

    toolbar.querySelector(".nl-clear").addEventListener("click", () => {
      state.input.value = "";
      state.input.dispatchEvent(new Event("input", { bubbles: true }));
      state.input.focus();
    });

    state.bboxInput.addEventListener("input", () => {
      const counts = parseBboxCounts(state.bboxInput.value);
      state.bboxInput.setAttribute("aria-invalid", String(counts === null));
      if (counts === null) {
        state.bboxStatus.textContent = "Use 2,3,4";
        return;
      }
      state.bboxFilter = counts;
      storeBboxFilter();
      applyFilter();
    });
    state.bboxInput.addEventListener("blur", () => {
      if (state.bboxInput.getAttribute("aria-invalid") !== "true") return;
      state.bboxInput.value = state.bboxFilter.join(",");
      state.bboxInput.setAttribute("aria-invalid", "false");
      applyFilter();
    });
    state.bboxAllButton.addEventListener("click", () => {
      state.bboxInput.value = "";
      state.bboxInput.setAttribute("aria-invalid", "false");
      state.bboxFilter = [];
      storeBboxFilter();
      applyFilter();
    });

    return toolbar;
  }

  function clipKey(partName, clipNo) {
    return `${partName}\u001f${clipNo}`;
  }

  function getClipNo(li) {
    return (li.querySelector(".no")?.textContent || "Unknown clip").trim();
  }

  function getMeta(items) {
    const total = items.length;
    let done = 0;
    let doing = 0;
    let checkpoint = -1;
    for (let index = 0; index < items.length; index += 1) {
      const li = items[index];
      const status = li.querySelector(".fs");
      if (status?.classList.contains("done")) {
        done += 1;
        checkpoint = index;
      } else if (status?.classList.contains("wip")) {
        doing += 1;
        checkpoint = index;
      }
    }
    const pieces = [`${total} frames`];
    if (done) pieces.push(`${done} xong`);
    if (doing) pieces.push(`${doing} in progress`);
    if (checkpoint >= 0) pieces.push(`📍 ${checkpoint + 1}/${total}`);
    return { total, done, doing, checkpoint, text: pieces.join(" · ") };
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

  function organizedNavigationIndex() {
    if (!state.list || typeof S === "undefined") return null;
    const cached = state.navigation;
    if (cached && cached.session === S.sess && cached.generation === S.gen &&
        cached.label === S.labelSel && cached.sequence === S.lseq &&
        cached.all.rows[0]?.isConnected) return cached;
    const rows = [];
    const visibleRows = [];
    const ranks = [];
    for (const group of state.list.querySelectorAll(":scope > .grp.nl-organized")) {
      for (const li of group.querySelectorAll("li[data-g]")) {
        ranks.push(visibleRows.length);
        rows.push(li);
        if (!group.hidden && !li.hidden) visibleRows.push(li);
      }
    }
    if (!rows.length) return null;
    const index = (list) => ({ rows: list, positions: new Map(list.map((li, i) => [Number(li.dataset.g), i])) });
    state.navigation = {
      session: S.sess, generation: S.gen, label: S.labelSel, sequence: S.lseq,
      all: index(rows), visible: index(visibleRows),
      // ranks[i]: visible rows before rows[i]; used only while the BBox filter hides rows.
      ranks: state.bboxActive ? ranks : null,
      current: rows.find((li) => li.classList.contains("cur")) || null
    };
    return state.navigation;
  }

  // Row reached by moving `step` (non-zero) from frame g: { rows, index }, or
  // null when g is not in the organized list. index is -1 when no row lies in
  // the travel direction.
  function organizedNavigationTarget(g, step) {
    const navigation = organizedNavigationIndex();
    if (!navigation) return null;
    const { visible, all, ranks } = navigation;
    let rows = visible.rows;
    let target;
    if (visible.positions.has(g)) {
      target = visible.positions.get(g) + step;
    } else if (ranks && all.positions.has(g)) {
      // A frame hidden by the BBox filter resumes at its nearest visible
      // neighbor in the travel direction instead of leaving the filtered list.
      const before = ranks[all.positions.get(g)];
      if (step > 0 ? before >= rows.length : before === 0) return { rows, index: -1 };
      target = step > 0 ? before + step - 1 : before + step;
    } else if (all.positions.has(g)) {
      rows = all.rows;
      target = all.positions.get(g) + step;
    } else {
      return null;
    }
    return { rows, index: rows.length ? Math.max(0, Math.min(rows.length - 1, target)) : -1 };
  }

  function navigateOrganizedFrames(direction, amount = 1) {
    if (!pageLabelingReady() || typeof show !== "function") return false;
    if (state.statusFilters && !S.lseq?.length) return true;
    const navigation = organizedNavigationIndex();
    if (!navigation) return false;
    const active = navigation.all.positions.has(S.g) ? S.g : S.shownG;
    const sign = Math.sign(direction);
    const cursor = organizedNavigationTarget(active, sign * Math.max(1, amount));
    if (!cursor) return false;
    if (cursor.index < 0) return true;
    const { rows, index: nextIndex } = cursor;
    const next = Number(rows[nextIndex].dataset.g);
    if (!Number.isInteger(next)) return false;
    if (next === active) return true;
    try { if (typeof pause === "function") pause(); } catch (_) {}
    show(next);
    // Warm a few following frames, using the same cache as the native player.
    // The two-part preloader supplies compressed local images when available.
    if (typeof getFrame === "function" && typeof fkey === "function" && S.inflight && S.frames) {
      for (let offset = 1; offset <= 3 && S.inflight.size < 4; offset++) {
        const row = rows[nextIndex + sign * offset];
        if (!row) break;
        const g = Number(row.dataset.g);
        if (!S.frames.has(fkey(g))) getFrame(g).catch(() => {});
      }
    }
    return true;
  }

  function ensureOrganizedPlayback() {
    if (state.organizedPlaybackInstalled || typeof playNext !== "function") return;
    const nativePlayNext = playNext;
    playNext = function (g, step = 1) {
      if (!pageLabelingReady()) return nativePlayNext.apply(this, arguments);
      if (state.statusFilters && !S.lseq?.length) return g;
      // The player asks for this once per displayed frame and repeatedly for
      // lookahead. Index the list once, not once per prefetch candidate.
      const cursor = organizedNavigationTarget(g, Math.max(1, Math.abs(Number(step) || 1)));
      if (!cursor) return nativePlayNext.apply(this, arguments);
      if (cursor.index < 0) return g;
      const next = Number(cursor.rows[cursor.index].dataset.g);
      return Number.isInteger(next) ? next : nativePlayNext.apply(this, arguments);
    };
    state.organizedPlaybackInstalled = true;
  }

  function eyeLandmarkActive() {
    try {
      return pageLabelingReady("eye_lmk") && typeof lmkActive === "function" && lmkActive();
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
      if (!Array.isArray(item?.box) || item.box.length < 4) return null;
      const values = item.box.slice(0, 4).map(Number);
      if (!values.every(Number.isFinite)) return null;
      return {
        index,
        box: [Math.min(values[0], values[2]), Math.min(values[1], values[3]),
          Math.max(values[0], values[2]), Math.max(values[1], values[3])]
      };
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
          hint.innerHTML = "Drag inside the box to move the eye · <b>Ctrl + drag</b> to rotate<br>Drag an edge or corner handle to resize the eye";
          panel.appendChild(hint);
        }
      }
      return result;
    };
    state.eyePanelHintInstalled = true;
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

  function markedScopeMatches() {
    return Boolean(state.markedScope && pageLabelingReady() &&
      state.markedScope.generation === S.gen && state.markedScope.session === S.sess &&
      state.markedScope.label === S.labelSel);
  }

  function bboxMarkedScopeMatches() {
    return Boolean(state.bboxMarkedScope && quickBboxReady() &&
      state.bboxMarkedScope.generation === S.gen && state.bboxMarkedScope.session === S.sess &&
      state.bboxMarkedScope.label === S.labelSel);
  }

  function syncMarkedScope() {
    if (!pageLabelingReady()) return false;
    if (!markedScopeMatches()) {
      state.markedFrames.clear();
      state.bboxMarkedFrames.clear();
      state.markedScope = { generation: S.gen, session: S.sess, label: S.labelSel };
      state.bboxMarkedScope = state.markedScope;
    }
    return true;
  }

  function syncBboxMarkedScope() {
    if (!quickBboxReady()) return false;
    syncMarkedScope();
    if (!bboxMarkedScopeMatches()) {
      state.bboxMarkedFrames.clear();
      state.bboxMarkedScope = { generation: S.gen, session: S.sess, label: S.labelSel };
    }
    return true;
  }

  function positionMarkedBadge() {
    if (!state.markedBadge || state.markedBadge.hidden) return;
    const canvas = document.getElementById("view");
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    state.markedBadge.style.left = `${Math.max(8, rect.left + 12)}px`;
    state.markedBadge.style.top = `${Math.max(8, rect.top + 12)}px`;
  }

  function updateMarkedUI() {
    const bboxMode = quickBboxReady();
    const ready = bboxMode ? syncBboxMarkedScope() : syncMarkedScope();
    if (!ready) {
      if (state.markedBadge) state.markedBadge.hidden = true;
      return;
    }
    const selectedFrames = bboxMode ? state.bboxMarkedFrames : state.markedFrames;
    for (const li of state.list?.querySelectorAll("li[data-g]") || []) {
      const selected = selectedFrames.has(Number(li.dataset.g));
      li.classList.toggle("nl-marked-frame", selected);
      let marker = li.querySelector(":scope > .nl-frame-mark");
      if (selected && !marker) {
        marker = document.createElement("span");
        marker.className = "nl-frame-mark";
        marker.textContent = bboxMode ? "◆ V" : "✓ V";
        marker.title = "Frame marked with V";
        const name = li.querySelector(".name");
        if (name) name.before(marker); else li.prepend(marker);
      } else if (!selected) marker?.remove();
    }
    if (!state.markedBadge) return;
    const count = selectedFrames.size;
    state.markedBadge.hidden = false;
    state.markedBadge.dataset.count = String(count);
    state.markedBadge.querySelector("b").textContent = bboxMode
      ? `${count} ${S.labelSel} frames marked · V`
      : `${count} selected · V`;
    state.markedBadge.querySelector("button").hidden = count === 0;
    positionMarkedBadge();
  }

  function clearMarkedFrames() {
    if (quickBboxReady()) state.bboxMarkedFrames.clear();
    else state.markedFrames.clear();
    updateMarkedUI();
  }

  function toggleMarkedFrame() {
    const bboxMode = quickBboxReady();
    if (state.operationBusy || anyBulkDialogOpen() ||
        !(bboxMode ? syncBboxMarkedScope() : syncMarkedScope())) return;
    const g = Number(S.shownG);
    if (!Number.isInteger(g) || !S.lseq?.includes(g)) return;
    const selectedFrames = bboxMode ? state.bboxMarkedFrames : state.markedFrames;
    if (selectedFrames.has(g)) {
      selectedFrames.delete(g);
      updateMarkedUI();
      notify(`Current frame unmarked · ${selectedFrames.size} remaining`);
      return;
    }
    selectedFrames.add(g);
    updateMarkedUI();
    notify(`${selectedFrames.size} frames marked · Ctrl+B to choose Label actions or Change status`);
  }

  function buildMarkedBadge() {
    const badge = document.createElement("div");
    badge.id = "nl-marked-frames";
    badge.dataset.count = "0";
    badge.innerHTML = `<span class="nl-mark-box">✓</span><b>0 selected · V</b><button type="button" hidden>Clear selection</button>`;
    badge.querySelector("button").addEventListener("click", clearMarkedFrames);
    document.body.appendChild(badge);
    state.markedBadge = badge;
  }

  function captureSidebarPosition(allowHiddenCurrent = false) {
    if (!pageLabelingReady() || state.sidebarScope?.generation !== S.gen ||
        state.sidebarScope?.label !== S.labelSel) return null;
    const current = state.list.querySelector("li.cur");
    const currentMatches = current && Number(current.dataset.g) === S.shownG;
    if (!currentMatches && !allowHiddenCurrent) return null;
    const pane = state.pane;
    const bounds = pane.getBoundingClientRect();
    const row = currentMatches ? current.getBoundingClientRect() : null;
    const contentTop = Math.max(bounds.top, state.toolbar?.getBoundingClientRect().bottom || bounds.top);
    let anchor = null;
    if (!(row && row.height > 0 && row.bottom > contentTop && row.top < bounds.bottom)) {
      const candidates = [];
      const add = (element, type, key, priority) => {
        if (!element) return;
        const rect = element.getBoundingClientRect();
        if (rect.height <= 0 || rect.bottom <= contentTop || rect.top >= bounds.bottom) return;
        candidates.push({ element, type, key, priority, top: rect.top });
      };
      const remainsVisible = (container) => Array.from(container.querySelectorAll("li[data-g]"))
        .some((item) => state.statusFilters?.[frameState(Number(item.dataset.g))] !== false);
      for (const group of state.list.querySelectorAll(":scope > .grp:not([hidden])")) {
        if (remainsVisible(group)) add(group, "part", group.dataset.partName, 0);
      }
      for (const details of state.list.querySelectorAll(".nl-clip")) {
        if (remainsVisible(details)) add(details.querySelector(":scope > summary"), "clip", details.dataset.key, 1);
      }
      for (const item of state.list.querySelectorAll("li[data-g]")) {
        const g = Number(item.dataset.g);
        if (state.statusFilters?.[frameState(g)] !== false) add(item, "frame", g, 2);
      }
      const belowTop = candidates.filter((item) => item.top >= contentTop - 1);
      const pool = belowTop.length ? belowTop : candidates;
      pool.sort((a, b) => a.top - b.top || a.priority - b.priority);
      if (pool[0]) {
        anchor = {
          type: pool[0].type,
          key: pool[0].key,
          offset: pool[0].element.getBoundingClientRect().top - bounds.top
        };
      }
    }
    return {
      pane, generation: S.gen, label: S.labelSel, frame: S.shownG,
      top: pane.scrollTop, left: pane.scrollLeft,
      offset: row && row.height > 0 && row.bottom > contentTop && row.top < bounds.bottom
        ? row.top - bounds.top : null,
      anchor
    };
  }

  function sidebarAnchorElement(anchor) {
    if (!anchor) return null;
    if (anchor.type === "frame") {
      return Array.from(state.list.querySelectorAll("li[data-g]"))
        .find((item) => Number(item.dataset.g) === anchor.key) || null;
    }
    if (anchor.type === "clip") {
      return Array.from(state.list.querySelectorAll(".nl-clip"))
        .find((details) => details.dataset.key === anchor.key)?.querySelector(":scope > summary") || null;
    }
    return Array.from(state.list.querySelectorAll(":scope > .grp:not([hidden])"))
      .find((group) => group.dataset.partName === anchor.key) || null;
  }

  function restoreSidebarPosition(position) {
    if (!position || !pageLabelingReady() || position.pane !== state.pane ||
        position.generation !== S.gen || position.label !== S.labelSel || position.frame !== S.shownG) return;
    const current = state.list.querySelector("li.cur");
    const row = current && Number(current.dataset.g) === position.frame
      ? current.getBoundingClientRect() : null;
    state.pane.scrollLeft = position.left;
    if (position.offset !== null && row?.height > 0) {
      state.pane.scrollTop += row.top - state.pane.getBoundingClientRect().top - position.offset;
      return;
    }
    const anchor = sidebarAnchorElement(position.anchor);
    if (anchor) {
      state.pane.scrollTop += anchor.getBoundingClientRect().top -
        state.pane.getBoundingClientRect().top - position.anchor.offset;
    } else state.pane.scrollTop = position.top;
  }

  function revealCurrentFrame(current = state.list?.querySelector("li.cur")) {
    ensureCurrentClipOpen(current);
    current?.scrollIntoView({ block: "nearest" });
  }

  function ensureSidebarRendering() {
    if (state.sidebarRenderingInstalled || typeof renderLabList !== "function" ||
        typeof rvMarkLab !== "function") return;
    const nativeRender = renderLabList;
    renderLabList = function (...args) {
      closeClipStatusMenu();
      state.navigation = null;
      state.partIndex = null;
      if (state.renderingSidebar) return nativeRender.apply(this, args);
      const position = state.sidebarRenderPosition || captureSidebarPosition();
      state.sidebarRenderPosition = null;
      state.renderingSidebar = true;
      let result;
      try {
        result = nativeRender.apply(this, args);
      } finally {
        state.renderingSidebar = false;
        if (pageLabelingReady()) {
          // Reapply grouping/filtering before restoring scroll. The native
          // flat list has a different height and can clamp scrollTop to zero.
          enhance();
          if (statusFilterRestricted() && !S.lseq?.length) {
            const message = "No frames match the selected statuses.";
            state.list.textContent = message;
            if (typeof labEmptyView === "function") labEmptyView(message);
          }
          if (position) restoreSidebarPosition(position);
          else revealCurrentFrame();
        }
      }
      return result;
    };
    const nativeMark = rvMarkLab;
    rvMarkLab = function (...args) {
      if (!state.renderingSidebar && pageLabelingReady()) {
        // Preserve the native only-todo rebuild when a completed frame must
        // leave the list. In the common playback path only two rows change.
        const needsRebuild = S.onlyTodo && typeof fsGet === "function" &&
          S.lseq?.some((g) => fsGet(g) === "done");
        const navigation = needsRebuild ? null : organizedNavigationIndex();
        const index = navigation?.all.positions.get(Number(S.shownG));
        const current = index === undefined ? null : navigation.all.rows[index];
        if (current?.isConnected) {
          if (navigation.current !== current || !current.classList.contains("cur")) {
            navigation.current?.classList.remove("cur");
            current.classList.add("cur");
            navigation.current = current;
            revealCurrentFrame(current);
          }
          if (typeof lsBoxRender === "function") lsBoxRender();
          if (typeof r2Render === "function") r2Render();
          return;
        }
      }
      const position = state.renderingSidebar ? null : captureSidebarPosition();
      const result = nativeMark.apply(this, args);
      state.navigation = null;
      if (!state.renderingSidebar && pageLabelingReady()) {
        // Repaints also call scrollIntoView. Preserve the user's viewport on
        // the same frame, while genuine navigation still reveals the new row.
        if (position) restoreSidebarPosition(position);
        else revealCurrentFrame();
      }
      return result;
    };
    state.sidebarRenderingInstalled = true;
  }

  function statusIcon(value) {
    try { if (typeof FS_ICON !== "undefined" && FS_ICON[value]) return FS_ICON[value]; } catch (_) {}
    return value === "done" ? "●" : value === "wip" ? "◐" : "○";
  }

  function statusName(value) {
    try { if (typeof FS_NAME !== "undefined" && FS_NAME[value]) return FS_NAME[value]; } catch (_) {}
    return value === "done" ? "Done" : value === "wip" ? "In progress" : "Not checked";
  }

  function statusFilterRestricted() {
    return state.statusFilters && FRAME_STATES.some((value) => !state.statusFilters[value]);
  }

  function followFilteredFrame() {
    const navigation = organizedNavigationIndex();
    const rows = navigation?.visible.rows || [];
    if (rows.length && !navigation.visible.positions.has(Number(S.shownG))) {
      const next = rows.find((li) => Number(li.dataset.g) > S.shownG) || rows[0];
      if (typeof show === "function") show(Number(next.dataset.g));
    } else {
      if (typeof drawBar === "function") drawBar();
      if (typeof paint === "function") paint();
    }
  }

  function renderStatusFilters() {
    if (!state.statusFilters || S.mode !== "label") return;
    const legacy = document.getElementById("onlyTodo")?.closest("label");
    const progress = document.getElementById("labProg");
    if (!progress || progress.querySelector("#nl-status-filters")) return;
    const filters = document.createElement("div");
    filters.id = "nl-status-filters";
    filters.setAttribute("role", "group");
    filters.setAttribute("aria-label", "Show frames by status");
    for (const value of FRAME_STATES) {
      const label = document.createElement("label");
      const input = document.createElement("input");
      input.type = "checkbox";
      input.dataset.state = value;
      input.checked = state.statusFilters[value];
      label.append(input, `Show ${statusName(value).toLowerCase()}`);
      input.addEventListener("change", () => {
        state.statusFilters[value] = input.checked;
        // A hidden current frame has no row to anchor. Capture the part/clip
        // the user is actually viewing before rebuilding the filtered list.
        state.sidebarRenderPosition = captureSidebarPosition(true);
        try { localStorage.setItem(STATUS_FILTER_KEY, JSON.stringify(state.statusFilters)); } catch (_) {}
        closeClipStatusMenu();
        if (typeof pause === "function") pause();
        input.blur();
        buildSeq();
        renderLabList();
        followFilteredFrame();
      });
      filters.append(label);
    }
    filters.addEventListener("keydown", (event) => event.stopPropagation());
    if (legacy) legacy.replaceWith(filters); else progress.append(filters);
  }

  function ensureStatusFilters() {
    if (state.statusFilters || typeof buildSeq !== "function" || typeof renderProg !== "function" ||
        !document.getElementById("labProg") || typeof S === "undefined") return false;
    let saved;
    try { saved = JSON.parse(localStorage.getItem(STATUS_FILTER_KEY)); } catch (_) {}
    state.statusFilters = Object.fromEntries(FRAME_STATES.map((value) => [value,
      typeof saved?.[value] === "boolean" ? saved[value] : value !== "done" || !S.onlyTodo]));
    S.onlyTodo = false;
    const nativeBuild = buildSeq;
    buildSeq = function (...args) {
      if (S.mode !== "label") return nativeBuild.apply(this, args);
      // The extension owns all three status choices; first obtain the full
      // authorized label sequence from DMS, then apply the selected statuses.
      const legacyOnlyTodo = S.onlyTodo;
      S.onlyTodo = false;
      let result;
      try { result = nativeBuild.apply(this, args); } finally { S.onlyTodo = legacyOnlyTodo; }
      S.lseq = Int32Array.from(Array.from(S.lseq || []).filter((g) => state.statusFilters[frameState(g)]));
      state.navigation = null;
      return result;
    };
    const nativeProgress = renderProg;
    renderProg = function (...args) {
      const result = nativeProgress.apply(this, args);
      renderStatusFilters();
      return result;
    };
    renderStatusFilters();
    return true;
  }

  function refreshClipSummary(details) {
    const frames = Array.from(details.querySelectorAll("li[data-g]"));
    if (!frames.length) return;
    const stats = getMeta(frames);
    const meta = details.querySelector(":scope > summary .nl-clip-meta");
    if (meta && meta.textContent !== stats.text) meta.textContent = stats.text;

    const wanted = stats.checkpoint >= 0 ? frames[stats.checkpoint] : null;
    for (const marker of details.querySelectorAll(".nl-checkpoint")) {
      if (!wanted || marker.closest("li") !== wanted) marker.remove();
    }
    if (wanted && !wanted.querySelector(":scope > .nl-checkpoint")) {
      const checkpoint = document.createElement("span");
      checkpoint.className = "nl-checkpoint";
      checkpoint.textContent = "📍";
      const name = wanted.querySelector(".name");
      if (name) name.before(checkpoint); else wanted.prepend(checkpoint);
    }
    const marker = wanted?.querySelector(":scope > .nl-checkpoint");
    if (marker) {
      const title = `Checkpoint: frame ${stats.checkpoint + 1}/${stats.total} trong clip`;
      if (marker.title !== title) marker.title = title;
    }
    refreshClipStatusControls(details);
  }

  function refreshVisibleFrameStates() {
    for (const li of state.list?.querySelectorAll("li[data-g]") || []) {
      const g = Number(li.dataset.g);
      const value = frameState(g);
      let badge = li.querySelector(":scope > .fs");
      if (!badge) {
        badge = document.createElement("span");
        li.prepend(badge);
      }
      const className = `fs ${value}`;
      if (badge.className !== className) badge.className = className;
      const title = statusName(value);
      if (badge.title !== title) badge.title = title;
      const icon = statusIcon(value);
      if (badge.textContent !== icon) badge.textContent = icon;

      const time = li.querySelector(".tm");
      if (time) {
        const edited = Boolean(typeof S !== "undefined" && S.ledits?.[rvKey(g)]);
        const base = time.textContent.replace(/\s*✎\s*$/, "");
        const next = edited ? `${base} ✎` : base;
        if (time.textContent !== next) time.textContent = next;
      }
    }
    for (const details of state.list?.querySelectorAll(".nl-clip") || []) refreshClipSummary(details);
    refreshPartStatusControls();
  }

  function ensureStatusRendering() {
    if (state.statusRenderingInstalled || typeof fsRender !== "function") return;
    const nativeRender = fsRender;
    fsRender = function (...args) {
      closeClipStatusMenu();
      if (pageLabelingReady() && statusFilterRestricted()) {
        const previous = Array.from(S.lseq || []);
        buildSeq();
        if (previous.length !== S.lseq.length || previous.some((g, i) => g !== S.lseq[i])) {
          if (typeof renderTabs === "function") renderTabs();
          renderLabList();
          followFilteredFrame();
          if (typeof lsBoxRender === "function") lsBoxRender();
          return;
        }
      }
      const canPatch = pageLabelingReady() && !S.onlyTodo &&
        Boolean(state.list?.querySelector(".grp.nl-organized"));
      if (!canPatch) return nativeRender.apply(this, args);

      const position = captureSidebarPosition();
      state.applying = true;
      try {
        try { if (typeof renderTabs === "function") renderTabs(); } catch (_) {}
        try {
          if (typeof fsLocked === "function" && fsLocked() && typeof ED !== "undefined") {
            ED.sel = -1;
            ED.drag = null;
            if (typeof LM !== "undefined") LM.drag = null;
          }
        } catch (_) {}
        refreshVisibleFrameStates();
        try { if (typeof renderProg === "function") renderProg(); } catch (_) {}
        try { if (typeof lsBoxRender === "function") lsBoxRender(); } catch (_) {}
        try { if (typeof drawBar === "function") drawBar(); } catch (_) {}
        updateMarkedUI();
        if (position) restoreSidebarPosition(position);
      } finally {
        // Do not schedule a complete sidebar pass for mutations made above.
        state.observer?.takeRecords();
        state.applying = false;
      }
    };
    state.statusRenderingInstalled = true;
  }

  function organizeGroup(row) {
    if (row.classList.contains("nl-organized")) return;
    const label = row.querySelector(":scope > .vlab");
    const sourceList = row.querySelector(":scope > ul");
    if (!label || !sourceList) return;

    const partName = (label.textContent || "Unknown part").trim();
    const buckets = new Map();
    for (const li of Array.from(sourceList.children)) {
      if (li.tagName !== "LI") continue;
      const no = getClipNo(li);
      if (!buckets.has(no)) buckets.set(no, []);
      buckets.get(no).push(li);
    }
    if (!buckets.size) return;

    const partLabel = document.createElement("span");
    partLabel.className = "nl-part-name";
    partLabel.textContent = partName;
    const partTools = document.createElement("div");
    partTools.className = "nl-part-tools";
    const partTotal = document.createElement("span");
    partTotal.className = "nl-part-total";
    const doneLabel = document.createElement("label");
    doneLabel.className = "nl-part-done-label";
    const done = document.createElement("input");
    done.type = "checkbox";
    done.className = "nl-part-done";
    done.setAttribute("aria-label", `Done all frames in part ${partName}`);
    const caption = document.createElement("span");
    caption.textContent = "Done all";
    doneLabel.append(done, caption);
    done.addEventListener("change", () => { setWholePartState(row, done.checked ? "done" : "wip"); });
    doneLabel.addEventListener("keydown", (event) => event.stopPropagation());
    doneLabel.addEventListener("click", (event) => event.stopPropagation());
    partTools.append(partTotal, doneLabel);
    label.replaceChildren(partLabel, partTools);

    // Move the large native list off the live document before redistributing
    // its rows. This avoids thousands of connected-DOM mutation/layout steps.
    const anchor = document.createComment("nota-clips");
    sourceList.replaceWith(anchor);

    const clips = document.createElement("div");
    clips.className = "nl-clips";

    for (const [no, items] of buckets) {
      const details = document.createElement("details");
      details.className = "nl-clip";
      details.dataset.clip = no;
      details.dataset.key = clipKey(partName, no);

      const summary = document.createElement("summary");
      const noEl = document.createElement("b");
      noEl.className = "nl-clip-no";
      noEl.textContent = no;
      const stats = getMeta(items);
      if (stats.checkpoint >= 0) {
        const checkpoint = document.createElement("span");
        checkpoint.className = "nl-checkpoint";
        checkpoint.title = `Checkpoint: frame ${stats.checkpoint + 1}/${stats.total} trong clip`;
        checkpoint.textContent = "📍";
        const rowName = items[stats.checkpoint].querySelector(".name");
        if (rowName) rowName.before(checkpoint);
        else items[stats.checkpoint].prepend(checkpoint);
      }

      const meta = document.createElement("span");
      meta.className = "nl-clip-meta";
      meta.textContent = stats.text;
      const statusActions = document.createElement("div");
      statusActions.className = "nl-clip-status-actions";
      statusActions.setAttribute("role", "group");
      statusActions.setAttribute("aria-label", `Change frames by current status in clip ${no} · ${partName}`);
      state.clipScopes.set(details, { session: S.sess, generation: S.gen, label: S.labelSel });
      for (const value of ["done", "todo", "wip"]) {
        const button = document.createElement("button");
        button.type = "button";
        button.dataset.state = value;
        button.textContent = statusName(value);
        button.setAttribute("aria-haspopup", "menu");
        button.setAttribute("aria-expanded", "false");
        button.addEventListener("mouseenter", () => openClipStatusMenu(details, button));
        button.addEventListener("mouseleave", scheduleCloseClipStatusMenu);
        button.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          openClipStatusMenu(details, button, true);
        });
        button.addEventListener("keydown", (event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            openClipStatusMenu(details, button, true);
          }
        });
        statusActions.appendChild(button);
      }
      statusActions.addEventListener("keydown", (event) => event.stopPropagation());
      summary.append(noEl, meta, statusActions);

      summary.addEventListener("click", (event) => {
        if (event.defaultPrevented) return;
        event.preventDefault();
        // A sticky header may be far below its normal position in the list.
        // Collapse synchronously and anchor that header, not the old scrollTop:
        // keeping the old scrollTop would expose a later clip or another part.
        const top = Math.max(summary.getBoundingClientRect().top,
          state.toolbar.getBoundingClientRect().bottom);
        const opening = !details.open;
        if (!opening) {
          state.openClips.delete(details.dataset.key);
          state.manuallyClosedClips.add(details.dataset.key);
        } else {
          state.openClips.add(details.dataset.key);
          state.manuallyClosedClips.delete(details.dataset.key);
        }
        details.open = opening;
        state.pane.scrollTop += summary.getBoundingClientRect().top - top;
      });

      const ul = document.createElement("ul");
      for (const li of items) ul.appendChild(li);

      const hasCurrent = items.some((li) => li.classList.contains("cur"));
      details.classList.toggle("nl-current", hasCurrent);
      details.open = state.openClips.has(details.dataset.key) ||
        (hasCurrent && !state.manuallyClosedClips.has(details.dataset.key));
      if (details.open) state.openClips.add(details.dataset.key);

      details.addEventListener("toggle", () => {
        if (details.open) {
          state.openClips.add(details.dataset.key);
          state.manuallyClosedClips.delete(details.dataset.key);
        } else {
          state.openClips.delete(details.dataset.key);
          state.manuallyClosedClips.add(details.dataset.key);
        }
      });
      details.append(summary, ul);
      refreshClipStatusControls(details);
      clips.appendChild(details);
    }

    row.dataset.partName = partName;
    state.partScopes.set(row, { session: S.sess, generation: S.gen, label: S.labelSel });
    row.classList.add("nl-organized");
    anchor.replaceWith(clips);
  }

  function refreshClipStatusControls(details) {
    const control = details.querySelector(".nl-clip-status-actions");
    if (!control || control.dataset.busy === "true") return;
    const states = clipFrames(details).map((g) => frameState(g));
    if (!states.length) return;
    const allDone = states.every((value) => value === "done");
    const allWip = states.every((value) => value === "wip");
    const allTodo = states.every((value) => value === "todo");
    for (const button of control.querySelectorAll("button[data-state]")) {
      const value = button.dataset.state;
      const current = value === "done" ? allDone : value === "wip" ? allWip : allTodo;
      button.classList.toggle("current", current);
      const count = states.filter((item) => item === value).length;
      button.disabled = !count || state.operationBusy;
      button.title = `${count} ${statusName(value)} frames · Choose a new status`;
      button.setAttribute("aria-label", `${statusName(value)}: change ${count} frames in this clip`);
      button.setAttribute("aria-pressed", String(current));
    }
  }

  function framePartKey(g) {
    const clip = clipAt(g);
    return clip ? (clip.long ? "__long" : clip.cat) : "__none";
  }

  function frameClipKey(g) {
    const clip = clipAt(g);
    return JSON.stringify([framePartKey(g), clip?.long ? clip.cat : clip?.n ?? null]);
  }

  function clipFrames(details) {
    const visible = Array.from(details.querySelectorAll("li[data-g]"), (li) => Number(li.dataset.g));
    const row = details.closest(".grp");
    if (!row || !visible.length) return visible;
    partFrames(row); // Build the shared complete-label index, including hidden frames.
    return state.partIndex?.clips.get(frameClipKey(visible[0])) || visible;
  }

  function partFrames(row) {
    const visible = () => Array.from(row.querySelectorAll("li[data-g]"), (li) => Number(li.dataset.g));
    if (!S.review || typeof rvG !== "function" || typeof clipAt !== "function") return visible();
    let index = state.partIndex;
    if (!index || index.session !== S.sess || index.generation !== S.gen ||
        index.label !== S.labelSel || index.review !== S.review) {
      index = { session: S.sess, generation: S.gen, label: S.labelSel, review: S.review, groups: new Map(), clips: new Map() };
      const frames = [...new Set(Object.values(S.review).filter((item) => item.labels?.includes(S.labelSel))
        .map((item) => rvG(item)).filter((g) => Number.isInteger(g) && g >= 0))].sort((a, b) => a - b);
      for (const g of frames) {
        const key = framePartKey(g);
        if (!index.groups.has(key)) index.groups.set(key, []);
        index.groups.get(key).push(g);
        const clipKey = frameClipKey(g);
        if (!index.clips.has(clipKey)) index.clips.set(clipKey, []);
        index.clips.get(clipKey).push(g);
      }
      state.partIndex = index;
    }
    const first = row.querySelector("li[data-g]");
    return first ? index.groups.get(framePartKey(Number(first.dataset.g))) || [] : [];
  }

  function partStatusMatches(operation) {
    return operation && pageLabelingReady(operation.label) && S.sess === operation.session &&
      S.gen === operation.generation;
  }

  function refreshPartStatusControls() {
    if (!pageLabelingReady()) return;
    for (const row of state.list?.querySelectorAll(":scope > .grp.nl-organized") || []) {
      const input = row.querySelector(".nl-part-done");
      if (!input) continue;
      const frames = partFrames(row);
      const count = frames.reduce((total, g) => total + (frameState(g) === "done" ? 1 : 0), 0);
      input.checked = frames.length > 0 && count === frames.length;
      input.indeterminate = count > 0 && count < frames.length;
      input.disabled = !frames.length || state.operationBusy;
      input.title = `${count}/${frames.length} Done · Check: all Done · Uncheck: all In progress`;
      const operation = state.partStatusOperation;
      const busy = partStatusMatches(operation) && operation.name === row.dataset.partName;
      const tools = row.querySelector(".nl-part-tools");
      tools.setAttribute("aria-busy", String(Boolean(busy)));
      const total = tools.querySelector(".nl-part-total");
      const caption = busy ? `${operation.completed}/${operation.total}` : `${frames.length} frames`;
      if (total.textContent !== caption) total.textContent = caption;
      total.title = busy ? `Saving ${operation.completed}/${operation.total} frames` :
        `Total frames in part ${row.dataset.partName}`;
    }
  }

  function refreshStatusControls() {
    refreshPartStatusControls();
    for (const details of state.list?.querySelectorAll(".nl-clip") || []) refreshClipStatusControls(details);
  }

  async function setWholePartState(row, value) {
    if (!partStatusMatches(state.partScopes.get(row)) || state.operationBusy || !row.isConnected) {
      refreshPartStatusControls();
      return;
    }
    state.partIndex = null;
    const targets = partFrames(row).filter((g) => frameState(g) !== value);
    if (!targets.length) { refreshPartStatusControls(); return; }
    const operation = {
      session: S.sess, generation: S.gen, label: S.labelSel, name: row.dataset.partName,
      completed: 0, total: targets.length
    };
    state.operationBusy = true;
    state.partStatusOperation = operation;
    refreshStatusControls();
    try {
      if (typeof pause === "function") pause();
      const result = await runQueue(targets, async (g) => {
        if (!partStatusMatches(operation)) throw new Error("The session or label has changed");
        await saveFrameState(g, operation.label, value, operation.generation, operation.session);
        if (!partStatusMatches(operation)) throw new Error("The session or label has changed");
      }, (completed) => {
        operation.completed = completed;
        if (!partStatusMatches(operation)) return;
        // Update progress without rescanning the part or rebuilding its list
        // for every response. Status badges refresh once after the batch.
        for (const group of state.list.querySelectorAll(":scope > .grp.nl-organized")) {
          if (group.dataset.partName !== operation.name) continue;
          group.querySelector(".nl-part-total").textContent = `${completed}/${targets.length}`;
        }
      });
      if (partStatusMatches(operation)) {
        if (typeof fsRender === "function") fsRender();
        const caption = value === "done" ? "Done" : "In progress";
        notify(result.error
          ? `${operation.name}: saved ${result.completed}/${targets.length}; stopped on error: ${result.error.message}`
          : `${operation.name}: all frames set to ${caption}`);
      }
    } finally {
      state.partStatusOperation = null;
      state.operationBusy = false;
      refreshStatusControls();
    }
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

  function closeClipStatusMenu(restoreFocus = false) {
    clearTimeout(state.clipMenuTimer);
    const menu = state.clipStatusMenu;
    if (!menu) return;
    state.clipStatusMenu = null;
    menu.element.remove();
    menu.button.setAttribute("aria-expanded", "false");
    if (restoreFocus && menu.button.isConnected) menu.button.focus({ preventScroll: true });
  }

  function scheduleCloseClipStatusMenu() {
    clearTimeout(state.clipMenuTimer);
    state.clipMenuTimer = setTimeout(() => {
      const menu = state.clipStatusMenu;
      if (menu && !menu.element.contains(document.activeElement)) closeClipStatusMenu();
    }, 180);
  }

  function openClipStatusMenu(details, button, focus = false) {
    clearTimeout(state.clipMenuTimer);
    if (button.disabled || !details.isConnected || !partStatusMatches(state.clipScopes.get(details))) return;
    if (state.clipStatusMenu?.button === button) {
      if (focus) state.clipStatusMenu.element.querySelector("button").focus({ preventScroll: true });
      return;
    }
    closeClipStatusMenu();
    const source = button.dataset.state;
    const count = clipFrames(details).filter((g) => frameState(g) === source).length;
    if (!count) return;
    const menu = document.createElement("div");
    menu.id = "nl-clip-status-menu";
    menu.setAttribute("role", "menu");
    menu.setAttribute("aria-label", `Change ${statusName(source)} frames in clip ${details.dataset.clip}`);
    const title = document.createElement("div");
    title.className = "nl-menu-title";
    title.textContent = `${statusName(source)} · ${count} frames`;
    menu.append(title);
    for (const destination of FRAME_STATES.filter((value) => value !== source)) {
      const option = document.createElement("button");
      option.type = "button";
      option.setAttribute("role", "menuitem");
      option.dataset.targetState = destination;
      option.textContent = `→ ${statusName(destination)}`;
      option.addEventListener("click", (event) => {
        event.stopPropagation();
        closeClipStatusMenu();
        setClipSourceState(details, source, destination, button);
      });
      menu.append(option);
    }
    menu.addEventListener("mouseenter", () => clearTimeout(state.clipMenuTimer));
    menu.addEventListener("mouseleave", scheduleCloseClipStatusMenu);
    menu.addEventListener("focusout", () => {
      setTimeout(() => {
        if (state.clipStatusMenu?.element === menu && !menu.contains(document.activeElement) &&
            document.activeElement !== button) closeClipStatusMenu();
      }, 0);
    });
    menu.addEventListener("keydown", (event) => {
      event.stopPropagation();
      const options = Array.from(menu.querySelectorAll("button"));
      const index = options.indexOf(document.activeElement);
      if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
        event.preventDefault();
        const next = event.key === "Home" ? 0 : event.key === "End" ? options.length - 1 :
          (index + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length;
        options[next].focus({ preventScroll: true });
      }
    });
    document.body.append(menu);
    const rect = button.getBoundingClientRect();
    menu.style.left = `${Math.max(8, Math.min(rect.left, innerWidth - menu.offsetWidth - 8))}px`;
    menu.style.top = `${Math.max(8, rect.bottom + menu.offsetHeight <= innerHeight - 8
      ? rect.bottom : rect.top - menu.offsetHeight)}px`;
    state.clipStatusMenu = { element: menu, button, details };
    button.setAttribute("aria-expanded", "true");
    if (focus) menu.querySelector("button").focus({ preventScroll: true });
  }

  async function setClipSourceState(details, source, value, sourceButton) {
    const operation = state.clipScopes.get(details);
    if (!partStatusMatches(operation) || state.operationBusy || !details.isConnected ||
        source === value || !FRAME_STATES.includes(source) || !FRAME_STATES.includes(value)) return;
    const targets = clipFrames(details).filter((g) => Number.isInteger(g) && frameState(g) === source);

    if (!targets.length) {
      refreshClipStatusControls(details);
      return;
    }
    state.operationBusy = true;
    refreshStatusControls();
    const control = sourceButton.closest(".nl-clip-status-actions");
    control.dataset.busy = "true";
    control.setAttribute("aria-busy", "true");
    const originalText = sourceButton.textContent;
    for (const button of control.querySelectorAll("button")) button.disabled = true;
    sourceButton.textContent = `0/${targets.length}`;

    try {
      if (typeof pause === "function") pause();
      let saved = 0;
      const result = await runQueue(
        targets,
        async (g) => {
          if (!partStatusMatches(operation)) throw new Error("The session or label has changed");
          if (frameState(g) !== source) return;
          await saveFrameState(g, operation.label, value, operation.generation, operation.session);
          saved += 1;
          if (!partStatusMatches(operation)) throw new Error("The session or label has changed");
        },
        (done, total) => { if (sourceButton.isConnected) sourceButton.textContent = `${done}/${total}`; },
        4
      );
      if (partStatusMatches(operation)) {
        if (typeof fsRender === "function") fsRender();
        const action = `${statusName(source)} → ${statusName(value)}`;
        if (result.error) notify(`${action}: saved ${saved}/${targets.length}; stopped on error: ${result.error.message}`);
        else notify(`${action}: changed ${saved} frames in this clip`);
      }
    } finally {
      state.operationBusy = false;
      delete control.dataset.busy;
      control.removeAttribute("aria-busy");
      if (sourceButton.isConnected) sourceButton.textContent = originalText;
      if (control.isConnected && partStatusMatches(operation)) refreshClipStatusControls(details);
      refreshStatusControls();
    }
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
    if (!pageLabelingReady("eye_lmk")) return [];
    try {
      const key = rvKey(S.shownG);
      if (typeof ED !== "undefined" && ED.key === key && ED.lab === "eye_lmk" && Array.isArray(ED.items)) {
        return cloneEyeItems(ED.items);
      }
      const saved = S.ledits?.[key]?.eye_lmk;
      if (saved) return cloneEyeItems(saved);
      const [segmentIndex, frameIndex] = loc(S.shownG);
      const data = S.al.get(segmentIndex);
      const frame = data && !(data instanceof Promise) ? data.frames?.[String(frameIndex)] : null;
      return frame && typeof alBoxes === "function" ? cloneEyeItems(alBoxes(frame, "eye_lmk")) : [];
    } catch (_) {
      return [];
    }
  }

  function currentEyeClipContext() {
    if (!pageLabelingReady("eye_lmk")) return null;
    const current = state.list?.querySelector(`li[data-g="${S.shownG}"]`) || state.list?.querySelector("li.cur");
    const details = current?.closest(".nl-clip");
    if (!details) return null;
    const frames = Array.from(details.querySelectorAll("li[data-g]"))
      .map((li) => Number(li.dataset.g))
      .filter(Number.isInteger);
    const source = Number(current.dataset.g);
    const sourceIndex = frames.indexOf(source);
    if (sourceIndex < 0) return null;
    const sourceItems = currentEyeItems();
    let selected = [];
    try {
      if (typeof LM !== "undefined" && Number.isInteger(LM.n) && LM.n >= 0 && LM.n < sourceItems.length) {
        selected = [LM.n];
      }
    } catch (_) {}
    return {
      details,
      frames,
      source,
      sourceIndex,
      clip: details.dataset.clip || "clip",
      generation: S.gen,
      sourceKey: typeof rvKey === "function" ? rvKey(source) : "",
      label: "eye_lmk",
      labelName: "eye 15pt",
      sourceItems,
      selected
    };
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
    if (!GENERIC_COPY_LABELS.has(label) || !pageLabelingReady(label)) return [];
    try {
      const key = rvKey(S.shownG);
      if (typeof ED !== "undefined" && ED.key === key && ED.lab === label && Array.isArray(ED.items)) {
        return cloneGenericItems(ED.items);
      }
      const saved = S.ledits?.[key]?.[label];
      if (saved) return cloneGenericItems(saved);
      const [segmentIndex, frameIndex] = loc(S.shownG);
      const data = S.al.get(segmentIndex);
      const frame = data && !(data instanceof Promise) ? data.frames?.[String(frameIndex)] : null;
      return frame && typeof alBoxes === "function" ? cloneGenericItems(alBoxes(frame, label)) : [];
    } catch (_) {
      return [];
    }
  }

  function currentGenericClipContext() {
    const label = typeof S !== "undefined" ? S.labelSel : "";
    if (!GENERIC_COPY_LABELS.has(label) || !pageLabelingReady(label)) return null;
    const current = state.list?.querySelector(`li[data-g="${S.shownG}"]`) || state.list?.querySelector("li.cur");
    const details = current?.closest(".nl-clip");
    if (!details) return null;
    const frames = Array.from(details.querySelectorAll("li[data-g]"))
      .map((li) => Number(li.dataset.g))
      .filter(Number.isInteger);
    const source = Number(current.dataset.g);
    const sourceIndex = frames.indexOf(source);
    if (sourceIndex < 0) return null;
    const sourceItems = currentGenericItems(label);
    let selected = [];
    let selectedMode = "";
    let selectedRank = -1;
    try {
      if (QUICK_BBOX_LABELS.has(label) && typeof ED !== "undefined" && ED.key === rvKey(source) &&
          ED.lab === label && Array.isArray(ED.items)) {
        const indexes = typeof edSelected === "function" ? edSelected() :
          ED.selSet?.size ? Array.from(ED.selSet) : Number.isInteger(ED.sel) && ED.sel >= 0 ? [ED.sel] : [];
        const index = indexes.length === 1 ? Number(indexes[0]) : -1;
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
      details, frames, source, sourceIndex,
      clip: details.dataset.clip || "clip",
      generation: S.gen,
      sourceKey: typeof rvKey === "function" ? rvKey(source) : "",
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
      generation: S.gen,
      session: S.sess,
      label: S.labelSel,
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
    if (typeof edClearSel === "function") edClearSel();
    else { ED.sel = -1; ED.selSet?.clear(); }
    state.lastCreatedBox = null;
    state.bboxEdgePatch = null;
    if (operation) state.quickLastOperation = {
      ...operation,
      generation: S.gen,
      session: S.sess,
      label: S.labelSel,
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
    // Include Done frames hidden by only-todo, and frames never opened in this
    // tab. Read only frames authorized for the current session and label.
    const frames = S.review && typeof rvG === "function"
      ? Object.values(S.review).filter((item) => item.labels?.includes(S.labelSel)).map(rvG)
      : Array.from(S.lseq || []);
    return [...new Set(frames.filter((g) => Number.isInteger(g) && g >= 0 && g < target))]
      .sort((left, right) => right - left);
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
    const indexes = typeof edSelected === "function" ? edSelected() :
      ED.selSet?.size ? Array.from(ED.selSet) : Number.isInteger(ED.sel) && ED.sel >= 0 ? [ED.sel] : [];
    const selectedIndex = indexes.length === 1 ? Number(indexes[0]) : -1;
    const selected = selectedIndex >= 0 && selectedIndex < ED.items.length;
    state.bboxClipboard = {
      generation: S.gen,
      session: S.sess,
      label: S.labelSel,
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
    if (patch.coord === 0) next[0] = Math.max(0, Math.min(next[2] - 1, next[0]));
    if (patch.coord === 1) next[1] = Math.max(0, Math.min(next[3] - 1, next[1]));
    if (patch.coord === 2) next[2] = Math.min(width, Math.max(next[0] + 1, next[2]));
    if (patch.coord === 3) next[3] = Math.min(height, Math.max(next[1] + 1, next[3]));
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
      if (typeof edClearSel === "function") edClearSel();
      else { ED.sel = -1; ED.selSet?.clear(); }
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
        generation: S.gen,
        session: S.sess,
        label: S.labelSel,
        source: Number(S.shownG)
      };
    }
    ED.poly = [];
    if (typeof edClearSel === "function") edClearSel();
    else { ED.sel = -1; ED.selSet?.clear(); }
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

  function onBboxMouseDown(event) {
    if (!bboxLabelingReady() || event.button !== 0) return;
    const bboxCanvas = document.getElementById("view");
    const bboxStage = document.getElementById("stage");
    if (state.bboxEdgePatch?.ready && (event.target === bboxCanvas || event.target === bboxStage)) {
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
    const canvas = document.getElementById("view");
    const onCanvas = event.target === canvas;
    const edgePatch = state.bboxEdgePatch;
    if (!edgePatch?.ready && bboxEdgePatchMatches(edgePatch) && !event.shiftKey) {
      const geometry = bboxEdgeGeometry(event);
      if (geometry && geometry.itemIndex === edgePatch.itemIndex && geometry.coord === edgePatch.coord) {
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
        return;
      }
    }
    if (event.target === bboxStage && !event.shiftKey && bboxPointerDragAvailable() &&
        typeof hitTest === "function") {
      const hit = hitTest(bboxEventPoint(event).canvasPoint);
      // A handle centered on the boundary has half of its hit area in the
      // black margin. Let that half start the same native drag as the image.
      if (hit && hit.corner >= 0) {
        event.preventDefault();
        event.stopImmediatePropagation();
        canvas.dispatchEvent(new MouseEvent("mousedown", {
          bubbles: true, cancelable: true, view: window,
          clientX: event.clientX, clientY: event.clientY,
          button: event.button, buttons: event.buttons,
          ctrlKey: event.ctrlKey, altKey: event.altKey, metaKey: event.metaKey
        }));
        return;
      }
    }
    if (state.bboxMode === "delete") {
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
      return;
    }
    // The black margin belongs to the drawing surface too. Keep clicks on
    // actual viewer controls and the sidebar out of the create action.
    if (!onCanvas && !(state.bboxMode === "create" && event.target === bboxStage)) return;
    if (state.bboxMode === "create") {
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
      if (typeof edClearSel === "function") edClearSel();
      else { ED.sel = -1; ED.selSet?.clear(); }
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
    const scale = canvas.width / S.sess.src_w;
    const unit = typeof pxK === "function" ? pxK() : canvas.width / canvas.getBoundingClientRect().width;
    ctx.save();
    ctx.setLineDash([]);
    ctx.strokeStyle = "#ff4d5a";
    ctx.fillStyle = "rgba(255,77,90,.22)";
    ctx.lineWidth = 2 * unit;
    ctx.beginPath();
    points.forEach(([x, y], index) => ctx[index ? "lineTo" : "moveTo"](x * scale, y * scale));
    if (points.length >= 3) {
      ctx.closePath();
      ctx.fill();
    }
    ctx.stroke();
    if (draft.length && ED.mouse) {
      const [x, y] = draft[draft.length - 1];
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
      ctx.fillStyle = "#ff4d5a";
      ctx.fill();
    }
    ctx.restore();
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
    if (typeof edClearSel === "function") edClearSel();
    else { ED.sel = -1; ED.selSet?.clear(); }
    if (typeof edRepaint === "function") edRepaint();
  }

  function bulkStatusFrames() {
    const frames = S.review && typeof rvG === "function"
      ? Object.values(S.review).filter((item) => item.labels?.includes(S.labelSel)).map(rvG)
      : Array.from(S.lseq || []);
    return [...new Set(frames.filter((g) => Number.isInteger(g) && g >= 0))].sort((a, b) => a - b);
  }

  function bulkMarkedFrames() {
    if (quickBboxReady()) {
      syncBboxMarkedScope();
      return state.bboxMarkedFrames;
    }
    syncMarkedScope();
    return state.markedFrames;
  }

  function prepareBulkStatusContext() {
    const allowed = bulkStatusFrames();
    const source = Number(S.shownG);
    const sourceClip = typeof clipAt === "function" ? frameClipKey(source) : null;
    const row = state.list?.querySelector(`li[data-g="${source}"]`);
    const details = row?.closest(".nl-clip");
    const frames = sourceClip !== null ? allowed.filter((g) => frameClipKey(g) === sourceClip) :
      Array.from(details?.querySelectorAll("li[data-g]") || [], (li) => Number(li.dataset.g));
    state.bulkStatusContext = {
      session: S.sess, generation: S.gen, label: S.labelSel, source,
      allowed: new Set(allowed), frames, sourceIndex: frames.indexOf(source),
      clip: details?.dataset.clip || "current clip"
    };
    bulkMarkedFrames();
  }

  function installBulkTabs(dialog) {
    const form = dialog.querySelector("form");
    const labelPanel = document.createElement("div");
    labelPanel.className = "nl-label-panel";
    labelPanel.id = `${dialog.id}-label-panel`;
    labelPanel.setAttribute("role", "tabpanel");
    labelPanel.append(...form.childNodes);
    const tabs = document.createElement("div");
    tabs.className = "nl-choice nl-bulk-tabs";
    tabs.setAttribute("role", "tablist");
    tabs.setAttribute("aria-label", "Bulk action type");
    for (const [tab, caption] of [["label", "Label actions"], ["status", "Change status"]]) {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.bulkTab = tab;
      button.id = `${dialog.id}-${tab}-tab`;
      button.setAttribute("role", "tab");
      button.setAttribute("aria-controls", `${dialog.id}-${tab}-panel`);
      button.textContent = caption;
      button.addEventListener("click", () => selectBulkTab(dialog, tab));
      button.addEventListener("keydown", (event) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        event.preventDefault();
        if (state.operationBusy) return;
        const next = tab === "label" ? "status" : "label";
        selectBulkTab(dialog, next);
        tabs.querySelector(`[data-bulk-tab="${next}"]`).focus();
      });
      tabs.append(button);
    }
    const statusPanel = document.createElement("div");
    statusPanel.className = "nl-status-panel";
    statusPanel.id = `${dialog.id}-status-panel`;
    statusPanel.setAttribute("role", "tabpanel");
    labelPanel.setAttribute("aria-labelledby", `${dialog.id}-label-tab`);
    statusPanel.setAttribute("aria-labelledby", `${dialog.id}-status-tab`);
    statusPanel.innerHTML = `
      <h2>Change frame status</h2>
      <p class="nl-sub nl-status-sub"></p>
      <span class="nl-label">Target frames</span>
      <div class="nl-choice">
        <button type="button" data-status-direction="before">← Previous frames</button>
        <button type="button" data-status-direction="after">Next frames →</button>
        <button type="button" data-status-direction="marked">◆ Marked frames</button>
      </div>
      <span class="nl-label">Set status to</span>
      <div class="nl-scope">
        <label><input type="radio" name="${dialog.id}-status" value="todo">Not checked</label>
        <label><input type="radio" name="${dialog.id}-status" value="wip">In progress</label>
        <label><input type="radio" name="${dialog.id}-status" value="done">Done</label>
      </div>
      <label class="nl-label" for="${dialog.id}-status-count">Number of target frames, or end</label>
      <input id="${dialog.id}-status-count" class="nl-status-count" value="1" autocomplete="off" spellcheck="false">
      <div class="nl-preview nl-status-preview" aria-live="polite"></div>
      <div class="nl-actions">
        <button type="button" class="nl-status-cancel">Cancel · Esc</button>
        <button type="button" class="primary nl-status-apply">Apply · Enter</button>
      </div>`;
    form.append(tabs, labelPanel, statusPanel);
    for (const button of statusPanel.querySelectorAll("[data-status-direction]")) {
      button.addEventListener("click", () => {
        if (state.operationBusy) return;
        state.bulkStatusDirection = button.dataset.statusDirection;
        updateBulkStatusPanel(dialog);
      });
    }
    for (const radio of statusPanel.querySelectorAll('input[type="radio"]')) {
      radio.addEventListener("change", () => {
        state.bulkStatusValue = radio.value;
        updateBulkStatusPanel(dialog);
      });
    }
    statusPanel.querySelector(".nl-status-count").addEventListener("input", () => updateBulkStatusPanel(dialog));
    statusPanel.querySelector(".nl-status-apply").addEventListener("click", () => applyBulkStatus(dialog));
    statusPanel.querySelector(".nl-status-cancel").addEventListener("click", () => {
      if (!state.operationBusy) dialog.close();
    });
  }

  function selectBulkTab(dialog, tab, remember = true) {
    if (state.operationBusy) return;
    state.bulkTab = tab;
    if (remember) {
      try { localStorage.setItem(BULK_TAB_KEY, tab); } catch (_) {}
    }
    dialog.querySelector(".nl-label-panel").hidden = tab !== "label";
    dialog.querySelector(".nl-status-panel").hidden = tab !== "status";
    for (const button of dialog.querySelectorAll("[data-bulk-tab]")) {
      const active = button.dataset.bulkTab === tab;
      button.classList.toggle("on", active);
      button.setAttribute("aria-selected", String(active));
      button.tabIndex = active ? 0 : -1;
    }
    if (tab === "status") {
      dialog.classList.remove("nl-subtract");
      updateBulkStatusPanel(dialog);
    } else if (dialog === state.eyeBulkDialog) updateEyeBulkDialog();
    else updateBulkDialog();
  }

  function showBulkDialog(dialog) {
    prepareBulkStatusContext();
    selectBulkTab(dialog, state.bulkTab, false);
    if (!dialog.open) dialog.showModal();
    const input = dialog.querySelector(state.bulkTab === "status" ? ".nl-status-count" : ".nl-count");
    if (input.disabled) dialog.querySelector('[data-bulk-tab][aria-selected="true"]').focus();
    else { input.focus(); input.select(); }
  }

  function emptyLabelBulkContext(label) {
    return {
      frames: [], source: Number(S.shownG), sourceIndex: -1, clip: "No visible clip",
      generation: S.gen, sourceKey: typeof rvKey === "function" ? rvKey(S.shownG) : "",
      label, labelName: genericLabelName(label), sourceItems: [], selected: []
    };
  }

  function selectedStatusTargets(dialog) {
    const context = state.bulkStatusContext;
    if (!partStatusMatches(context) ||
        (state.bulkStatusDirection !== "marked" && context.source !== Number(S.shownG))) {
      return { targets: [], error: "The frame, session or label has changed. Reopen Ctrl+B." };
    }
    if (state.bulkStatusDirection === "marked") {
      const targets = Array.from(bulkMarkedFrames()).filter((g) => context.allowed.has(g)).sort((a, b) => a - b);
      return { targets, error: targets.length ? "" : "No frames marked. Close this dialog and press V to mark frames." };
    }
    if (context.sourceIndex < 0) return { targets: [], error: "Open a frame in the current label's clip first." };
    const raw = dialog.querySelector(".nl-status-count").value.trim().toLowerCase();
    if (raw !== "end" && !/^[1-9]\d*$/.test(raw)) return { targets: [], error: "Enter a positive whole number or end." };
    // Status counts include the frame currently being viewed. Label actions
    // use their own target selectors and continue to exclude the source frame.
    const candidates = state.bulkStatusDirection === "before"
      ? [context.source, ...context.frames.slice(0, context.sourceIndex).reverse()]
      : [context.source, ...context.frames.slice(context.sourceIndex + 1)];
    const targets = candidates.slice(0, raw === "end" ? candidates.length : Number(raw));
    return { targets, error: targets.length ? "" : "No more frames in this direction within the current clip." };
  }

  function updateBulkStatusPanel(dialog) {
    const context = state.bulkStatusContext;
    if (!context) return;
    for (const button of dialog.querySelectorAll("[data-status-direction]")) {
      button.classList.toggle("on", button.dataset.statusDirection === state.bulkStatusDirection);
    }
    const marked = Array.from(bulkMarkedFrames()).filter((g) => context.allowed.has(g)).length;
    dialog.querySelector('[data-status-direction="marked"]').textContent = `◆ Marked frames (${marked})`;
    dialog.querySelector(".nl-status-count").disabled = state.bulkStatusDirection === "marked";
    dialog.querySelector(`.nl-status-panel input[value="${state.bulkStatusValue}"]`).checked = true;
    dialog.querySelector(".nl-status-sub").textContent =
      `Label: ${genericLabelName(context.label)} · ${context.clip}. Existing annotations are preserved.`;
    const picked = selectedStatusTargets(dialog);
    const unchanged = picked.targets.filter((g) => frameState(g) === state.bulkStatusValue).length;
    const count = picked.targets.length - unchanged;
    const preview = dialog.querySelector(".nl-status-preview");
    preview.classList.toggle("err", Boolean(picked.error));
    preview.textContent = picked.error ||
      `Set ${count} of ${picked.targets.length} frames to ${statusName(state.bulkStatusValue)}` +
      (unchanged ? ` · ${unchanged} already have this status` : "") + ". " +
      (state.bulkStatusDirection === "marked"
        ? "Includes the current frame if marked; marked frames may span clips."
        : "Within this clip, including the current frame; includes frames hidden by status filters.");
    dialog.querySelector(".nl-status-apply").disabled = Boolean(picked.error) || !count || state.operationBusy;
  }

  async function applyBulkStatus(dialog) {
    if (state.operationBusy || state.bulkTab !== "status") return;
    const picked = selectedStatusTargets(dialog);
    const context = state.bulkStatusContext;
    const value = state.bulkStatusValue;
    if (picked.error || !FRAME_STATES.includes(value)) { updateBulkStatusPanel(dialog); return; }
    // Recheck authorization when applying; a filter changes visibility, not the
    // complete current-label scope. Status changes never read/write annotations.
    const allowed = new Set(bulkStatusFrames());
    const targets = picked.targets.filter((g) => allowed.has(g) && frameState(g) !== value);
    if (!targets.length) { updateBulkStatusPanel(dialog); return; }
    const controls = Array.from(dialog.querySelectorAll("button, input"));
    const disabled = controls.map((control) => control.disabled);
    const preview = dialog.querySelector(".nl-status-preview");
    state.operationBusy = true;
    for (const control of controls) control.disabled = true;
    refreshStatusControls();
    try {
      if (typeof pause === "function") pause();
      const result = await runQueue(targets, async (g) => {
        if (!partStatusMatches(context)) throw new Error("The session or label has changed");
        if (frameState(g) !== value) await saveFrameState(g, context.label, value, context.generation, context.session);
        if (!partStatusMatches(context)) throw new Error("The session or label has changed");
      }, (done, total) => {
        preview.classList.remove("err");
        preview.textContent = `Setting ${done}/${total} frames to ${statusName(value)}…`;
      });
      if (partStatusMatches(context)) {
        if (typeof fsRender === "function") fsRender();
        updateMarkedUI();
      }
      if (result.error) throw new Error(`saved ${result.completed}/${targets.length}: ${result.error.message}`);
      dialog.close();
      notify(`Set ${targets.length} frames to ${statusName(value)}`);
    } catch (error) {
      preview.classList.add("err");
      preview.textContent = `Stopped on error: ${error.message}. Retry to save remaining frames.`;
    } finally {
      state.operationBusy = false;
      controls.forEach((control, index) => { control.disabled = disabled[index]; });
      refreshStatusControls();
      if (dialog.open) {
        const remaining = selectedStatusTargets(dialog);
        dialog.querySelector(".nl-status-apply").disabled = Boolean(remaining.error) ||
          !remaining.targets.some((g) => frameState(g) !== value);
      }
    }
  }

  function ensureEyeBulkDialog() {
    if (state.eyeBulkDialog?.isConnected) return state.eyeBulkDialog;
    const dialog = document.createElement("dialog");
    dialog.id = "nl-eye-bulk";
    dialog.className = "nl-bulk-dialog";
    dialog.innerHTML = `
      <form class="nl-modal" method="dialog">
        <h2>Copy eye 15pt across a clip</h2>
        <p class="nl-sub"></p>

        <span class="nl-label">Target direction</span>
        <div class="nl-choice nl-directions">
          <button type="button" data-eye-direction="before">← Previous frames</button>
          <button type="button" data-eye-direction="after">Next frames →</button>
          <button type="button" data-eye-direction="marked" class="nl-marked-target" hidden>◆ Marked frames</button>
        </div>

        <span class="nl-label nl-source-label">Source objects</span>
        <div class="nl-scope">
          <label class="nl-eye-selected-option"><input type="radio" name="nl-eye-scope" value="selected"><span class="nl-item-selected-text">Selected eye only</span></label>
          <label><input type="radio" name="nl-eye-scope" value="all"><span class="nl-item-all-text">All eyes in the current frame</span></label>
        </div>

        <span class="nl-label nl-write-label">How to update target frames</span>
        <div class="nl-scope nl-write-options">
          <label><input type="radio" name="nl-eye-write" value="merge" checked><span class="nl-item-merge-text">Replace matching eyes and keep the others</span></label>
          <label><input type="radio" name="nl-eye-write" value="replace"><span class="nl-item-replace-text">Replace all eyes in target frames</span></label>
        </div>

        <label class="nl-label" for="nl-eye-bulk-count">Number of target frames, or end</label>
        <input id="nl-eye-bulk-count" class="nl-count" value="1" autocomplete="off" spellcheck="false">
        <div class="nl-preview" aria-live="polite"></div>

        <div class="nl-actions">
          <button type="button" class="nl-cancel">Cancel · Esc</button>
          <button type="button" class="primary nl-apply">Apply · Enter</button>
        </div>
      </form>
    `;
    document.body.appendChild(dialog);
    for (const button of dialog.querySelectorAll("[data-eye-direction]")) {
      button.addEventListener("click", () => {
        state.eyeBulkDirection = button.dataset.eyeDirection;
        updateEyeBulkDialog();
      });
    }
    dialog.querySelector(".nl-count").addEventListener("input", updateEyeBulkDialog);
    for (const input of dialog.querySelectorAll('input[type="radio"]')) {
      input.addEventListener("change", updateEyeBulkDialog);
    }
    dialog.querySelector(".nl-cancel").addEventListener("click", cancelEyeBulkDialog);
    dialog.querySelector(".nl-apply").addEventListener("click", applyItemBulkCopy);
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      cancelEyeBulkDialog();
    });
    dialog.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && event.target.tagName !== "BUTTON") {
        event.preventDefault();
        applyItemBulkCopy();
      }
    });
    dialog.addEventListener("close", () => {
      if (!dialog.open) {
        state.eyeBulkContext = null;
        state.bulkStatusContext = null;
        if (dialog.contains(document.activeElement)) document.activeElement.blur();
      }
    });
    installBulkTabs(dialog);
    state.eyeBulkDialog = dialog;
    return dialog;
  }

  function cancelEyeBulkDialog() {
    if (state.operationBusy) return;
    state.eyeBulkContext = null;
    if (state.eyeBulkDialog?.contains(document.activeElement)) document.activeElement.blur();
    state.eyeBulkDialog?.close();
  }

  function selectedEyeBulkTargets() {
    const context = state.eyeBulkContext;
    if (!context) return { targets: [], error: "Could not identify the current clip." };
    if (state.eyeBulkDirection === "marked") {
      if (!bboxMarkedScopeMatches()) return { targets: [], error: "The marked frames no longer belong to the current label." };
      const targets = Array.from(state.bboxMarkedFrames)
        .filter((g) => Number.isInteger(g) && g !== context.source && S.lseq?.includes(g));
      return targets.length
        ? { targets, error: "" }
        : { targets: [], error: "No target frames marked yet. Press V to mark frames." };
    }
    const raw = state.eyeBulkDialog.querySelector(".nl-count").value.trim().toLowerCase();
    const candidates = state.eyeBulkDirection === "before"
      ? context.frames.slice(0, context.sourceIndex).reverse()
      : context.frames.slice(context.sourceIndex + 1);
    let count;
    if (raw === "end") count = candidates.length;
    else if (/^[1-9]\d*$/.test(raw)) count = Number(raw);
    else return { targets: [], error: "Enter a positive whole number or end." };
    const selected = candidates.slice(0, count);
    if (!selected.length) return { targets: [], error: "No more frames in the selected direction within this clip." };
    return { targets: selected, error: "" };
  }

  function updateEyeBulkDialog() {
    const dialog = state.eyeBulkDialog;
    const context = state.eyeBulkContext;
    if (!dialog || !context) return;
    for (const button of dialog.querySelectorAll("[data-eye-direction]")) {
      button.classList.toggle("on", button.dataset.eyeDirection === state.eyeBulkDirection);
    }
    const hasSelected = context.selected.length > 0;
    const quickMode = QUICK_BBOX_LABELS.has(context.label);
    const markedButton = dialog.querySelector(".nl-marked-target");
    markedButton.hidden = !quickMode;
    markedButton.textContent = `◆ Marked frames (${bboxMarkedScopeMatches() ? state.bboxMarkedFrames.size : 0})`;
    if (!quickMode && state.eyeBulkDirection === "marked") state.eyeBulkDirection = "after";
    dialog.querySelector(".nl-count").disabled = state.eyeBulkDirection === "marked";
    dialog.querySelector(".nl-eye-selected-option").hidden = !hasSelected;
    const checked = dialog.querySelector('input[name="nl-eye-scope"]:checked');
    if (!checked || (checked.value === "selected" && !hasSelected)) {
      dialog.querySelector(`input[name="nl-eye-scope"][value="${hasSelected ? "selected" : "all"}"]`).checked = true;
    }
    const operation = context.operation;
    const operationMode = operation?.type === "delete" || operation?.type === "edge";
    const scope = dialog.querySelector('input[name="nl-eye-scope"]:checked')?.value || "all";
    const sourceCount = operationMode ? 1 : scope === "selected" ? context.selected.length : context.sourceItems.length;
    const writeMode = dialog.querySelector('input[name="nl-eye-write"]:checked')?.value || "merge";
    const eyeMode = context.label === "eye_lmk";
    const boxMode = !eyeMode && context.label !== "face_lmk";
    dialog.querySelector("h2").textContent = operation?.type === "delete"
      ? `Delete ${context.labelName} across a clip`
      : operation?.type === "edge" ? `Adjust the ${operation.edge} ${context.labelName} edge` : `Copy ${context.labelName} across a clip`;
    dialog.querySelector(".nl-source-label").textContent = eyeMode ? "Source objects" : "What to copy";
    dialog.querySelector(".nl-source-label").hidden = operationMode;
    dialog.querySelector(".nl-scope").hidden = operationMode;
    dialog.querySelector(".nl-item-selected-text").textContent = eyeMode
      ? "Selected eye only"
      : context.selectedMode === "clicked" ? "Selected box only" : "Newly added box only";
    dialog.querySelector(".nl-item-all-text").textContent = eyeMode
      ? "All eyes in the current frame"
      : boxMode ? "All boxes in the current frame" : "All face 7pt groups in the current frame";
    dialog.querySelector(".nl-write-label").hidden = !eyeMode || operationMode;
    dialog.querySelector(".nl-write-options").hidden = !eyeMode || operationMode;
    dialog.querySelector(".nl-item-merge-text").textContent = eyeMode
      ? "Replace matching eyes and keep the others"
      : "";
    dialog.querySelector(".nl-item-replace-text").textContent = eyeMode
      ? "Replace all eyes in target frames"
      : "";
    dialog.querySelector(".nl-sub").textContent =
      `${context.clip} · source frame ${context.sourceIndex + 1}/${context.frames.length} · label ${context.labelName}.`;
    const picked = selectedEyeBulkTargets();
    const preview = dialog.querySelector(".nl-preview");
    preview.classList.toggle("err", Boolean(picked.error) || !sourceCount);
    if (picked.error) preview.textContent = picked.error;
    else if (!sourceCount) preview.textContent = `This frame has no ${context.labelName} objects to copy.`;
    else {
      const skipped = picked.targets.filter((g) => frameState(g) === "done").length;
      const writeText = eyeMode
        ? (writeMode === "replace" ? "replace all eyes in target frames" : "replace matching eyes and keep the others")
        : scope === "selected"
          ? "replace matching boxes and keep the others; add a new box if no match exists"
          : "replace with all annotations from the source frame";
      const directionText = state.eyeBulkDirection === "marked" ? "marked" :
        state.eyeBulkDirection === "after" ? "next" : "previous";
      const actionText = operation?.type === "delete"
        ? `Delete ${operation.selector === "all" ? "all boxes" : operation.selector === "left" ? "the leftmost box" : operation.selector === "right" ? "the rightmost box" : operation.selector === "region" ? "boxes inside the M region" : "the box at the same position in the list"}`
        : operation?.type === "edge"
          ? `Set the ${operation.edge} edge to ${Number(operation.value).toFixed(1)} px`
          : `Copy ${sourceCount} ${eyeMode ? "eye groups" : boxMode ? "boxes" : "face 7pt groups"}`;
      preview.textContent = `${actionText} across ${picked.targets.length} ${directionText} frames` +
        (operation?.type === "edge" ? " · keep the target box's other three edges; leave frames without a matching box unchanged" :
          operationMode ? " · keep other boxes and edges" : ` · ${writeText}`) +
        (skipped ? ` · skip ${skipped} Done frames` : "") + ". Up to 4 requests run at a time.";
    }
    dialog.querySelector(".nl-apply").disabled = Boolean(picked.error) || !sourceCount || state.operationBusy;
  }

  function openEyeBulkDialog() {
    if (state.operationBusy) return;
    const context = currentEyeClipContext() || emptyLabelBulkContext("eye_lmk");
    state.eyeBulkContext = context;
    const dialog = ensureEyeBulkDialog();
    dialog.querySelector(`input[name="nl-eye-scope"][value="${context.selected.length ? "selected" : "all"}"]`).checked = true;
    updateEyeBulkDialog();
    showBulkDialog(dialog);
  }

  function openGenericBulkDialog() {
    if (state.operationBusy) return;
    if (QUICK_BBOX_LABELS.has(S.labelSel)) syncBboxMarkedScope();
    if (state.eyeBulkDirection === "marked" &&
        (!bboxMarkedScopeMatches() || !state.bboxMarkedFrames.size)) state.eyeBulkDirection = "after";
    const context = currentGenericClipContext() || emptyLabelBulkContext(S.labelSel);
    state.eyeBulkContext = context;
    const dialog = ensureEyeBulkDialog();
    dialog.querySelector(`input[name="nl-eye-scope"][value="${context.selected.length ? "selected" : "all"}"]`).checked = true;
    updateEyeBulkDialog();
    showBulkDialog(dialog);
  }

  function currentClipContext() {
    if (!pageLabelingReady("seatbelt")) return null;
    const current = state.list?.querySelector(`li[data-g="${S.shownG}"]`) || state.list?.querySelector("li.cur");
    const details = current?.closest(".nl-clip");
    if (!details) return null;
    const frames = Array.from(details.querySelectorAll("li[data-g]"))
      .map((li) => Number(li.dataset.g))
      .filter(Number.isInteger);
    const source = Number(current.dataset.g);
    const sourceIndex = frames.indexOf(source);
    if (sourceIndex < 0) return null;
    return {
      details,
      frames,
      source,
      sourceIndex,
      clip: details.dataset.clip || "clip",
      generation: S.gen,
      sourceKey: typeof rvKey === "function" ? rvKey(source) : ""
    };
  }

  function ensureBulkDialog() {
    if (state.bulkDialog?.isConnected) return state.bulkDialog;
    const dialog = document.createElement("dialog");
    dialog.id = "nl-seatbelt-bulk";
    dialog.className = "nl-bulk-dialog";
    dialog.innerHTML = `
      <form class="nl-modal" method="dialog">
        <h2>Apply seatbelt masks across a clip</h2>
        <p class="nl-sub"></p>

        <span class="nl-label nl-mask-only">Target direction</span>
        <div class="nl-choice nl-directions nl-mask-only">
          <button type="button" data-direction="before">← Previous frames</button>
          <button type="button" data-direction="after">Next frames →</button>
        </div>

        <span class="nl-label nl-scope-label nl-mask-only">Mask content to apply</span>
        <div class="nl-scope nl-mask-only">
          <label class="nl-patch-option"><input type="radio" name="nl-scope" value="patch"><span class="nl-patch-label">Latest polygon only</span></label>
          <label class="nl-mask-option"><input type="radio" name="nl-scope" value="mask"> Entire mask from the current frame</label>
        </div>

        <label class="nl-label nl-mask-only" for="nl-bulk-count">Number of target frames, or end</label>
        <input id="nl-bulk-count" class="nl-count nl-mask-only" value="1" autocomplete="off" spellcheck="false">
        <div class="nl-preview" aria-live="polite"></div>

        <div class="nl-actions">
          <button type="button" class="nl-cancel">Cancel · Esc</button>
          <button type="button" class="primary nl-apply">Apply · Enter</button>
        </div>
      </form>
    `;
    document.body.appendChild(dialog);

    for (const button of dialog.querySelectorAll("[data-direction]")) {
      button.addEventListener("click", () => {
        state.bulkDirection = button.dataset.direction;
        updateBulkDialog();
      });
    }
    dialog.querySelector(".nl-count").addEventListener("input", updateBulkDialog);
    for (const input of dialog.querySelectorAll('input[name="nl-scope"]')) {
      input.addEventListener("change", updateBulkDialog);
    }
    dialog.querySelector(".nl-cancel").addEventListener("click", cancelBulkDialog);
    dialog.querySelector(".nl-apply").addEventListener("click", applyBulkAction);
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      cancelBulkDialog();
    });
    dialog.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && event.target.tagName !== "BUTTON") {
        event.preventDefault();
        applyBulkAction();
      }
    });
    dialog.addEventListener("close", () => {
      if (!dialog.open) {
        state.bulkContext = null;
        state.bulkMode = null;
        state.bulkStatusContext = null;
        if (dialog.contains(document.activeElement)) document.activeElement.blur();
      }
    });
    installBulkTabs(dialog);
    state.bulkDialog = dialog;
    return dialog;
  }

  function cancelBulkDialog() {
    if (state.operationBusy) return;
    if (state.bulkMode === "mask" && state.bulkTab === "label") cancelManualMode();
    state.bulkContext = null;
    if (state.bulkDialog?.contains(document.activeElement)) document.activeElement.blur();
    state.bulkDialog?.close();
  }

  function selectedBulkTargets() {
    const context = state.bulkContext;
    if (!context) return { targets: [], error: "Could not identify the current clip." };
    const dialog = state.bulkDialog;
    const raw = dialog.querySelector(".nl-count").value.trim().toLowerCase();
    const candidates = state.bulkDirection === "before"
      ? context.frames.slice(0, context.sourceIndex).reverse()
      : context.frames.slice(context.sourceIndex + 1);
    let count;
    if (raw === "end") count = candidates.length;
    else if (/^[1-9]\d*$/.test(raw)) count = Number(raw);
    else return { targets: [], error: "Enter a positive whole number or end." };
    const selected = candidates.slice(0, count);
    if (!selected.length) return { targets: [], error: "No more frames in the selected direction within this clip." };
    return { targets: selected, error: "" };
  }

  function updateBulkDialog() {
    const dialog = state.bulkDialog;
    const context = state.bulkContext;
    if (!dialog || !context) return;
    dialog.querySelector(".nl-apply").textContent = "Apply · Enter";
    for (const button of dialog.querySelectorAll("[data-direction]")) {
      button.classList.toggle("on", button.dataset.direction === state.bulkDirection);
    }

    const hasPatch = patchMatchesContext(context);
    const subtract = hasPatch && state.lastPatch.operation === "subtract";
    const samPatch = hasPatch && state.lastPatch.kind === "sam";
    const patchOption = dialog.querySelector(".nl-patch-option");
    patchOption.hidden = !hasPatch;
    dialog.querySelector(".nl-mask-option").hidden = subtract;
    dialog.querySelector('.nl-mask-option input').disabled = subtract;
    dialog.querySelector(".nl-patch-label").textContent = samPatch
      ? (subtract ? "Latest removed mask area only (SAM3)" : "Latest added mask area only (SAM3)")
      : (subtract ? "Red polygon region to erase" : "Latest polygon only");
    dialog.classList.toggle("nl-subtract", subtract);
    dialog.querySelector("h2").textContent = subtract ? "Erase a seatbelt region across frames" : "Apply seatbelt masks across a clip";
    dialog.querySelector(".nl-scope-label").textContent = subtract ? "Region to erase" : "Mask content to apply";
    const checked = dialog.querySelector('input[name="nl-scope"]:checked');
    if (subtract || !checked || (checked.value === "patch" && !hasPatch)) {
      dialog.querySelector(`input[name="nl-scope"][value="${hasPatch ? "patch" : "mask"}"]`).checked = true;
    }

    dialog.querySelector(".nl-sub").textContent =
      `${context.clip} · source frame ${context.sourceIndex + 1}/${context.frames.length}. ` +
      (subtract
        ? (samPatch ? "Erase only the latest SAM3 edit; keep the seatbelt mask outside it." : "Erase only inside the red polygon; keep the seatbelt mask outside it.")
        : "Existing masks in target frames are preserved.");
    const picked = selectedBulkTargets();
    const emptySamPatch = samPatch && !state.lastPatch.pixelCount &&
      dialog.querySelector('input[name="nl-scope"]:checked')?.value === "patch";
    const blocked = maskBulkBlockReason();
    const preview = dialog.querySelector(".nl-preview");
    preview.classList.toggle("err", Boolean(blocked || picked.error) || emptySamPatch);
    if (blocked) preview.textContent = blocked;
    else if (picked.error) preview.textContent = picked.error;
    else if (emptySamPatch) preview.textContent = subtract
      ? "SAM3 removed no pixels in this frame. Select an area to erase."
      : "SAM3 added no new pixels in this frame. Choose the entire mask to copy the existing mask.";
    else {
      const skipped = picked.targets.filter((g) => frameState(g) === "done").length;
      const action = subtract ? (samPatch ? "Erase the SAM3 region on" : "Erase the red region on") :
        (samPatch && dialog.querySelector('input[name="nl-scope"]:checked')?.value === "patch" ? "Apply the latest added mask area to" : "Apply the mask to");
      preview.textContent = `${action} ${picked.targets.length} target frames · ${state.bulkDirection === "after" ? "after" : "before"} the current frame` +
        (skipped ? ` · skip ${skipped} Done frames` : "") + ". Up to 4 requests run at a time.";
    }
    dialog.querySelector(".nl-apply").disabled = Boolean(blocked || picked.error) || emptySamPatch || state.operationBusy;
  }

  function openBulkDialog() {
    if (state.operationBusy || anyBulkDialogOpen()) return;
    if (S.labelSel === "eye_lmk") {
      openEyeBulkDialog();
      return;
    }
    if (GENERIC_COPY_LABELS.has(S.labelSel)) {
      openGenericBulkDialog();
      return;
    }
    const context = currentClipContext() || emptyLabelBulkContext(S.labelSel);
    state.bulkMode = "mask";
    state.bulkContext = context;
    const dialog = ensureBulkDialog();
    dialog.querySelector(`input[name="nl-scope"][value="${patchMatchesContext(context) ? "patch" : "mask"}"]`).checked = true;
    updateBulkDialog();
    showBulkDialog(dialog);
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
    if (S.gen !== expectedGeneration) throw new Error("The session has changed");
    const [segmentIndex, frameIndex] = loc(g);
    const segment = S.sess.segments[segmentIndex];
    const key = rvKey(g);
    const items = [{ rle: { size: [S.sess.src_h, S.sess.src_w], counts: encodeRle(mask) } }];
    await requestJson("/api/label_edit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        bucket: S.sess.bucket,
        prefix: segPfx(segmentIndex),
        seg: segment.name,
        i: frameIndex,
        t: Math.round(S.ts[g] || 0),
        label: "seatbelt",
        items
      })
    });
    if (S.gen !== expectedGeneration) throw new Error("The session has changed");
    (S.ledits[key] = S.ledits[key] || {}).seatbelt = items;
    try { if (typeof _beltCache !== "undefined") _beltCache.delete(key); } catch (_) {}
    if (frameState(g) === "todo") await saveFrameState(g, "seatbelt", "wip", expectedGeneration);
  }

  async function getFrameEyeItems(g, expectedGeneration) {
    if (S.gen !== expectedGeneration) throw new Error("The session has changed");
    const key = rvKey(g);
    const saved = S.ledits?.[key]?.eye_lmk;
    if (saved) return cloneEyeItems(saved);
    const [segmentIndex, frameIndex] = loc(g);
    const autoLabel = await loadAutoLabel(segmentIndex);
    if (S.gen !== expectedGeneration) throw new Error("The session has changed");
    const frame = autoLabel?.frames?.[String(frameIndex)];
    return frame && typeof alBoxes === "function" ? cloneEyeItems(alBoxes(frame, "eye_lmk")) : [];
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
    if (S.gen !== expectedGeneration) throw new Error("The session has changed");
    const [segmentIndex, frameIndex] = loc(g);
    const segment = S.sess.segments[segmentIndex];
    const key = rvKey(g);
    const round = (value) => Math.round(Number(value) * 10) / 10;
    const savedItems = cloneEyeItems(items).map((item) => ({
      pts: item.pts.map((point) => point ? [round(point[0]), round(point[1])] : null),
      ...(item.closed ? { closed: true } : {})
    }));
    await requestJson("/api/label_edit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        bucket: S.sess.bucket,
        prefix: segPfx(segmentIndex),
        seg: segment.name,
        i: frameIndex,
        t: Math.round(S.ts[g] || 0),
        label: "eye_lmk",
        items: savedItems
      })
    });
    if (S.gen !== expectedGeneration) throw new Error("The session has changed");
    (S.ledits[key] = S.ledits[key] || {}).eye_lmk = savedItems;
    if (frameState(g) === "todo") await saveFrameState(g, "eye_lmk", "wip", expectedGeneration);
  }

  async function getFrameGenericItems(g, label, expectedGeneration) {
    if (S.gen !== expectedGeneration) throw new Error("The session has changed");
    const key = rvKey(g);
    const saved = S.ledits?.[key]?.[label];
    if (saved) return cloneGenericItems(saved);
    const [segmentIndex, frameIndex] = loc(g);
    const autoLabel = await loadAutoLabel(segmentIndex);
    if (S.gen !== expectedGeneration) throw new Error("The session has changed");
    const frame = autoLabel?.frames?.[String(frameIndex)];
    return frame && typeof alBoxes === "function" ? cloneGenericItems(alBoxes(frame, label)) : [];
  }

  async function saveFrameGenericItems(g, label, items, expectedGeneration) {
    if (S.gen !== expectedGeneration) throw new Error("The session has changed");
    const [segmentIndex, frameIndex] = loc(g);
    const segment = S.sess.segments[segmentIndex];
    const key = rvKey(g);
    const round = (value) => Math.round(Number(value) * 10) / 10;
    const savedItems = cloneGenericItems(items).map((item) => item.pts
      ? {
          pts: item.pts.map((point) => point ? [round(point[0]), round(point[1])] : null),
          ...(item.closed ? { closed: true } : {})
        }
      : { box: item.box.map(round), ...(item.cls ? { cls: item.cls } : {}) });
    await requestJson("/api/label_edit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        bucket: S.sess.bucket,
        prefix: segPfx(segmentIndex),
        seg: segment.name,
        i: frameIndex,
        t: Math.round(S.ts[g] || 0),
        label,
        items: savedItems
      })
    });
    if (S.gen !== expectedGeneration) throw new Error("The session has changed");
    (S.ledits[key] = S.ledits[key] || {})[label] = savedItems;
    scheduleBboxFilterRefresh();
    if (frameState(g) === "todo") await saveFrameState(g, label, "wip", expectedGeneration);
  }

  function sameGenericItem(left, right) {
    const a = cloneGenericItems([left])[0];
    const b = cloneGenericItems([right])[0];
    return !!a && !!b && JSON.stringify(a) === JSON.stringify(b);
  }

  function bboxIntersectionOverUnion(left, right) {
    if (!Array.isArray(left) || left.length < 4 || !Array.isArray(right) || right.length < 4) return 0;
    const a = left.slice(0, 4).map(Number);
    const b = right.slice(0, 4).map(Number);
    if (!a.every(Number.isFinite) || !b.every(Number.isFinite)) return 0;
    const ax1 = Math.min(a[0], a[2]);
    const ay1 = Math.min(a[1], a[3]);
    const ax2 = Math.max(a[0], a[2]);
    const ay2 = Math.max(a[1], a[3]);
    const bx1 = Math.min(b[0], b[2]);
    const by1 = Math.min(b[1], b[3]);
    const bx2 = Math.max(b[0], b[2]);
    const by2 = Math.max(b[1], b[3]);
    const intersection = Math.max(0, Math.min(ax2, bx2) - Math.max(ax1, bx1)) *
      Math.max(0, Math.min(ay2, by2) - Math.max(ay1, by1));
    const union = (ax2 - ax1) * (ay2 - ay1) + (bx2 - bx1) * (by2 - by1) - intersection;
    return union > 0 ? intersection / union : 0;
  }

  function bboxIntersectionOverSmaller(left, right) {
    if (!Array.isArray(left) || left.length < 4 || !Array.isArray(right) || right.length < 4) return 0;
    const a = left.slice(0, 4).map(Number);
    const b = right.slice(0, 4).map(Number);
    if (!a.every(Number.isFinite) || !b.every(Number.isFinite)) return 0;
    const ax1 = Math.min(a[0], a[2]);
    const ay1 = Math.min(a[1], a[3]);
    const ax2 = Math.max(a[0], a[2]);
    const ay2 = Math.max(a[1], a[3]);
    const bx1 = Math.min(b[0], b[2]);
    const by1 = Math.min(b[1], b[3]);
    const bx2 = Math.max(b[0], b[2]);
    const by2 = Math.max(b[1], b[3]);
    const intersection = Math.max(0, Math.min(ax2, bx2) - Math.max(ax1, bx1)) *
      Math.max(0, Math.min(ay2, by2) - Math.max(ay1, by1));
    const smallerArea = Math.min((ax2 - ax1) * (ay2 - ay1), (bx2 - bx1) * (by2 - by1));
    return smallerArea > 0 ? intersection / smallerArea : 0;
  }

  function bboxDimensionSimilarity(left, right) {
    if (!Array.isArray(left) || left.length < 4 || !Array.isArray(right) || right.length < 4) return null;
    const a = left.slice(0, 4).map(Number);
    const b = right.slice(0, 4).map(Number);
    if (!a.every(Number.isFinite) || !b.every(Number.isFinite)) return null;
    const widthA = Math.abs(a[2] - a[0]);
    const heightA = Math.abs(a[3] - a[1]);
    const widthB = Math.abs(b[2] - b[0]);
    const heightB = Math.abs(b[3] - b[1]);
    if (!widthA || !heightA || !widthB || !heightB) return null;
    const width = Math.min(widthA, widthB) / Math.max(widthA, widthB);
    const height = Math.min(heightA, heightB) / Math.max(heightA, heightB);
    return { min: Math.min(width, height), max: Math.max(width, height) };
  }

  function bboxCopyMatchScore(target, source) {
    if (target?.cls && source?.cls && target.cls !== source.cls) return 0;
    const size = bboxDimensionSimilarity(target?.box, source?.box);
    if (!size) return 0;
    const iou = bboxIntersectionOverUnion(target.box, source.box);
    if (iou >= BBOX_COPY_MATCH_IOU_THRESHOLD) return iou;
    const containment = bboxIntersectionOverSmaller(target.box, source.box);
    // A box can need a substantial correction along just one axis. Tiny boxes
    // that differ in both dimensions remain separate annotations.
    const similarSize = size.min >= BBOX_COPY_MATCH_SIZE_THRESHOLD ||
      (size.min >= BBOX_COPY_MATCH_NARROW_AXIS_THRESHOLD && size.max >= BBOX_COPY_MATCH_LONG_AXIS_THRESHOLD);
    return containment >= BBOX_COPY_MATCH_CONTAINMENT_THRESHOLD && similarSize ? iou : 0;
  }

  function findGenericBboxMatches(targetItems, candidates, sourceItems = []) {
    // Compare against the other source boxes before replacing anything. An
    // enclosing body can overlap the selected inner box yet belong to a much
    // better match in the source layout. Nearly coincident source duplicates
    // belong to the selected copy, so they must not protect old target boxes.
    // This grouping is separate from the 90% IoU threshold for red warnings.
    const otherSources = sourceItems.filter((item) => candidates.every((candidate) =>
      (item?.cls && candidate.cls && item.cls !== candidate.cls) ||
      bboxIntersectionOverUnion(item?.box, candidate.box) < BBOX_COPY_DUPLICATE_IOU_THRESHOLD));
    const matches = [];
    targetItems.forEach((item, index) => {
      const score = Math.max(0, ...candidates.map((candidate) => bboxCopyMatchScore(item, candidate)));
      if (!score || otherSources.some((other) => bboxCopyMatchScore(item, other) >= score - 1e-9)) return;
      matches.push({ index, score });
    });
    return matches;
  }

  function mergeCopiedGenericBbox(targetItems, sourceItem, sourceItems = []) {
    const nextItems = cloneGenericItems(targetItems);
    const added = cloneGenericItems([sourceItem])[0];
    if (!added) return nextItems;
    if (!Array.isArray(added.box)) {
      if (!nextItems.some((item) => sameGenericItem(item, added))) nextItems.push(added);
      return nextItems;
    }
    const matchingIndexes = findGenericBboxMatches(nextItems, [added], sourceItems).map((match) => match.index);
    if (!matchingIndexes.length) {
      nextItems.push(added);
      return nextItems;
    }
    const matched = new Set(matchingIndexes);
    const first = matchingIndexes[0];
    return nextItems.flatMap((item, index) => index === first ? [added] : matched.has(index) ? [] : [item]);
  }

  function eyeCenterX(item) {
    const points = item?.pts?.filter((point) => Array.isArray(point));
    return points?.length ? points.reduce((sum, point) => sum + point[0], 0) / points.length : Infinity;
  }

  function mergeEyeLandmarks(targetItems, sourceItems, context, scope) {
    const nextItems = cloneEyeItems(targetItems);
    const sourceOrder = context.sourceItems
      .map((item, index) => ({ index, x: eyeCenterX(item) }))
      .sort((left, right) => left.x - right.x)
      .map((entry) => entry.index);
    const targetOrder = nextItems
      .map((item, index) => ({ index, x: eyeCenterX(item) }))
      .sort((left, right) => left.x - right.x)
      .map((entry) => entry.index);
    const sourceIndexes = scope === "selected" ? context.selected : sourceOrder;
    for (const sourceIndex of sourceIndexes) {
      const source = context.sourceItems[sourceIndex];
      const copy = cloneEyeItems([source])[0];
      if (!copy) continue;
      const rank = sourceOrder.indexOf(sourceIndex);
      const targetIndex = targetOrder[rank];
      if (targetIndex === undefined) {
        if (!nextItems.some((existing) => sameEyeItem(existing, copy))) nextItems.push(copy);
      } else {
        nextItems[targetIndex] = copy;
      }
    }
    return nextItems;
  }

  async function applyEyeBulkCopy() {
    if (state.operationBusy || !pageLabelingReady("eye_lmk")) return;
    const context = state.eyeBulkContext;
    const picked = selectedEyeBulkTargets();
    if (!context || context.generation !== S.gen || picked.error) {
      updateEyeBulkDialog();
      return;
    }
    const targets = picked.targets.filter((g) => frameState(g) !== "done");
    if (!targets.length) {
      notify("All selected frames are Done");
      return;
    }
    const dialog = state.eyeBulkDialog;
    const preview = dialog.querySelector(".nl-preview");
    const apply = dialog.querySelector(".nl-apply");
    const scope = dialog.querySelector('input[name="nl-eye-scope"]:checked')?.value || "all";
    const writeMode = dialog.querySelector('input[name="nl-eye-write"]:checked')?.value || "merge";
    const sourceItems = scope === "selected"
      ? context.selected.map((index) => context.sourceItems[index]).filter(Boolean)
      : context.sourceItems;
    if (!sourceItems.length) {
      updateEyeBulkDialog();
      return;
    }
    state.operationBusy = true;
    apply.disabled = true;
    try {
      const result = await runQueue(targets, async (g) => {
        const currentItems = writeMode === "replace" ? [] : await getFrameEyeItems(g, context.generation);
        let nextItems;
        if (writeMode === "merge") {
          nextItems = mergeEyeLandmarks(currentItems, sourceItems, context, scope);
        } else {
          nextItems = cloneEyeItems(sourceItems);
        }
        await saveFrameEyeItems(g, nextItems, context.generation);
      }, (done, total) => {
        preview.classList.remove("err");
        preview.textContent = `Copying ${done}/${total} frames…`;
      }, 4);
      if (typeof fsRender === "function" && S.gen === context.generation) fsRender();
      if (typeof paint === "function" && S.gen === context.generation) paint();
      if (result.error) throw new Error(`saved ${result.completed}/${targets.length}: ${result.error.message}`);
      dialog.close();
      notify(`Copied ${sourceItems.length} eye 15pt groups to ${targets.length} frames. Drag inside the dashed box to move the entire eye.`);
    } catch (error) {
      preview.classList.add("err");
      preview.textContent = `Stopped on error: ${error.message}`;
    } finally {
      state.operationBusy = false;
      refreshStatusControls();
      if (apply.isConnected) apply.disabled = false;
    }
  }

  function applyItemBulkCopy() {
    if (state.bulkTab === "status") applyBulkStatus(state.eyeBulkDialog);
    else if (state.eyeBulkContext?.label === "eye_lmk") applyEyeBulkCopy();
    else applyGenericBulkCopy();
  }

  function applyQuickOperationToItems(items, operation, sourceItems = []) {
    const next = cloneGenericItems(items);
    const order = bboxHorizontalOrder(next);
    if (operation.type === "delete") {
      if (operation.selector === "all") return [];
      if (operation.selector === "region" && Array.isArray(operation.region)) {
        return next.filter((item) => {
          try { return !(Array.isArray(item?.box) && typeof boxInPoly === "function" && boxInPoly(item.box, operation.region)); }
          catch (_) { return true; }
        });
      }
      let rank = operation.selector === "left" ? 0 : operation.selector === "right" ? order.length - 1 : operation.rank;
      rank = Math.max(0, Math.min(order.length - 1, Number(rank)));
      if (order[rank]) next.splice(order[rank].index, 1);
      return next;
    }
    if (operation.type === "edge") {
      const coord = Number(operation.coord);
      const value = Number(operation.value);
      const width = Number(S.sess?.src_w) || 0;
      const height = Number(S.sess?.src_h) || 0;
      if (![0, 1, 2, 3].includes(coord) || !Number.isFinite(value) || !width || !height ||
          !bboxDimensionSimilarity(operation.originalBox, operation.currentBox)) return next;
      const source = sourceItems[operation.itemIndex] || {};
      const original = cloneGenericItems([{ ...source, box: operation.originalBox }])[0];
      const current = cloneGenericItems([{ ...source, box: operation.currentBox }])[0];
      // Edge adjustment edits an existing target box in place. It must never
      // copy the source box into a target frame: doing so changes the other
      // three coordinates and creates duplicates when boxes move between
      // frames. Prefer geometry, then use the same horizontal role when every
      // source box has a target counterpart.
      const matches = findGenericBboxMatches(next, [original, current], sourceItems);
      const best = matches.reduce((chosen, match) => !chosen || match.score > chosen.score ? match : chosen, null);
      let targetIndex = best?.index;
      if (targetIndex === undefined) {
        const selectedSource = sourceItems[operation.itemIndex];
        const compatible = (item) => !(selectedSource?.cls && item?.cls && selectedSource.cls !== item.cls);
        const sourceOrder = bboxHorizontalOrder(sourceItems).filter((entry) => compatible(sourceItems[entry.index]));
        const targetOrder = bboxHorizontalOrder(next).filter((entry) => compatible(next[entry.index]));
        const rank = sourceOrder.findIndex((entry) => entry.index === operation.itemIndex);
        if (rank >= 0 && sourceOrder.length === targetOrder.length && targetOrder[rank]) {
          targetIndex = targetOrder[rank].index;
        }
      }
      if (targetIndex === undefined || !next[targetIndex]?.box) return next;
      const target = next[targetIndex];
      target.box[coord] = value;
      if (coord === 0) target.box[0] = Math.max(0, Math.min(target.box[2] - 1, target.box[0]));
      if (coord === 1) target.box[1] = Math.max(0, Math.min(target.box[3] - 1, target.box[1]));
      if (coord === 2) target.box[2] = Math.min(width, Math.max(target.box[0] + 1, target.box[2]));
      if (coord === 3) target.box[3] = Math.min(height, Math.max(target.box[1] + 1, target.box[3]));
      return next;
    }
    return next;
  }

  async function applyGenericBulkCopy() {
    const context = state.eyeBulkContext;
    if (state.operationBusy || !context || !GENERIC_COPY_LABELS.has(context.label) ||
        !pageLabelingReady(context.label)) return;
    const picked = selectedEyeBulkTargets();
    if (context.generation !== S.gen || context.label !== S.labelSel || picked.error) {
      updateEyeBulkDialog();
      return;
    }
    const targets = picked.targets.filter((g) => frameState(g) !== "done");
    if (!targets.length) {
      notify("All selected frames are Done");
      return;
    }
    const dialog = state.eyeBulkDialog;
    const preview = dialog.querySelector(".nl-preview");
    const apply = dialog.querySelector(".nl-apply");
    const scope = dialog.querySelector('input[name="nl-eye-scope"]:checked')?.value || "all";
    const operation = context.operation;
    const operationMode = operation?.type === "delete" || operation?.type === "edge";
    const sourceItems = scope === "selected"
      ? context.selected.map((index) => context.sourceItems[index]).filter(Boolean)
      : context.sourceItems;
    if (!sourceItems.length && !operationMode) {
      updateEyeBulkDialog();
      return;
    }
    state.operationBusy = true;
    apply.disabled = true;
    try {
      const undoFrames = [];
      const result = await runQueue(targets, async (g) => {
        let nextItems;
        const currentItems = await getFrameGenericItems(g, context.label, context.generation);
        if (operationMode) {
          nextItems = applyQuickOperationToItems(currentItems, operation, context.sourceItems);
        } else if (scope === "selected") {
          const added = cloneGenericItems(sourceItems)[0];
          nextItems = mergeCopiedGenericBbox(currentItems, added, context.sourceItems);
        } else {
          nextItems = cloneGenericItems(sourceItems);
        }
        if (JSON.stringify(nextItems) === JSON.stringify(currentItems)) return;
        undoFrames.push({ g, items: cloneGenericItems(currentItems) });
        await saveFrameGenericItems(g, context.label, nextItems, context.generation);
      }, (done, total) => {
        preview.classList.remove("err");
        preview.textContent = `Copying ${done}/${total} frames…`;
      }, 4);
      if (typeof fsRender === "function" && S.gen === context.generation) fsRender();
      if (typeof paint === "function" && S.gen === context.generation) paint();
      if ((QUICK_BBOX_LABELS.has(context.label) || operation?.type === "edge") && undoFrames.length) {
        rememberBboxUndo(undoFrames, true);
      }
      if (result.error) throw new Error(`saved ${result.completed}/${targets.length}: ${result.error.message}`);
      dialog.close();
      notify(operation?.type === "delete"
        ? `Deleted ${context.labelName} boxes across ${targets.length} frames`
        : operation?.type === "edge"
          ? `Adjusted the ${operation.edge} ${context.labelName} edge across ${targets.length} frames`
          : `Copied ${sourceItems.length} ${context.labelName} objects to ${targets.length} frames`);
    } catch (error) {
      preview.classList.add("err");
      preview.textContent = `Stopped on error: ${error.message}`;
    } finally {
      state.operationBusy = false;
      refreshStatusControls();
      if (apply.isConnected) apply.disabled = false;
    }
  }

  function applyBulkAction() {
    if (state.bulkTab === "status") applyBulkStatus(state.bulkDialog);
    else applyBulkCopy();
  }

  async function applyBulkCopy() {
    if (state.operationBusy || !pageLabelingReady("seatbelt")) return;
    const context = state.bulkContext;
    const picked = selectedBulkTargets();
    if (!context || picked.error || maskBulkBlockReason()) {
      updateBulkDialog();
      return;
    }
    const targets = picked.targets.filter((g) => frameState(g) !== "done");
    if (!targets.length) {
      notify("All selected frames are Done");
      return;
    }

    const dialog = state.bulkDialog;
    const preview = dialog.querySelector(".nl-preview");
    const apply = dialog.querySelector(".nl-apply");
    const scope = dialog.querySelector('input[name="nl-scope"]:checked')?.value || "mask";
    state.operationBusy = true;
    apply.disabled = true;

    try {
      let sourceMask;
      let operation = "add";
      if (scope === "patch" && patchMatchesContext(context)) {
        sourceMask = state.lastPatch.mask.slice();
        operation = state.lastPatch.operation;
      } else {
        sourceMask = await getFrameMask(context.source, context.generation);
      }
      let hasPixels = false;
      for (const value of sourceMask) if (value) { hasPixels = true; break; }
      if (!hasPixels) throw new Error(scope === "patch" ? "The latest edit has no pixels to apply" : "The source frame has no mask to apply");

      const result = await runQueue(targets, async (g) => {
        const targetMask = await getFrameMask(g, context.generation);
        for (let index = 0; index < targetMask.length; index += 1) {
          if (!sourceMask[index]) continue;
          targetMask[index] = operation === "subtract" ? 0 : 1;
        }
        await saveFrameMask(g, targetMask, context.generation);
      }, (done, total) => {
        preview.classList.remove("err");
        preview.textContent = `Saving ${done}/${total} frames…`;
      }, 4);

      if (typeof fsRender === "function" && S.gen === context.generation) fsRender();
      if (typeof paint === "function" && S.gen === context.generation) paint();
      if (result.error) throw new Error(`saved ${result.completed}/${targets.length}: ${result.error.message}`);
      dialog.close();
      notify(`${operation === "subtract" ? "Erased the seatbelt region on" : "Applied the mask to"} ${targets.length} frames in ${context.clip}`);
    } catch (error) {
      preview.classList.add("err");
      preview.textContent = `Stopped on error: ${error.message}`;
    } finally {
      state.operationBusy = false;
      refreshStatusControls();
      if (apply.isConnected) apply.disabled = false;
    }
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
    const scale = canvas.width / BT.W;
    const unit = typeof pxK === "function" ? pxK() : canvas.width / canvas.getBoundingClientRect().width;
    const subtract = state.manualMode === "subtract";
    ctx.save();
    ctx.setLineDash([]);
    ctx.strokeStyle = subtract ? "#ff4d5a" : "#39ff88";
    ctx.fillStyle = subtract ? "rgba(255,77,90,.22)" : "rgba(57,255,136,.16)";
    ctx.lineWidth = 2 * unit;
    ctx.beginPath();
    points.forEach(([x, y], index) => ctx[index ? "lineTo" : "moveTo"](x * scale, y * scale));
    if (points.length >= 3) ctx.closePath();
    if (points.length >= 3) ctx.fill();
    ctx.stroke();
    if (draft.length && typeof ED !== "undefined" && ED.mouse) {
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
      ctx.fillStyle = subtract ? "#ff4d5a" : "#39ff88";
      ctx.fill();
    }
    ctx.restore();
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

  function onViewContextMenu(event) {
    if (state.bboxMode === "delete" && bboxDeleteTarget(event)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      commitBboxDeletePolygon();
      return;
    }
    if (state.manualMode && event.target === document.getElementById("view")) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }

  function anyBulkDialogOpen() {
    return Boolean(state.bulkDialog?.open || state.eyeBulkDialog?.open);
  }

  function onGlobalKeyDown(event) {
    const target = event.target;
    if (event.code === "Escape" && state.clipStatusMenu) {
      event.preventDefault();
      event.stopImmediatePropagation();
      closeClipStatusMenu(true);
      return;
    }
    if (target?.closest?.("#nl-clip-status-menu, .nl-clip-status-actions, #nl-status-filters")) return;
    const typing = target?.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target?.tagName || "");
    if (event.code === "KeyR" && !event.ctrlKey && !event.metaKey && !event.altKey && !typing) {
      const pendingSam = samAcceptAvailable() && (BT.prev || BT.busy || BT.points.length);
      if (anyBulkDialogOpen() || state.samAcceptHeld || pendingSam) {
        // R confirms SAM once; held-key repeats cannot create another edit.
        // F and Space remain entirely with the page's native handlers.
        event.preventDefault();
        event.stopImmediatePropagation();
        if (!anyBulkDialogOpen()) {
          state.samAcceptHeld = true;
          if (!event.repeat) acceptSamPreview();
        }
        return;
      }
      if (!event.shiftKey && bboxLabelingReady()) {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (!event.repeat && !event.isComposing && !state.operationBusy && bboxEditingAvailable() &&
            !(typeof RV_OPEN !== "undefined" && RV_OPEN) && !ED.drag && !ED.marq &&
            ED.lab === S.labelSel && typeof rvKey === "function" && ED.key === rvKey(S.shownG)) {
          // Use the native Delete handler so selection, saving and status updates
          // behave exactly like Delete, including multiple selected boxes.
          target.dispatchEvent(new KeyboardEvent("keydown", {
            key: "Delete", code: "Delete", bubbles: true, cancelable: true
          }));
        }
        return;
      }
    }
    // Handle Escape before the page's input listener blurs the count field.
    // Cancellation discards the region; a successful Apply keeps it reusable.
    if (event.code === "Escape" && anyBulkDialogOpen()) {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (state.eyeBulkDialog?.open) cancelEyeBulkDialog();
      else cancelBulkDialog();
      return;
    }
    if (event.code === "Escape" && state.bboxMode && !typing) {
      event.preventDefault();
      event.stopImmediatePropagation();
      cancelBboxMode();
      return;
    }
    if (event.code === "KeyZ" && !event.altKey && !event.shiftKey && !typing &&
        !anyBulkDialogOpen() && bboxLabelingReady()) {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (!event.repeat) undoQuickBbox();
      return;
    }
    if (event.code === "KeyZ" && !event.altKey && !event.shiftKey && !typing &&
        !anyBulkDialogOpen() && pageLabelingReady("seatbelt")) {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (!event.repeat) undoSeatbelt();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && !typing &&
        !anyBulkDialogOpen() && quickBboxReady() && (event.code === "KeyC" || event.code === "KeyV")) {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (!event.repeat) {
        if (event.code === "KeyC") copyQuickBboxToClipboard();
        else pasteQuickBboxFromClipboard();
      }
      return;
    }
    if (!event.ctrlKey && !event.metaKey && !event.altKey && !typing && !anyBulkDialogOpen() &&
        quickBboxReady() && event.code === "KeyX") {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (!event.repeat) deleteQuickBbox("all", event.shiftKey);
      return;
    }
    if (!event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey && !typing &&
        !anyBulkDialogOpen() && quickBboxReady() && (event.code === "Digit1" || event.code === "Numpad1" ||
          event.code === "Digit2" || event.code === "Numpad2")) {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (!event.repeat) deleteQuickBbox(event.code.endsWith("1") ? "left" : "right");
      return;
    }
    if (!event.ctrlKey && !event.metaKey && !event.altKey && !typing && !anyBulkDialogOpen() &&
        quickBboxReady() && event.code === "KeyC") {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (!event.repeat && !event.isComposing) copyPreviousQuickBbox(event.shiftKey);
      return;
    }
    if (event.code === "Escape" && (state.manualMode || state.lastPatch) && !typing) {
      event.preventDefault();
      event.stopImmediatePropagation();
      cancelManualMode();
      return;
    }
    if (!event.ctrlKey && !event.metaKey && !event.altKey && !typing && !anyBulkDialogOpen() &&
        (event.code === "KeyA" || event.code === "KeyD") && pageLabelingReady()) {
      event.preventDefault();
      event.stopImmediatePropagation();
      navigateOrganizedFrames(event.code === "KeyA" ? -1 : 1, event.shiftKey ? 10 : 1);
      return;
    }
    if (event.code === "KeyV" && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey &&
        !typing && pageLabelingReady() && !anyBulkDialogOpen()) {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (!event.repeat) toggleMarkedFrame();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.code === "KeyB" &&
        !typing && pageLabelingReady() &&
        (S.labelSel === "seatbelt" || S.labelSel === "eye_lmk" || GENERIC_COPY_LABELS.has(S.labelSel) ||
          (markedScopeMatches() && state.markedFrames.size))) {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (!event.repeat) openBulkDialog();
      return;
    }
    if (!event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey && !typing &&
        !anyBulkDialogOpen() && (event.code === "KeyN" || event.code === "KeyM") && bboxLabelingReady()) {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (!event.repeat) setBboxMode(event.code === "KeyN" ? "create" : "delete");
      return;
    }
    if (!event.ctrlKey && !event.metaKey && !event.altKey &&
        (event.code === "KeyN" || (event.code === "KeyM" && !event.shiftKey)) && !typing &&
        pageLabelingReady("seatbelt") && !anyBulkDialogOpen()) {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (!event.repeat) setManualMode(event.code === "KeyM" || event.shiftKey ? "subtract" : "add");
    }
  }

  function onGlobalKeyUp(event) {
    if (event.code === "KeyR") state.samAcceptHeld = false;
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

  function restoreNativeGroups() {
    if (!state.list) return;
    clearTimeout(state.bboxRefreshTimer);
    state.bboxRefreshTimer = 0;
    if (state.bboxActive) state.bboxRevision += 1;
    state.bboxActive = false;
    state.bboxHiddenApplied = false;
    cancelBboxLoads();
    state.applying = true;
    try {
      for (const row of state.list.querySelectorAll(":scope > .grp.nl-organized")) {
        const clips = row.querySelector(":scope > .nl-clips");
        if (!clips) continue;
        const ul = document.createElement("ul");
        for (const li of clips.querySelectorAll("li")) {
          li.querySelectorAll(".nl-checkpoint").forEach((marker) => marker.remove());
          li.querySelectorAll(".nl-frame-mark").forEach((marker) => marker.remove());
          li.classList.remove("nl-marked-frame");
          li.hidden = false;
          ul.appendChild(li);
        }
        clips.replaceWith(ul);
        const label = row.querySelector(":scope > .vlab");
        if (label) label.textContent = row.dataset.partName;
        row.classList.remove("nl-organized");
        delete row.dataset.partName;
        row.hidden = false;
      }
    } finally {
      state.observer?.takeRecords();
      state.applying = false;
    }
  }

  function ensureCurrentClipOpen(current = state.list?.querySelector("li.cur")) {
    const details = current?.closest(".nl-clip") || null;
    if (state.currentClip !== details) {
      state.currentClip?.classList.remove("nl-current");
      details?.classList.add("nl-current");
      state.currentClip = details;
    }
    if (details && !details.open && !state.manuallyClosedClips.has(details.dataset.key)) {
      details.open = true;
      state.openClips.add(details.dataset.key);
    }
  }

  function bboxFilterSupported() {
    return pageLabelingReady() && BBOX_LABELS.has(S.labelSel);
  }

  // Count state for the current session/generation/label. Auto-labels do not
  // change within a scope, so their per-frame counts are computed only once.
  function bboxCountCache() {
    const cache = state.bboxCounts;
    if (cache && cache.session === S.sess && cache.generation === S.gen && cache.label === S.labelSel) return cache;
    state.bboxCounts = {
      session: S.sess, generation: S.gen, label: S.labelSel,
      auto: new Map(), // g -> auto-label box count
      empty: new Set(), // segments without auto-labels
      failed: new Set() // segments whose auto-labels could not be read
    };
    return state.bboxCounts;
  }

  function countValidBoxes(items) {
    if (!Array.isArray(items)) return 0;
    let count = 0;
    for (const item of items) {
      if (Array.isArray(item?.box) && item.box.length >= 4 &&
          item.box.slice(0, 4).every((value) => Number.isFinite(Number(value)))) count += 1;
    }
    return count;
  }

  function frameSegment(g) {
    try { return loc(g)[0]; } catch (_) { return null; }
  }

  // Box count of frame g, or null until its segment's auto-labels are read.
  // A saved edit, including an explicit empty list, wins over auto-labels.
  function bboxCountForFrame(g, cache) {
    try {
      const edited = S.ledits?.[rvKey(g)]?.[cache.label];
      if (Array.isArray(edited)) return countValidBoxes(edited);
      const known = cache.auto.get(g);
      if (known !== undefined) return known;
      const [segmentIndex, frameIndex] = loc(g);
      const data = S.al?.get(segmentIndex);
      if (!data || data instanceof Promise) return cache.empty.has(segmentIndex) ? 0 : null;
      const frame = data.frames?.[String(frameIndex)];
      const count = frame && typeof alBoxes === "function" ? countValidBoxes(alBoxes(frame, cache.label)) : 0;
      cache.auto.set(g, count);
      return count;
    } catch (_) {
      return null;
    }
  }

  // preload.js contract: true = fetch the image, false = filtered out,
  // null = count still loading. Unreadable counts stay visible, so fetch them.
  function bboxFilterWants(g) {
    if (!state.bboxActive) return true;
    const cache = state.bboxCounts;
    if (!cache || cache.session !== S.sess || cache.generation !== S.gen || cache.label !== S.labelSel) return null;
    const count = bboxCountForFrame(g, cache);
    if (count !== null) return state.bboxFilter.includes(count);
    const segment = frameSegment(g);
    if (cache.failed.has(segment)) return true;
    if (segment !== null) requestExtraBboxSegment(cache, segment);
    return null;
  }

  function bboxLoadFor(cache) {
    if (state.bboxLoad?.cache !== cache) {
      state.bboxLoad = { cache, queue: [], extra: new Set(), started: new Set(), running: 0, completed: 0 };
    }
    return state.bboxLoad;
  }

  // Each filter pass replaces the queue, so loading follows the current frame
  // and part search. Segments already requested in this scope are not repeated.
  function requestBboxSegments(cache, order) {
    const load = bboxLoadFor(cache);
    load.queue = [...new Set([...order, ...load.extra])].filter((segment) => !load.started.has(segment));
    pumpBboxLoads(load);
  }

  // The preloader also needs counts for frames outside the listed rows (parts
  // hidden by search, Done rows hidden natively). Load them after listed rows.
  function requestExtraBboxSegment(cache, segment) {
    const load = bboxLoadFor(cache);
    if (load.extra.has(segment) || load.started.has(segment)) return;
    load.extra.add(segment);
    load.queue.push(segment);
    pumpBboxLoads(load);
  }

  function pumpBboxLoads(load) {
    while (state.bboxLoad === load && load.running < BBOX_COUNT_PARALLEL && load.queue.length) {
      const segment = load.queue.shift();
      load.started.add(segment);
      load.running += 1;
      loadAutoLabel(segment).catch((error) => {
        console.warn("[NOTA Labeling Organizer] Could not load BBox counts for segment", segment, error);
      }).then(() => {
        const { cache } = load;
        const data = S.al?.get(segment);
        if (cache.session !== S.sess || cache.generation !== S.gen || (data && !(data instanceof Promise))) return;
        (S.sess.segments?.[segment]?.al ? cache.failed : cache.empty).add(segment);
      }).finally(() => {
        load.running -= 1;
        load.completed += 1;
        if (state.bboxLoad !== load) return;
        scheduleBboxFilterRefresh();
        pumpBboxLoads(load);
      });
    }
  }

  function cancelBboxLoads() {
    if (state.bboxLoad) state.bboxLoad.queue = [];
    state.bboxLoad = null;
  }

  // Throttled rather than debounced, so a stream of loaded segments or saves
  // still updates the list every BBOX_REFRESH_MS.
  function scheduleBboxFilterRefresh() {
    if (state.bboxRefreshTimer || !state.bboxActive) return;
    state.bboxRefreshTimer = setTimeout(refreshBboxFilter, BBOX_REFRESH_MS);
  }

  function refreshBboxFilter() {
    state.bboxRefreshTimer = 0;
    if (!pageLabelingReady()) return;
    const position = captureSidebarPosition();
    state.applying = true;
    try {
      applyFilter();
      if (position) restoreSidebarPosition(position);
    } finally {
      state.observer?.takeRecords();
      state.applying = false;
    }
  }

  function applyFilter() {
    state.navigation = null;
    if (!state.list || !state.status) return;
    const query = normalize(state.filter);
    const rows = Array.from(state.list.querySelectorAll(":scope > .grp"));
    const supported = bboxFilterSupported();
    const active = supported && state.bboxFilter.length > 0;
    if (active || state.bboxActive) state.bboxRevision += 1;
    state.bboxActive = active;
    // Frame rows are visited only while the BBox filter applies, plus one pass to unhide them.
    const touchFrames = active || state.bboxHiddenApplied;
    state.bboxHiddenApplied = active;
    const cache = active ? bboxCountCache() : null;
    let visible = 0;
    let totalFrames = 0;
    let visibleFrames = 0;
    let unknownFrames = 0;
    // Segments with unknown counts in list order, split at the current frame.
    const queued = new Set();
    const behind = [];
    const ahead = [];
    let passedCurrent = false;
    let currentSegment = null;

    for (const row of rows) {
      const partName = row.dataset.partName || row.querySelector(":scope > .vlab")?.textContent || "";
      const matched = !query || normalize(partName).includes(query);
      let partVisible = !active;
      if (touchFrames && (matched || !active)) {
        const clips = row.querySelectorAll(":scope > .nl-clips > .nl-clip");
        if (!clips.length) partVisible = true;
        for (const clip of clips) {
          let clipVisible = false;
          for (const li of clip.querySelectorAll("li[data-g]")) {
            let keep = true;
            if (active) {
              const g = Number(li.dataset.g);
              const isCurrent = li.classList.contains("cur");
              if (isCurrent) passedCurrent = true;
              const count = bboxCountForFrame(g, cache);
              totalFrames += 1;
              if (count === null) {
                unknownFrames += 1;
                const segment = frameSegment(g);
                if (isCurrent) currentSegment = segment;
                if (segment !== null && !cache.failed.has(segment) && !queued.has(segment)) {
                  queued.add(segment);
                  (passedCurrent ? ahead : behind).push(segment);
                }
              } else {
                keep = state.bboxFilter.includes(count);
              }
              if (keep) visibleFrames += 1;
            }
            if (li.hidden === keep) li.hidden = !keep;
            if (keep) clipVisible = true;
          }
          if (clip.hidden === clipVisible) clip.hidden = !clipVisible;
          if (clipVisible) partVisible = true;
        }
      }
      const hidePart = !matched || !partVisible;
      if (row.hidden !== hidePart) row.hidden = hidePart;
      if (!hidePart) visible += 1;
    }

    if (active) {
      const order = currentSegment !== null && behind.includes(currentSegment)
        ? [currentSegment, ...ahead, ...behind.filter((segment) => segment !== currentSegment)]
        : [...ahead, ...behind];
      requestBboxSegments(cache, order);
    } else {
      cancelBboxLoads();
    }

    const caption = query || active ? `${visible}/${rows.length} part` : `${rows.length} part`;
    if (state.status.textContent !== caption) state.status.textContent = caption;

    const invalid = state.bboxInput.getAttribute("aria-invalid") === "true";
    state.bboxInput.disabled = !supported;
    state.bboxAllButton.disabled = !supported;
    state.bboxAllButton.setAttribute("aria-pressed", String(!state.bboxFilter.length));
    const load = state.bboxLoad;
    const pending = load ? load.queue.length + load.running : 0;
    const bboxCaption = !supported ? "Unavailable for this label" : invalid ? "Use 2,3,4" : !active ? "" :
      `${visibleFrames}/${totalFrames} frames` +
      (pending ? ` · loading ${load.completed}/${load.completed + pending}` :
        unknownFrames ? ` · ${unknownFrames} unknown` : "");
    if (state.bboxStatus.textContent !== bboxCaption) state.bboxStatus.textContent = bboxCaption;
    state.bboxStatus.title = bboxCaption;

    if (!state.empty) {
      state.empty = document.createElement("div");
      state.empty.className = "nl-empty-filter";
    }
    const emptyMessage = active ? "No frames match the BBox filter." : "No matching parts.";
    if (state.empty.textContent !== emptyMessage) state.empty.textContent = emptyMessage;
    const shouldShowEmpty = Boolean((query || active) && rows.length && !visible);
    if (shouldShowEmpty && !state.empty.isConnected) state.list.prepend(state.empty);
    else if (!shouldShowEmpty && state.empty.isConnected) state.empty.remove();
  }

  function enhance() {
    state.scheduled = false;
    state.navigation = null;
    state.partIndex = null;
    if (!state.list || !state.list.isConnected) return;
    ensureTimelineLock();

    if (!isLabelingMode()) {
      closeClipStatusMenu();
      state.sidebarScope = null;
      if (state.toolbar) state.toolbar.hidden = true;
      if (state.markedBadge) state.markedBadge.hidden = true;
      if (state.manualMode || state.lastPatch) cancelManualMode();
      restoreNativeGroups();
      return;
    }

    state.toolbar.hidden = false;
    ensureSidebarRendering();
    ensureStatusRendering();
    if (ensureStatusFilters() && statusFilterRestricted()) {
      buildSeq();
      renderLabList();
      followFilteredFrame();
      return;
    }
    if (state.clipStatusMenu && (!state.clipStatusMenu.details.isConnected ||
        !partStatusMatches(state.clipScopes.get(state.clipStatusMenu.details)))) closeClipStatusMenu();
    ensureOrganizedPlayback();
    ensureNativeEditing();
    ensureBboxEditing();
    ensureLabelVisibility();
    ensureEyeGroupDragging();
    ensureEyeTransformDrawing();
    ensureEyePanelHint();
    ensurePolygonDrawing();
    ensurePointerPerformance();
    ensureZoomPerformance();
    ensurePolygonTools();
    if (!pageLabelingReady("seatbelt") && (state.manualMode || state.lastPatch)) cancelManualMode();
    if (state.bboxMode && !bboxLabelingReady()) cancelBboxMode();
    state.applying = true;
    try {
      for (const row of state.list.querySelectorAll(":scope > .grp")) organizeGroup(row);
      refreshStatusControls();
      ensureCurrentClipOpen();
      applyFilter();
      updateMarkedUI();
      state.sidebarScope = typeof S !== "undefined" ? { generation: S.gen, label: S.labelSel } : null;
    } finally {
      // MutationObserver callbacks run after this function returns. Clear the
      // records produced by our own grouping/status UI to prevent a RAF loop.
      state.observer?.takeRecords();
      state.applying = false;
    }
  }

  function scheduleEnhance() {
    if (state.scheduled) return;
    state.scheduled = true;
    requestAnimationFrame(enhance);
  }

  function install() {
    state.pane = document.getElementById("labPane");
    state.list = document.getElementById("labList");
    if (!state.pane || !state.list || document.getElementById(ROOT_ID)) return false;

    injectStyle();
    ensureTimelineLock();
    state.toolbar = buildToolbar();
    state.list.before(state.toolbar);
    // The image-loading controls can wrap or appear after the toolbar mounts.
    // Keep clip controls below its actual height, including after sidebar resize.
    const syncToolbarHeight = () => {
      state.pane.style.setProperty("--nl-toolbar-height", `${state.toolbar.getBoundingClientRect().height}px`);
    };
    state.toolbarObserver = new ResizeObserver(syncToolbarHeight);
    state.toolbarObserver.observe(state.toolbar);
    syncToolbarHeight();
    buildMarkedBadge();
    ensureSidebarRendering();
    ensureStatusRendering();
    ensureOrganizedPlayback();
    ensureNativeEditing();
    ensureBboxEditing();
    ensureLabelVisibility();
    ensureEyeGroupDragging();
    ensureEyeTransformDrawing();
    ensureEyePanelHint();
    ensurePolygonDrawing();
    ensurePointerPerformance();
    ensureZoomPerformance();
    ensurePolygonTools();
    ensureBulkDialog();
    ensureEyeBulkDialog();
    window[BBOX_FILTER_API] = {
      get revision() { return state.bboxRevision; },
      wants: bboxFilterWants
    };

    window.addEventListener("keydown", onGlobalKeyDown, true);
    window.addEventListener("pointerdown", (event) => {
      const menu = state.clipStatusMenu;
      if (menu && !menu.element.contains(event.target) && !menu.button.contains(event.target)) closeClipStatusMenu();
    }, true);
    window.addEventListener("scroll", (event) => {
      if (!state.clipStatusMenu?.element.contains(event.target)) closeClipStatusMenu();
    }, true);
    window.addEventListener("resize", () => closeClipStatusMenu());
    window.addEventListener("keyup", onGlobalKeyUp, true);
    window.addEventListener("mouseup", onBboxMouseUp, true);
    window.addEventListener("blur", () => { state.samAcceptHeld = false; });
    window.addEventListener("resize", positionMarkedBadge);
    window.addEventListener("scroll", positionMarkedBadge, true);
    window.addEventListener("mousemove", onBboxMouseMove, true);
    window.addEventListener("mousemove", onManualMouseMove, true);
    window.addEventListener("pointerdown", onBboxPointerDown, true);
    window.addEventListener("lostpointercapture", releaseBboxPointer, true);
    window.addEventListener("pointercancel", releaseBboxPointer, true);
    window.addEventListener("blur", releaseBboxPointer);
    window.addEventListener("mousedown", onBboxMouseDown, true);
    window.addEventListener("mousedown", onManualMouseDown, true);
    window.addEventListener("contextmenu", onViewContextMenu, true);
    window.addEventListener("dblclick", onBboxEdgeDoubleClick, true);

    state.observer = new MutationObserver((mutations) => {
      if (state.applying) return;
      const relevant = mutations.some((mutation) => {
        const target = mutation.target.nodeType === Node.ELEMENT_NODE ? mutation.target : mutation.target.parentElement;
        if (target?.closest(".nl-part-tools")) return false;
        if (mutation.type === "childList") return true;
        if (mutation.type === "characterData") return true;
        if (mutation.type !== "attributes" || mutation.attributeName !== "class") return false;
        // Frame highlighting changes on every paint. It must not regroup the
        // whole sidebar or refresh every clip's status during playback.
        const stableClasses = (value) => String(value || "").split(/\s+/)
          .filter((name) => name && name !== "cur" && name !== "nl-current").sort().join(" ");
        return stableClasses(mutation.oldValue) !== stableClasses(mutation.target.className);
      });
      if (relevant) { state.navigation = null; scheduleEnhance(); }
    });
    state.observer.observe(state.list, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeOldValue: true,
      attributeFilter: ["class"]
    });
    const title = document.getElementById("labTitle");
    if (title) state.observer.observe(title, { childList: true, subtree: true, characterData: true });

    scheduleEnhance();
    console.info(`[NOTA Labeling Organizer] v${VERSION} is active.`);
    return true;
  }

  if (!install()) {
    const bootObserver = new MutationObserver(() => {
      if (install()) bootObserver.disconnect();
    });
    bootObserver.observe(document.documentElement, { childList: true, subtree: true });
  }
})();
