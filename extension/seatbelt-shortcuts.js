(() => {
  "use strict";

  const NL = window.__notaOrganizerV1 = window.__notaOrganizerV1 || {};
  const {
    anyBulkDialogOpen, currentLabelScope, getFrameMask, maskBulkBlockReason,
    navigateOrganizedFrames, notify, pageLabelingReady, sessionLabelFrames, state
  } = NL;

  function seatbeltShortcutReady() {
    try {
      return pageLabelingReady("seatbelt") && !state.operationBusy && !anyBulkDialogOpen() &&
        !(typeof RV_OPEN !== "undefined" && RV_OPEN) &&
        typeof beltActive === "function" && beltActive() && typeof beltLoad === "function" && beltLoad() &&
        typeof BT !== "undefined" && BT.key === rvKey(S.shownG) && BT.mask instanceof Uint8Array &&
        Number(S.g) === Number(S.shownG) && !BT.drag && !maskBulkBlockReason();
    } catch (_) { return false; }
  }

  function masksEqual(left, right) {
    if (!left || !right || left.length !== right.length) return false;
    for (let index = 0; index < left.length; index++) if (left[index] !== right[index]) return false;
    return true;
  }

  function replaceCurrentSeatbeltMask(mask, message) {
    if (!seatbeltShortcutReady() || mask.length !== BT.mask.length || masksEqual(mask, BT.mask)) return false;
    BT.undo.push(BT.mask.slice());
    if (BT.undo.length > 15) BT.undo.shift();
    BT.mask.set(mask);
    BT.sel?.fill(0);
    BT.polyDone = null;
    state.lastPatch = null;
    beltChanged();
    if (message) notify(message);
    return true;
  }

  async function copyPreviousSeatbelt(advance = false) {
    if (!seatbeltShortcutReady()) return false;
    const request = { ...currentLabelScope(), g: Number(S.shownG), key: BT.key,
      maskRef: BT.mask, before: BT.mask.slice() };
    if (state.seatbeltCopyRequest?.session === request.session && state.seatbeltCopyRequest.g === request.g) return false;
    const stillHere = () => seatbeltShortcutReady() && state.seatbeltCopyRequest === request &&
      S.sess === request.session && S.gen === request.generation && S.labelSel === request.label &&
      Number(S.shownG) === request.g && BT.key === request.key && BT.mask === request.maskRef;
    state.seatbeltCopyRequest = request;
    try {
      if (typeof pause === "function") pause();
      const previous = sessionLabelFrames().filter((g) => g < request.g).reverse();
      for (let index = 0; index < previous.length; index++) {
        if (!stillHere()) return false;
        const g = previous[index];
        const mask = await getFrameMask(g, request.generation);
        if (!stillHere()) return false;
        if (mask.some((value) => value !== 0)) {
          if (!masksEqual(BT.mask, request.before)) return false;
          const changed = replaceCurrentSeatbeltMask(mask, `Copied seatbelt mask from frame ${g + 1} · Z to undo`);
          request.before = BT.mask.slice();
          if (changed && advance) setTimeout(() => { if (stillHere()) navigateOrganizedFrames(1); }, 40);
          return changed;
        }
        if (index % 32 === 31) await new Promise((resolve) => setTimeout(resolve, 0));
      }
      if (stillHere()) notify("No earlier frame with a seatbelt mask to copy from");
      return false;
    } catch (error) {
      if (stillHere()) notify(`Could not copy seatbelt mask: ${error.message}`);
      return false;
    } finally {
      if (state.seatbeltCopyRequest === request) state.seatbeltCopyRequest = null;
    }
  }

  function copySeatbeltToClipboard() {
    if (!seatbeltShortcutReady()) return;
    state.seatbeltClipboard = { ...currentLabelScope(), width: BT.W, height: BT.H, mask: BT.mask.slice() };
    notify("Copied seatbelt mask · switch frames and press Ctrl+V");
  }

  function pasteSeatbeltFromClipboard() {
    if (!seatbeltShortcutReady()) return;
    const clipboard = state.seatbeltClipboard;
    if (!clipboard || clipboard.session !== S.sess || clipboard.generation !== S.gen ||
        clipboard.label !== "seatbelt" || clipboard.width !== BT.W || clipboard.height !== BT.H) {
      notify("The clipboard has no seatbelt mask for this session");
      return;
    }
    replaceCurrentSeatbeltMask(clipboard.mask, "Pasted seatbelt mask · Z to undo");
  }

  function handleSeatbeltShortcut(event, hasCtrlOrMeta, noModifiers, consume) {
    if (!pageLabelingReady("seatbelt") || event.isComposing) return false;
    if (hasCtrlOrMeta && !event.altKey && !event.shiftKey &&
        ["KeyC", "KeyV"].includes(event.code)) {
      consume(event);
      if (!event.repeat) event.code === "KeyC" ? copySeatbeltToClipboard() : pasteSeatbeltFromClipboard();
      return true;
    }
    if (noModifiers && event.code === "KeyC") {
      consume(event);
      if (!event.repeat) copyPreviousSeatbelt(event.shiftKey);
      return true;
    }
    return false;
  }

  Object.assign(NL, {
    seatbeltShortcutReady, copyPreviousSeatbelt, copySeatbeltToClipboard,
    pasteSeatbeltFromClipboard, handleSeatbeltShortcut
  });
})();
