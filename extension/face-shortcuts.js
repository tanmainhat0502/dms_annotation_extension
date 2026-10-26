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
    copyPreviousFace, copyFaceToClipboard, pasteFaceFromClipboard, undoFace, handleFaceShortcut
  });
})();
