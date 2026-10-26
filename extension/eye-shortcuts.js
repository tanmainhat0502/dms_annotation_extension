(() => {
  "use strict";

  const NL = window.__notaOrganizerV1 = window.__notaOrganizerV1 || {};
  const {
    anyBulkDialogOpen, cloneEyeItems, currentLabelScope, eyeLandmarkActive,
    getFrameEyeItems, navigateOrganizedFrames, notify, refreshStatusControls,
    saveFrameEyeItems, sessionLabelFrames, state
  } = NL;

  function eyeShortcutReady() {
    try {
      return eyeLandmarkActive() && !state.operationBusy && !anyBulkDialogOpen() &&
        !(typeof RV_OPEN !== "undefined" && RV_OPEN) &&
        typeof ED !== "undefined" && typeof LM !== "undefined" &&
        ED.lab === "eye_lmk" && ED.key === rvKey(S.shownG) &&
        Number(S.g) === Number(S.shownG) && Array.isArray(ED.items) &&
        !ED.drag && !ED.marq && !LM.drag && !LM.marq && !state.eyeGroupDrag;
    } catch (_) {
      return false;
    }
  }

  function eyeSnapshot() {
    return { ...currentLabelScope(), g: Number(S.shownG), key: ED.key, items: cloneEyeItems(ED.items) };
  }

  function eyeSnapshotMatches(snapshot) {
    return Boolean(snapshot && snapshot.session === S.sess && snapshot.generation === S.gen &&
      snapshot.label === "eye_lmk" && snapshot.g === Number(S.shownG) && snapshot.key === ED.key);
  }

  function rememberEyeUndo(snapshot) {
    if (!eyeSnapshotMatches(snapshot) ||
        JSON.stringify(snapshot.items) === JSON.stringify(cloneEyeItems(ED.items))) return;
    state.eyeUndo.push(snapshot);
    if (state.eyeUndo.length > 30) state.eyeUndo.splice(0, state.eyeUndo.length - 30);
  }

  function captureEyeUndo() {
    if (eyeShortcutReady()) state.eyeUndoPending = eyeSnapshot();
  }

  function ensureEyeShortcutTracking() {
    if (state.eyeUndoInstalled || typeof lmkChanged !== "function") return;
    const nativeChanged = lmkChanged;
    lmkChanged = function (...args) {
      const pending = state.eyeUndoPending;
      state.eyeUndoPending = null;
      if (!state.eyeUndoSkipCapture && pending) rememberEyeUndo(pending);
      return nativeChanged.apply(this, args);
    };
    window.addEventListener("mousedown", (event) => {
      if (event.button === 0 && event.target?.closest?.("#view, #lmkRef")) captureEyeUndo();
    }, true);
    state.eyeUndoInstalled = true;
  }

  function saveCurrentEyeEdit() {
    state.eyeUndoPending = null;
    state.eyeUndoSkipCapture = true;
    try {
      if (typeof lmkChanged === "function") lmkChanged();
      else {
        if (typeof edSave === "function") edSave();
        if (typeof edRepaint === "function") edRepaint();
      }
    } finally {
      state.eyeUndoSkipCapture = false;
    }
  }

  function replaceCurrentEyeItems(items, message) {
    if (!eyeShortcutReady()) return false;
    const before = eyeSnapshot();
    const next = cloneEyeItems(items);
    if (JSON.stringify(before.items) === JSON.stringify(next)) return false;
    ED.items.splice(0, ED.items.length, ...next);
    rememberEyeUndo(before);
    LM.n = Math.min(Math.max(0, LM.n), Math.max(0, ED.items.length - 1));
    LM.k = 0;
    LM.selSet?.clear();
    LM.addEye = false;
    LM.sig = null;
    saveCurrentEyeEdit();
    if (message) notify(message);
    return true;
  }

  function setEyeAddMode() {
    if (!eyeShortcutReady()) return;
    LM.addEye = !LM.addEye;
    LM.sig = null;
    if (typeof edRepaint === "function") edRepaint();
    notify(LM.addEye ? "Click the center of the eye to add a new 15-point group · Esc to cancel" : "Add eye cancelled");
  }

  function eyeHorizontalOrder(items) {
    return items.map((item, index) => {
      const points = item.pts.filter((point) => Array.isArray(point));
      return { index, x: points.length ? points.reduce((sum, point) => sum + point[0], 0) / points.length : Infinity };
    }).sort((left, right) => left.x - right.x || left.index - right.index);
  }

  function deleteEye(selector, advance = false) {
    if (!eyeShortcutReady()) return false;
    if (!ED.items.length) { notify("This frame has no eye 15pt groups to delete"); return false; }
    const order = eyeHorizontalOrder(ED.items);
    const index = selector === "left" ? order[0].index : selector === "right" ? order[order.length - 1].index :
      Number.isInteger(LM.n) && LM.n >= 0 && LM.n < ED.items.length ? LM.n : ED.items.length === 1 ? 0 : -1;
    if (selector !== "all" && index < 0) { notify("Select an eye first, then press R"); return false; }
    const next = selector === "all" ? [] : ED.items.filter((_, n) => n !== index);
    const changed = replaceCurrentEyeItems(next, selector === "all" ? "Deleted all eye 15pt groups · Z to undo" :
      `Deleted the ${selector === "left" ? "leftmost" : selector === "right" ? "rightmost" : "selected"} eye · Z to undo`);
    if (changed && advance) setTimeout(() => navigateOrganizedFrames(1), 40);
    return changed;
  }

  async function copyPreviousEye(advance = false) {
    if (!eyeShortcutReady()) return false;
    const request = { ...eyeSnapshot(), itemsRef: ED.items };
    request.serialized = JSON.stringify(request.items);
    const stillHere = () => eyeShortcutReady() && state.eyeCopyRequest === request &&
      eyeSnapshotMatches(request) && ED.items === request.itemsRef &&
      JSON.stringify(cloneEyeItems(ED.items)) === request.serialized;
    if (state.eyeCopyRequest?.session === request.session && state.eyeCopyRequest.g === request.g) return false;
    state.eyeCopyRequest = request;
    try {
      if (typeof pause === "function") pause();
      const previous = sessionLabelFrames().filter((g) => g < request.g).reverse();
      for (let index = 0; index < previous.length; index++) {
        if (!stillHere()) return false;
        const g = previous[index];
        const items = cloneEyeItems(await getFrameEyeItems(g, request.generation))
          .filter((item) => item.pts.length === 15);
        if (!stillHere()) return false;
        if (items.length) {
          const changed = replaceCurrentEyeItems(items, `Copied ${items.length} eye 15pt groups from frame ${g + 1} · Z to undo`);
          request.serialized = JSON.stringify(cloneEyeItems(ED.items));
          if (changed && advance) setTimeout(() => { if (stillHere()) navigateOrganizedFrames(1); }, 40);
          return changed;
        }
        if (index % 64 === 63) await new Promise((resolve) => setTimeout(resolve, 0));
      }
      if (stillHere()) notify("No earlier eye 15pt frame with points to copy from");
      return false;
    } catch (error) {
      if (stillHere()) notify(`Could not copy eye 15pt: ${error.message}`);
      return false;
    } finally {
      if (state.eyeCopyRequest === request) state.eyeCopyRequest = null;
    }
  }

  function copyEyeToClipboard() {
    if (!eyeShortcutReady()) return;
    state.eyeClipboard = { ...currentLabelScope(), items: cloneEyeItems(ED.items) };
    notify(`Copied ${ED.items.length} eye 15pt groups · switch frames and press Ctrl+V`);
  }

  function pasteEyeFromClipboard() {
    if (!eyeShortcutReady()) return;
    const clipboard = state.eyeClipboard;
    if (!clipboard || clipboard.session !== S.sess || clipboard.generation !== S.gen || clipboard.label !== "eye_lmk") {
      notify("The clipboard has no eye 15pt groups for this session");
      return;
    }
    replaceCurrentEyeItems(clipboard.items, `Pasted ${clipboard.items.length} eye 15pt groups · Z to undo`);
  }

  async function undoEye() {
    if (!eyeShortcutReady()) return;
    let index = state.eyeUndo.length - 1;
    while (index >= 0) {
      const entry = state.eyeUndo[index];
      if (entry.session === S.sess && entry.generation === S.gen && entry.label === "eye_lmk") break;
      index -= 1;
    }
    if (index < 0) { notify("No more eye 15pt edits to undo"); return; }
    const [entry] = state.eyeUndo.splice(index, 1);
    state.operationBusy = true;
    try {
      if (entry.g === Number(S.shownG) && ED.key === entry.key) {
        ED.items.splice(0, ED.items.length, ...cloneEyeItems(entry.items));
        LM.n = Math.min(Math.max(0, LM.n), Math.max(0, ED.items.length - 1));
        LM.k = 0;
        LM.selSet?.clear();
        LM.addEye = false;
        saveCurrentEyeEdit();
      } else {
        await saveFrameEyeItems(entry.g, entry.items, entry.generation);
        if (typeof fsRender === "function") fsRender();
        if (typeof paint === "function") paint();
      }
      notify("Undid the latest eye 15pt edit");
    } catch (error) {
      state.eyeUndo.splice(index, 0, entry);
      notify(`Could not undo eye 15pt: ${error.message}`);
    } finally {
      state.operationBusy = false;
      refreshStatusControls();
    }
  }

  function handleEyeShortcut(event, hasCtrlOrMeta, noModifiers, consume) {
    if (!eyeLandmarkActive() || event.isComposing) return false;
    const code = event.code;
    if (hasCtrlOrMeta && !event.altKey && !event.shiftKey && (code === "KeyC" || code === "KeyV")) {
      consume(event);
      if (!event.repeat) code === "KeyC" ? copyEyeToClipboard() : pasteEyeFromClipboard();
      return true;
    }
    if (event.altKey && !hasCtrlOrMeta && !event.shiftKey && code === "KeyC") {
      consume(event);
      if (!event.repeat && eyeShortcutReady() && ED.items.length && typeof lmkToggleClosed === "function") {
        captureEyeUndo();
        lmkToggleClosed();
      }
      return true;
    }
    if (!noModifiers) return false;
    if (!event.shiftKey && (code === "Delete" || code === "Backspace")) {
      consume(event);
      if (!event.repeat) deleteEye("selected");
      return true;
    }
    if (code === "KeyN" && !event.shiftKey) {
      consume(event);
      if (!event.repeat) setEyeAddMode();
      return true;
    }
    if (code === "KeyX") {
      consume(event);
      if (!event.repeat) deleteEye("all", event.shiftKey);
      return true;
    }
    if (code === "KeyC") {
      consume(event);
      if (!event.repeat) copyPreviousEye(event.shiftKey);
      return true;
    }
    if (!event.shiftKey && (code === "Digit1" || code === "Numpad1" || code === "Digit2" || code === "Numpad2")) {
      consume(event);
      if (!event.repeat) deleteEye(code.endsWith("1") ? "left" : "right");
      return true;
    }
    return false;
  }

  Object.assign(NL, {
    eyeShortcutReady, ensureEyeShortcutTracking, setEyeAddMode, deleteEye,
    copyPreviousEye, copyEyeToClipboard, pasteEyeFromClipboard, undoEye, handleEyeShortcut
  });
})();
