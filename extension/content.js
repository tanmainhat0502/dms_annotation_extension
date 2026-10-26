(() => {
  "use strict";

  const NL = window.__notaOrganizerV1 = window.__notaOrganizerV1 || {};
  const {
    ALLOWED_ORIGINS, BBOX_FILTER_API, GENERIC_COPY_LABELS, ROOT_ID, VERSION, acceptSamPreview,
    anyBulkDialogOpen, applyFilter, applyQuickOperationToItems, bboxDeleteTarget,
    bboxEditingAvailable, bboxFilterWants, bboxLabelingReady, buildMarkedBadge, buildToolbar,
    cancelBboxMode, cancelBulkDialog, cancelEyeBulkDialog, cancelManualMode,
    capturePlaybackSidebarPosition,
    closeClipStatusMenu, closePartStatusMenu, commitBboxDeletePolygon, copyPreviousQuickBbox,
    copyQuickBboxToClipboard, deleteQuickBbox, ensureBboxEditing, ensureBulkDialog,
    ensureCurrentClipOpen, ensureEyeBulkDialog, ensureEyeGroupDragging, ensureEyePanelHint,
    ensureEyeShortcutTracking, ensureLandmarkBlankClick, eyeLandmarkActive, handleEyeShortcut, deleteEye, undoEye,
    ensureFaceShortcutTracking, faceLandmarkActive, faceShortcutReady, handleFaceShortcut,
    cancelFaceCreate, faceCreateStillHere, undoFace,
    handleSeatbeltShortcut,
    ensureEyeTransformDrawing, ensureLabelVisibility, ensureNativeEditing,
    ensureOrganizedPlayback, ensurePointerPerformance, ensurePolygonDrawing,
    ensurePolygonTools, ensureSidebarRendering, ensureStatusFilters, ensureStatusRendering,
    ensureTimelineLock, ensureZoomPerformance, followFilteredFrame, injectStyle,
    isLabelingMode, markedScopeMatches, mergeCopiedGenericBbox, navigateOrganizedFrames,
    onBboxEdgeDoubleClick, onBboxMouseDown, onBboxMouseMove, onBboxMouseUp, onBboxPointerDown,
    onManualMouseDown, onManualMouseMove, openBulkDialog, organizeGroup, pageLabelingReady,
    partStatusMatches, pasteQuickBboxFromClipboard, positionMarkedBadge, quickBboxReady,
    refreshStatusControls, releaseBboxPointer, restoreNativeGroups,
    restorePlaybackSidebarPosition, samAcceptAvailable,
    setBboxMode, setManualMode, state, statusFilterRestricted, toggleMarkedFrame, toggleRangeStart,
    undoQuickBbox, undoSeatbelt, updateMarkedUI
  } = NL;

  if (!ALLOWED_ORIGINS.has(location.origin) || document.getElementById(ROOT_ID)) return;

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

  function consumeKeyEvent(event) {
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  function handleKeyRShortcut(event, target) {
    const pendingSam = samAcceptAvailable() && (BT.prev || BT.busy || BT.points.length);
    if (anyBulkDialogOpen() || state.samAcceptHeld || pendingSam) {
      // R confirms SAM once; held-key repeats cannot create another edit.
      // F and Space remain entirely with the page's native handlers.
      consumeKeyEvent(event);
      if (!anyBulkDialogOpen()) {
        state.samAcceptHeld = true;
        if (!event.repeat) acceptSamPreview();
      }
      return true;
    }
    if (!event.shiftKey && bboxLabelingReady()) {
      consumeKeyEvent(event);
      if (!event.repeat && !event.isComposing && !state.operationBusy && bboxEditingAvailable() &&
          !(typeof RV_OPEN !== "undefined" && RV_OPEN) && !ED.drag && !ED.marq &&
          ED.lab === S.labelSel && typeof rvKey === "function" && ED.key === rvKey(S.shownG)) {
        // Use the native Delete handler so selection, saving and status updates
        // behave exactly like Delete, including multiple selected boxes.
        target.dispatchEvent(new KeyboardEvent("keydown", {
          key: "Delete", code: "Delete", bubbles: true, cancelable: true
        }));
      }
      return true;
    }
    if (!event.shiftKey && eyeLandmarkActive()) {
      consumeKeyEvent(event);
      if (!event.repeat && !event.isComposing) deleteEye("selected");
      return true;
    }
    if (!event.shiftKey && faceLandmarkActive()) {
      consumeKeyEvent(event);
      if (!event.repeat && !event.isComposing && faceShortcutReady()) {
        // Face Delete removes the selected landmark (or selected landmarks).
        // Reuse that native path so R has identical save and undo behavior.
        target.dispatchEvent(new KeyboardEvent("keydown", {
          key: "Delete", code: "Delete", bubbles: true, cancelable: true
        }));
      }
      return true;
    }
    return false;
  }

  function handleQuickBboxShortcut(event, hasCtrlOrMeta, noModifiers) {
    if (hasCtrlOrMeta && !event.altKey && !event.shiftKey && (event.code === "KeyC" || event.code === "KeyV")) {
      consumeKeyEvent(event);
      if (!event.repeat) {
        if (event.code === "KeyC") copyQuickBboxToClipboard();
        else pasteQuickBboxFromClipboard();
      }
      return true;
    }
    if (noModifiers && event.code === "KeyX") {
      consumeKeyEvent(event);
      if (!event.repeat) deleteQuickBbox("all", event.shiftKey);
      return true;
    }
    if (noModifiers && !event.shiftKey &&
        (event.code === "Digit1" || event.code === "Numpad1" || event.code === "Digit2" || event.code === "Numpad2")) {
      consumeKeyEvent(event);
      if (!event.repeat) deleteQuickBbox(event.code.endsWith("1") ? "left" : "right");
      return true;
    }
    if (noModifiers && event.code === "KeyC") {
      consumeKeyEvent(event);
      if (!event.repeat && !event.isComposing) copyPreviousQuickBbox(event.shiftKey);
      return true;
    }
    return false;
  }

  function onGlobalKeyDown(event) {
    const target = event.target;
    if (event.code === "Escape" && state.clipStatusMenu) {
      consumeKeyEvent(event);
      closeClipStatusMenu(true);
      return;
    }
    if (event.code === "Escape" && state.partStatusMenu) {
      consumeKeyEvent(event);
      closePartStatusMenu(true);
      return;
    }
    if (target?.closest?.("#nl-clip-status-menu, #nl-part-status-menu, .nl-part-status-choice, .nl-clip-status-actions, #nl-status-filters")) return;
    const typing = target?.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target?.tagName || "");
    const hasCtrlOrMeta = event.ctrlKey || event.metaKey;
    const noModifiers = !hasCtrlOrMeta && !event.altKey;

    if (event.code === "KeyR" && noModifiers && !typing && handleKeyRShortcut(event, target)) return;

    // Handle Escape before the page's input listener blurs the count field.
    // Cancellation discards the region; a successful Apply keeps it reusable.
    if (event.code === "Escape" && anyBulkDialogOpen()) {
      consumeKeyEvent(event);
      if (state.eyeBulkDialog?.open) cancelEyeBulkDialog();
      else cancelBulkDialog();
      return;
    }
    if (typing) return;
    if (event.code === "Escape" && state.bboxMode) {
      consumeKeyEvent(event);
      cancelBboxMode();
      return;
    }
    if (event.code === "KeyZ" && !event.altKey && !event.shiftKey && !anyBulkDialogOpen() &&
        (bboxLabelingReady() || eyeLandmarkActive() || faceLandmarkActive() || pageLabelingReady("seatbelt"))) {
      consumeKeyEvent(event);
      if (!event.repeat) {
        if (bboxLabelingReady()) undoQuickBbox();
        else if (eyeLandmarkActive()) undoEye();
        else if (faceLandmarkActive()) undoFace();
        else undoSeatbelt();
      }
      return;
    }
    if (!anyBulkDialogOpen() && handleEyeShortcut(event, hasCtrlOrMeta, noModifiers, consumeKeyEvent)) return;
    if (!anyBulkDialogOpen() && handleFaceShortcut(event, hasCtrlOrMeta, noModifiers, consumeKeyEvent)) return;
    if (!anyBulkDialogOpen() && handleSeatbeltShortcut(event, hasCtrlOrMeta, noModifiers, consumeKeyEvent)) return;
    if (!anyBulkDialogOpen() && quickBboxReady() && handleQuickBboxShortcut(event, hasCtrlOrMeta, noModifiers)) return;
    if (event.code === "Escape" && (state.manualMode || state.lastPatch)) {
      consumeKeyEvent(event);
      cancelManualMode();
      return;
    }
    if (noModifiers && !anyBulkDialogOpen() && (event.code === "KeyA" || event.code === "KeyD") && pageLabelingReady()) {
      consumeKeyEvent(event);
      navigateOrganizedFrames(event.code === "KeyA" ? -1 : 1, event.shiftKey ? 10 : 1);
      return;
    }
    if (event.code === "KeyV" && noModifiers && !event.shiftKey && pageLabelingReady() && !anyBulkDialogOpen()) {
      consumeKeyEvent(event);
      if (!event.repeat) toggleMarkedFrame();
      return;
    }
    if (event.code === "KeyG" && noModifiers && !event.shiftKey && !event.isComposing &&
        pageLabelingReady() && !anyBulkDialogOpen()) {
      consumeKeyEvent(event);
      if (!event.repeat) toggleRangeStart();
      return;
    }
    if (hasCtrlOrMeta && !event.altKey && !event.shiftKey && event.code === "KeyB" && pageLabelingReady() &&
        (S.labelSel === "seatbelt" || S.labelSel === "eye_lmk" || GENERIC_COPY_LABELS.has(S.labelSel) ||
          (markedScopeMatches() && (state.markedFrames.size || Number.isInteger(state.rangeStart))))) {
      consumeKeyEvent(event);
      if (!event.repeat) openBulkDialog();
      return;
    }
    if (noModifiers && !event.shiftKey && !anyBulkDialogOpen() && (event.code === "KeyN" || event.code === "KeyM") &&
        bboxLabelingReady()) {
      consumeKeyEvent(event);
      if (!event.repeat) setBboxMode(event.code === "KeyN" ? "create" : "delete");
      return;
    }
    if (noModifiers && (event.code === "KeyN" || (event.code === "KeyM" && !event.shiftKey)) &&
        pageLabelingReady("seatbelt") && !anyBulkDialogOpen()) {
      consumeKeyEvent(event);
      if (!event.repeat) setManualMode(event.code === "KeyM" || event.shiftKey ? "subtract" : "add");
    }
  }

  function onGlobalKeyUp(event) {
    if (event.code === "KeyR") state.samAcceptHeld = false;
  }

  function ensureEditorAndCanvasHooks() {
    ensureOrganizedPlayback();
    ensureNativeEditing();
    ensureBboxEditing();
    ensureLabelVisibility();
    ensureEyeShortcutTracking();
    ensureFaceShortcutTracking();
    ensureLandmarkBlankClick();
    ensureEyeGroupDragging();
    ensureEyeTransformDrawing();
    ensureEyePanelHint();
    ensurePolygonDrawing();
    ensurePointerPerformance();
    ensureZoomPerformance();
    ensurePolygonTools();
  }

  function enhance() {
    state.scheduled = false;
    state.navigation = null;
    state.partIndex = null;
    if (!state.list || !state.list.isConnected) return;
    ensureTimelineLock();

    if (!isLabelingMode()) {
      closeClipStatusMenu();
      closePartStatusMenu();
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
    if (state.partStatusMenu && (!state.partStatusMenu.row.isConnected ||
        !partStatusMatches(state.partScopes.get(state.partStatusMenu.row)))) closePartStatusMenu();
    ensureEditorAndCanvasHooks();
    if (!pageLabelingReady("seatbelt") && (state.manualMode || state.lastPatch)) cancelManualMode();
    if (state.bboxMode && !bboxLabelingReady()) cancelBboxMode();
    if (state.faceCreateMode && !faceCreateStillHere()) cancelFaceCreate();
    const playbackPosition = capturePlaybackSidebarPosition();
    state.applying = true;
    try {
      for (const row of state.list.querySelectorAll(":scope > .grp")) organizeGroup(row);
      refreshStatusControls();
      ensureCurrentClipOpen();
      applyFilter();
      updateMarkedUI();
      state.sidebarScope = typeof S !== "undefined" ? { generation: S.gen, label: S.labelSel } : null;
    } finally {
      restorePlaybackSidebarPosition(playbackPosition);
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
    ensureEditorAndCanvasHooks();
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
      const partMenu = state.partStatusMenu;
      if (partMenu && !partMenu.element.contains(event.target) && !partMenu.button.contains(event.target)) closePartStatusMenu();
    }, true);
    window.addEventListener("scroll", (event) => {
      if (!state.clipStatusMenu?.element.contains(event.target)) closeClipStatusMenu();
      if (!state.partStatusMenu?.element.contains(event.target)) closePartStatusMenu();
    }, true);
    window.addEventListener("resize", () => closeClipStatusMenu());
    window.addEventListener("resize", () => closePartStatusMenu());
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

  Object.assign(NL, {
    onViewContextMenu, consumeKeyEvent, handleKeyRShortcut, handleQuickBboxShortcut,
    onGlobalKeyDown, onGlobalKeyUp, ensureEditorAndCanvasHooks, enhance, scheduleEnhance,
    install
  });

  if (!install()) {
    const bootObserver = new MutationObserver(() => {
      if (install()) bootObserver.disconnect();
    });
    bootObserver.observe(document.documentElement, { childList: true, subtree: true });
  }
})();
