(() => {
  "use strict";

  const NL = window.__notaOrganizerV1 = window.__notaOrganizerV1 || {};
  const {
    anyBulkDialogOpen, cloneGenericItems, currentLabelScope, getFrameGenericItems,
    navigateOrganizedFrames, notify, pageLabelingReady, refreshStatusControls,
    saveFrameGenericItems, sessionLabelFrames, state
  } = NL;

  function faceLandmarkActive() {
    try {
      return pageLabelingReady("face_lmk") && typeof lmkActive === "function" && lmkActive();
    } catch (_) { return false; }
  }

  function faceShortcutReady() {
    try {
      return faceLandmarkActive() && !state.operationBusy && !anyBulkDialogOpen() &&
        !(typeof RV_OPEN !== "undefined" && RV_OPEN) &&
        typeof ED !== "undefined" && typeof LM !== "undefined" &&
        ED.lab === "face_lmk" && ED.key === rvKey(S.shownG) &&
        Number(S.g) === Number(S.shownG) && Array.isArray(ED.items) &&
        !ED.drag && !ED.marq && !LM.drag && !LM.marq;
    } catch (_) { return false; }
  }

  function faceSnapshot() {
    return { ...currentLabelScope(), g: Number(S.shownG), key: ED.key,
      items: cloneGenericItems(ED.items) };
  }

  function faceSnapshotMatches(snapshot) {
    return Boolean(snapshot && snapshot.session === S.sess && snapshot.generation === S.gen &&
      snapshot.label === "face_lmk" && snapshot.g === Number(S.shownG) && snapshot.key === ED.key);
  }

  function rememberFaceUndo(snapshot) {
    if (!faceSnapshotMatches(snapshot) ||
        JSON.stringify(snapshot.items) === JSON.stringify(cloneGenericItems(ED.items))) return;
    state.faceUndo.push(snapshot);
    if (state.faceUndo.length > 30) state.faceUndo.splice(0, state.faceUndo.length - 30);
  }

  // Positions follow the native face 7pt reference image (left/right are
  // screen coordinates). The dragged rectangle is only a placement guide;
  // the saved annotation is still seven independently editable points.
  const FACE_TEMPLATE = [
    [58.7 / 260, 143.3 / 280], [103.3 / 260, 147 / 280],
    [157.7 / 260, 147.5 / 280], [201.1 / 260, 143.3 / 280],
    [87.5 / 260, 212.8 / 280], [174 / 260, 212 / 280],
    [123.9 / 260, 201.5 / 280]
  ];
  const FACE_COLORS = ["#ff3cff", "#ff3cff", "#ff3cff", "#ff3cff",
    "#00e5ff", "#00e5ff", "#ff8c1a"];

  function faceCreateStillHere() {
    const scope = state.faceCreateScope;
    return Boolean(scope && faceShortcutReady() && scope.session === S.sess &&
      scope.generation === S.gen && scope.key === ED.key && scope.g === Number(S.shownG));
  }

  function faceCreatePoint(event) {
    const canvas = document.getElementById("view");
    const rect = canvas?.getBoundingClientRect();
    const width = Number(S.sess?.src_w), height = Number(S.sess?.src_h);
    if (!rect?.width || !rect.height || !width || !height) return null;
    const x = Math.max(0, Math.min(width, (event.clientX - rect.left) * width / rect.width));
    const y = Math.max(0, Math.min(height, (event.clientY - rect.top) * height / rect.height));
    return { x, y, rect, width, height };
  }

  function faceCreateBounds(draft) {
    return [Math.min(draft.start.x, draft.end.x), Math.min(draft.start.y, draft.end.y),
      Math.max(draft.start.x, draft.end.x), Math.max(draft.start.y, draft.end.y)];
  }

  function faceCreatePoints(bounds) {
    const [left, top, right, bottom] = bounds;
    const round = (value) => Math.round(value * 10) / 10;
    return FACE_TEMPLATE.map(([x, y]) => [round(left + x * (right - left)),
      round(top + y * (bottom - top))]);
  }

  function drawFaceCreatePreview() {
    const draft = state.faceCreateDraft;
    if (!draft || !faceCreateStillHere() || typeof ctx === "undefined") return;
    const [left, top, right, bottom] = faceCreateBounds(draft);
    const scale = view.width / draft.start.width;
    const unit = typeof pxK === "function" ? pxK() : 1;
    const points = faceCreatePoints([left, top, right, bottom]);
    ctx.save();
    ctx.setLineDash([6 * unit, 4 * unit]);
    ctx.strokeStyle = "#ffea00";
    ctx.lineWidth = 1.5 * unit;
    ctx.strokeRect(left * scale, top * scale, (right - left) * scale, (bottom - top) * scale);
    ctx.setLineDash([]);
    ctx.font = `700 ${11 * unit}px Consolas, monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    points.forEach(([x, y], index) => {
      const px = x * scale, py = y * scale;
      ctx.beginPath();
      ctx.arc(px, py, 4 * unit, 0, Math.PI * 2);
      ctx.fillStyle = FACE_COLORS[index];
      ctx.fill();
      ctx.strokeStyle = "#111";
      ctx.lineWidth = unit;
      ctx.stroke();
      ctx.fillStyle = "#111";
      ctx.fillRect(px - 5 * unit, py + 5 * unit, 10 * unit, 12 * unit);
      ctx.fillStyle = FACE_COLORS[index];
      ctx.fillText(String(index), px, py + 11 * unit);
    });
    ctx.restore();
  }

  function cancelFaceCreate(repaint = true) {
    state.faceCreateMode = false;
    state.faceCreateDraft = null;
    state.faceCreateScope = null;
    const canvas = document.getElementById("view");
    if (canvas) canvas.style.cursor = "";
    if (repaint && typeof edRepaint === "function") edRepaint();
  }

  function setFaceCreateMode() {
    if (state.faceCreateMode && !faceCreateStillHere()) cancelFaceCreate(false);
    if (state.faceCreateMode) {
      cancelFaceCreate();
      notify("Face 7pt creation cancelled");
      return;
    }
    if (!faceShortcutReady()) return;
    state.faceCreateMode = true;
    state.faceCreateScope = { ...currentLabelScope(), key: ED.key, g: Number(S.shownG) };
    LM.marq = null;
    LM.poly = [];
    LM.selSet?.clear();
    LM.sig = null;
    view.style.cursor = "crosshair";
    if (typeof edRepaint === "function") edRepaint();
    notify("Drag a box around the face to preview seven points · release to create · Esc to cancel");
  }

  function onFaceCreateMouseDown(event) {
    if (!state.faceCreateMode || event.button !== 0) return;
    if (!faceCreateStillHere()) { cancelFaceCreate(); return; }
    const canvas = document.getElementById("view");
    const stage = document.getElementById("stage");
    if (event.target !== canvas && event.target !== stage) return;
    if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
    const start = faceCreatePoint(event);
    if (!start) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (typeof pause === "function") pause();
    state.faceCreateDraft = { start, end: start };
    canvas.style.cursor = "crosshair";
  }

  function onFaceCreateMouseMove(event) {
    const draft = state.faceCreateDraft;
    if (!draft) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (!faceCreateStillHere()) { cancelFaceCreate(); return; }
    const end = faceCreatePoint(event);
    if (!end) { cancelFaceCreate(); return; }
    draft.end = end;
    view.style.cursor = "crosshair";
    if (typeof edRepaint === "function") edRepaint();
  }

  function onFaceCreateMouseUp(event) {
    const draft = state.faceCreateDraft;
    if (!draft) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (!faceCreateStillHere()) { cancelFaceCreate(); return; }
    const end = faceCreatePoint(event);
    if (!end) { cancelFaceCreate(); return; }
    draft.end = end;
    const bounds = faceCreateBounds(draft);
    const widthPx = (bounds[2] - bounds[0]) * draft.start.rect.width / draft.start.width;
    const heightPx = (bounds[3] - bounds[1]) * draft.start.rect.height / draft.start.height;
    state.faceCreateDraft = null;
    if (widthPx < 12 || heightPx < 12) {
      if (typeof edRepaint === "function") edRepaint();
      notify("Face box too small · drag a larger area, or press Esc to cancel");
      return;
    }
    const before = faceSnapshot();
    const points = faceCreatePoints(bounds);
    const empty = ED.items.findIndex((item) => item.pts?.length === 7 && item.pts.every((point) => !point));
    if (empty >= 0) {
      ED.items[empty].pts = points;
      LM.n = empty;
    } else {
      ED.items.push({ pts: points });
      LM.n = ED.items.length - 1;
    }
    LM.k = 0;
    LM.selSet?.clear();
    LM.sig = null;
    rememberFaceUndo(before);
    cancelFaceCreate(false);
    saveCurrentFaceEdit();
    notify("Created face 7pt · drag points to refine · Z to undo");
  }

  function ensureFaceShortcutTracking() {
    if (state.faceUndoInstalled || typeof lmkChanged !== "function") return;
    const previousChanged = lmkChanged;
    lmkChanged = function (...args) {
      const pending = state.faceUndoPending;
      state.faceUndoPending = null;
      if (!state.faceUndoSkipCapture && pending) rememberFaceUndo(pending);
      return previousChanged.apply(this, args);
    };
    window.addEventListener("mousedown", (event) => {
      if (event.button === 0 && event.target?.closest?.("#view, #lmkRef") && faceShortcutReady()) {
        state.faceUndoPending = faceSnapshot();
      }
    }, true);
    window.addEventListener("mousedown", onFaceCreateMouseDown, true);
    window.addEventListener("mousemove", onFaceCreateMouseMove, true);
    window.addEventListener("mouseup", onFaceCreateMouseUp, true);
    window.addEventListener("blur", () => { if (state.faceCreateMode) cancelFaceCreate(); });
    if (typeof lmkDraw === "function") {
      const nativeDraw = lmkDraw;
      lmkDraw = function (...args) {
        const result = nativeDraw.apply(this, args);
        drawFaceCreatePreview();
        return result;
      };
    }
    state.faceUndoInstalled = true;
  }

  function saveCurrentFaceEdit() {
    state.faceUndoPending = null;
    state.faceUndoSkipCapture = true;
    try {
      if (typeof lmkChanged === "function") lmkChanged();
      else {
        if (typeof edSave === "function") edSave();
        if (typeof edRepaint === "function") edRepaint();
      }
    } finally { state.faceUndoSkipCapture = false; }
  }

  function replaceCurrentFaceItems(items, message) {
    if (!faceShortcutReady()) return false;
    const before = faceSnapshot();
    const next = cloneGenericItems(items);
    if (JSON.stringify(before.items) === JSON.stringify(next)) return false;
    ED.items.splice(0, ED.items.length, ...next);
    rememberFaceUndo(before);
    LM.n = Math.min(Math.max(0, LM.n), Math.max(0, ED.items.length - 1));
    LM.k = 0;
    LM.selSet?.clear();
    LM.sig = null;
    saveCurrentFaceEdit();
    if (message) notify(message);
    return true;
  }

  async function copyPreviousFace(advance = false) {
    if (!faceShortcutReady()) return false;
    const request = { ...faceSnapshot(), itemsRef: ED.items };
    request.serialized = JSON.stringify(request.items);
    if (state.faceCopyRequest?.session === request.session && state.faceCopyRequest.g === request.g) return false;
    const stillHere = () => faceShortcutReady() && state.faceCopyRequest === request &&
      faceSnapshotMatches(request) && ED.items === request.itemsRef &&
      JSON.stringify(cloneGenericItems(ED.items)) === request.serialized;
    state.faceCopyRequest = request;
    try {
      if (typeof pause === "function") pause();
      const previous = sessionLabelFrames().filter((g) => g < request.g).reverse();
      for (let index = 0; index < previous.length; index++) {
        if (!stillHere()) return false;
        const g = previous[index];
        const items = cloneGenericItems(await getFrameGenericItems(g, "face_lmk", request.generation))
          .filter((item) => item.pts?.length === 7 && item.pts.some(Boolean));
        if (!stillHere()) return false;
        if (items.length) {
          const changed = replaceCurrentFaceItems(items, `Copied face 7pt from frame ${g + 1} · Z to undo`);
          request.serialized = JSON.stringify(cloneGenericItems(ED.items));
          if (changed && advance) setTimeout(() => { if (stillHere()) navigateOrganizedFrames(1); }, 40);
          return changed;
        }
        if (index % 64 === 63) await new Promise((resolve) => setTimeout(resolve, 0));
      }
      if (stillHere()) notify("No earlier face 7pt frame with points to copy from");
      return false;
    } catch (error) {
      if (stillHere()) notify(`Could not copy face 7pt: ${error.message}`);
      return false;
    } finally {
      if (state.faceCopyRequest === request) state.faceCopyRequest = null;
    }
  }

  function copyFaceToClipboard() {
    if (!faceShortcutReady()) return;
    state.faceClipboard = { ...currentLabelScope(), items: cloneGenericItems(ED.items) };
    notify("Copied face 7pt · switch frames and press Ctrl+V");
  }

  function pasteFaceFromClipboard() {
    if (!faceShortcutReady()) return;
    const clipboard = state.faceClipboard;
    if (!clipboard || clipboard.session !== S.sess || clipboard.generation !== S.gen ||
        clipboard.label !== "face_lmk") {
      notify("The clipboard has no face 7pt points for this session");
      return;
    }
    replaceCurrentFaceItems(clipboard.items, "Pasted face 7pt · Z to undo");
  }

  async function undoFace() {
    if (!faceShortcutReady()) return;
    let index = state.faceUndo.length - 1;
    while (index >= 0) {
      const entry = state.faceUndo[index];
      if (entry.session === S.sess && entry.generation === S.gen && entry.label === "face_lmk") break;
      index--;
    }
    if (index < 0) { notify("No more face 7pt edits to undo"); return; }
    const [entry] = state.faceUndo.splice(index, 1);
    state.operationBusy = true;
    try {
      if (entry.g === Number(S.shownG) && ED.key === entry.key) {
        ED.items.splice(0, ED.items.length, ...cloneGenericItems(entry.items));
        LM.n = Math.min(Math.max(0, LM.n), Math.max(0, ED.items.length - 1));
        LM.k = 0;
        LM.selSet?.clear();
        saveCurrentFaceEdit();
      } else {
        await saveFrameGenericItems(entry.g, "face_lmk", entry.items, entry.generation);
        if (typeof fsRender === "function") fsRender();
        if (typeof paint === "function") paint();
      }
      notify("Undid the latest face 7pt edit");
    } catch (error) {
      state.faceUndo.splice(index, 0, entry);
      notify(`Could not undo face 7pt: ${error.message}`);
    } finally {
      state.operationBusy = false;
      refreshStatusControls();
    }
  }

  function handleFaceShortcut(event, hasCtrlOrMeta, noModifiers, consume) {
    if (!faceLandmarkActive() || event.isComposing) return false;
    if (event.code === "Escape" && state.faceCreateMode) {
      consume(event);
      cancelFaceCreate();
      return true;
    }
    if (noModifiers && !event.shiftKey && event.code === "KeyN") {
      consume(event);
      if (!event.repeat) setFaceCreateMode();
      return true;
    }
    if (noModifiers && !event.shiftKey && ["KeyX", "Delete", "Backspace"].includes(event.code)) {
      if (faceShortcutReady()) state.faceUndoPending = faceSnapshot();
      return false; // Keep native Not found / point removal behavior.
    }
    if (hasCtrlOrMeta && !event.altKey && !event.shiftKey &&
        ["KeyC", "KeyV"].includes(event.code)) {
      consume(event);
      if (!event.repeat) event.code === "KeyC" ? copyFaceToClipboard() : pasteFaceFromClipboard();
      return true;
    }
    if (noModifiers && event.code === "KeyC") {
      consume(event);
      if (!event.repeat) copyPreviousFace(event.shiftKey);
      return true;
    }
    return false;
  }

  Object.assign(NL, {
    faceLandmarkActive, faceShortcutReady, ensureFaceShortcutTracking,
    copyPreviousFace, copyFaceToClipboard, pasteFaceFromClipboard, undoFace, handleFaceShortcut,
    cancelFaceCreate, faceCreateStillHere
  });
})();
