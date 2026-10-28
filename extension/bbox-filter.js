(() => {
  "use strict";

  const NL = window.__notaOrganizerV1 = window.__notaOrganizerV1 || {};
  const {
    BBOX_COUNT_PARALLEL, BBOX_LABELS, BBOX_REFRESH_MS, FRAME_STATES, ROOT_ID, VERSION,
    anyBulkDialogOpen, bboxCountsPendingFor, captureSidebarPosition, clipFrames,
    currentLabelScope, frameSegment, frameState, insertBeforeFrameName, loadAutoLabel,
    normalize, notify, organizedNavigationIndex, pageLabelingReady, parseBboxCounts,
    parseBoxBounds, partFrames, partStatusMatches, prepareSessionWarnings, quickBboxReady,
    refreshClipStatusControls, refreshClipSummary, refreshPartStatusControls,
    refreshStatusControls, restoreSidebarPosition, runQueue, saveFrameState,
    setFrameWarnBadge, state, statusName, storeBboxFilter, storeFilter
  } = NL;

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
        <button id="nl-bbox-warn" class="nl-bbox-warn" type="button"
          title="Filter frames with likely BBox errors across the session" aria-pressed="false">⚠ Warn</button>
        <span class="nl-bbox-status" aria-live="polite"></span>
        <button class="nl-done-all" type="button" title="Mark every unfinished frame listed in the sidebar Done">Done all</button>
        <div class="nl-bbox-progress-wrap" hidden>
          <div class="nl-bbox-progress-head">
            <span class="nl-bbox-progress-text" role="status" aria-live="polite"></span>
            <span class="nl-bbox-progress-pct"></span>
          </div>
          <progress class="nl-bbox-progress" aria-label="BBox count indexing progress" max="1" value="0"></progress>
        </div>
      </div>
    `;

    state.input = toolbar.querySelector(".nl-search");
    state.status = toolbar.querySelector(".nl-status");
    state.bboxInput = toolbar.querySelector("#nl-bbox-counts");
    state.bboxAllButton = toolbar.querySelector(".nl-bbox-all");
    state.bboxWarnButton = toolbar.querySelector(".nl-bbox-warn");
    state.bboxStatus = toolbar.querySelector(".nl-bbox-status");
    state.doneAllButton = toolbar.querySelector(".nl-done-all");
    state.bboxProgressWrap = toolbar.querySelector(".nl-bbox-progress-wrap");
    state.bboxProgressText = toolbar.querySelector(".nl-bbox-progress-text");
    state.bboxProgressPct = toolbar.querySelector(".nl-bbox-progress-pct");
    state.bboxProgress = toolbar.querySelector(".nl-bbox-progress");
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
      state.bboxWarnActive = false;
      storeBboxFilter();
      applyFilter();
    });
    state.bboxWarnButton.addEventListener("click", () => {
      if (!bboxFilterSupported()) return;
      state.bboxWarnActive = !state.bboxWarnActive;
      applyFilter();
    });
    state.doneAllButton.addEventListener("click", doneAllSidebarFrames);

    return toolbar;
  }

  function markedScopeMatches() {
    return partStatusMatches(state.markedScope);
  }

  function bboxMarkedScopeMatches() {
    return quickBboxReady() && partStatusMatches(state.bboxMarkedScope);
  }

  function syncMarkedScope() {
    if (!pageLabelingReady()) return false;
    if (!markedScopeMatches()) {
      state.markedFrames.clear();
      state.bboxMarkedFrames.clear();
      state.rangeStart = null;
      state.eyeGSource = null;
      state.genericGSource = null;
      state.seatbeltGSource = null;
      state.vLabelSource = null;
      state.markedScope = currentLabelScope();
      state.bboxMarkedScope = state.markedScope;
    }
    return true;
  }

  function syncBboxMarkedScope() {
    if (!quickBboxReady()) return false;
    syncMarkedScope();
    if (!bboxMarkedScopeMatches()) {
      state.bboxMarkedFrames.clear();
      state.bboxMarkedScope = currentLabelScope();
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

  function setFrameMarker(li, marked, bboxMode) {
    li.classList.toggle("nl-marked-frame", marked);
    const existing = li.querySelector(":scope > .nl-frame-mark");
    if (!marked) {
      existing?.remove();
      return;
    }
    const marker = existing || document.createElement("span");
    const source = !bboxMode && state.vLabelSource?.g === Number(li.dataset.g);
    const text = source ? "◆ V source" : bboxMode ? "◆ V" : "✓ V";
    const title = source ? "First V frame: source for Label actions" : "Frame marked with V";
    if (!existing) {
      marker.className = "nl-frame-mark";
      marker.textContent = text;
      marker.title = title;
      insertBeforeFrameName(li, marker);
    } else {
      if (marker.textContent !== text) marker.textContent = text;
      if (marker.title !== title) marker.title = title;
    }
  }

  // state.markedRows (frame g -> marked li) lets V toggles touch only the rows
  // whose selection changed instead of scanning every sidebar row.
  function syncFrameMarkers(selectedFrames, bboxMode) {
    const rows = state.markedRows;
    if (state.markedRowsMode !== bboxMode) {
      for (const li of rows.values()) setFrameMarker(li, false);
      rows.clear();
      state.markedRowsMode = bboxMode;
    }
    for (const [g, li] of rows) {
      if (selectedFrames.has(g) && li.isConnected) {
        setFrameMarker(li, true, bboxMode);
        continue;
      }
      setFrameMarker(li, false);
      rows.delete(g);
    }
    let navigation;
    for (const g of selectedFrames) {
      if (rows.has(g)) continue;
      navigation ??= organizedNavigationIndex() || false;
      const li = navigation
        ? navigation.all.rows[navigation.all.positions.get(g)]
        : state.list?.querySelector(`li[data-g="${g}"]`);
      if (!li) continue;
      setFrameMarker(li, true, bboxMode);
      rows.set(g, li);
    }
  }

  function syncRangeMarker() {
    const previous = state.rangeRow;
    const g = state.rangeStart;
    const row = Number.isInteger(g)
      ? previous?.isConnected && Number(previous.dataset.g) === g
        ? previous
        : state.list?.querySelector(`li[data-g="${g}"]`)
      : null;
    if (previous && previous !== row) {
      previous.querySelector(".nl-range-mark")?.remove();
      previous.classList.remove("nl-range-start-frame");
    }
    state.rangeRow = row || null;
    if (!row) return;
    row.classList.add("nl-range-start-frame");
    if (!row.querySelector(".nl-range-mark")) {
      const marker = document.createElement("span");
      marker.className = "nl-range-mark";
      marker.textContent = "✓ G";
      marker.title = "Start of the Ctrl+B range (press G again to clear)";
      insertBeforeFrameName(row, marker);
    }
  }

  function updateMarkedUI() {
    const bboxMode = quickBboxReady();
    const ready = bboxMode ? syncBboxMarkedScope() : syncMarkedScope();
    if (!ready) {
      if (state.markedBadge) state.markedBadge.hidden = true;
      return;
    }
    const selectedFrames = bboxMode ? state.bboxMarkedFrames : state.markedFrames;
    syncFrameMarkers(selectedFrames, bboxMode);
    syncRangeMarker();
    if (!state.markedBadge) return;
    const count = selectedFrames.size;
    state.markedBadge.hidden = false;
    state.markedBadge.dataset.count = String(count);
    state.markedBadge.querySelector("b").textContent = bboxMode
      ? `${count} ${S.labelSel} frames marked · V`
      : `${count} selected · V`;
    state.markedBadge.querySelector("button").hidden = count === 0;
    const range = state.markedBadge.querySelector(".nl-range-start-badge");
    range.hidden = !Number.isInteger(state.rangeStart);
    if (!range.hidden) range.textContent = "✓ G start";
    positionMarkedBadge();
  }

  function toggleRangeStart() {
    if (state.operationBusy || anyBulkDialogOpen() || !syncMarkedScope()) return;
    const g = Number(S.shownG);
    if (!Number.isInteger(g) || !S.lseq?.includes(g)) return;
    state.rangeStart = state.rangeStart === g ? null : g;
    state.eyeGSource = null;
    state.genericGSource = null;
    state.seatbeltGSource = null;
    if (state.rangeStart !== null && S.labelSel === "eye_lmk") {
      let items = [];
      try {
        if (typeof ED !== "undefined" && ED.key === rvKey(g) && ED.lab === "eye_lmk" && Array.isArray(ED.items)) {
          items = NL.cloneEyeItems(ED.items);
        }
        if (!items.length && typeof NL.currentEyeItems === "function") items = NL.currentEyeItems();
      } catch (_) {}
      state.eyeGSource = {
        ...currentLabelScope(), g, items,
        selected: typeof LM !== "undefined" && Number.isInteger(LM.n) && LM.n >= 0 && LM.n < items.length
          ? [LM.n] : []
      };
    } else if (state.rangeStart !== null && NL.GENERIC_COPY_LABELS.has(S.labelSel)) {
      const context = NL.currentGenericClipContext?.();
      if (context) state.genericGSource = {
        ...currentLabelScope(), g,
        items: NL.cloneGenericItems(context.sourceItems).filter((item) =>
          S.labelSel !== "face_lmk" || item.pts?.some(Boolean)),
        selected: [...context.selected],
        selectedMode: context.selectedMode,
        selectedRank: context.selectedRank
      };
    } else if (state.rangeStart !== null && S.labelSel === "seatbelt") {
      const generation = S.gen;
      const key = typeof rvKey === "function" ? rvKey(g) : "";
      const liveMask = typeof BT !== "undefined" && BT.key === key && BT.mask?.length
        ? BT.mask.slice() : null;
      state.seatbeltGSource = {
        ...currentLabelScope(), g,
        maskPromise: liveMask?.some(Boolean)
          ? Promise.resolve(liveMask) : NL.getFrameMask(g, generation).catch(() => null)
      };
    }
    updateMarkedUI();
    notify(state.rangeStart === null
      ? "G range start cleared"
      : "G range start set here · Ctrl+B → From G to current frame");
  }

  function clearMarkedFrames() {
    if (quickBboxReady()) state.bboxMarkedFrames.clear();
    else {
      state.markedFrames.clear();
      state.vLabelSource = null;
    }
    updateMarkedUI();
  }

  function captureVLabelSource(g) {
    const scope = { ...currentLabelScope(), g };
    if (S.labelSel === "eye_lmk") {
      let items = [];
      try {
        if (typeof ED !== "undefined" && ED.key === rvKey(g) && ED.lab === "eye_lmk" && Array.isArray(ED.items))
          items = NL.cloneEyeItems(ED.items);
        else items = NL.currentEyeItems();
      } catch (_) {}
      return { ...scope, items, selected: typeof LM !== "undefined" &&
        Number.isInteger(LM.n) && LM.n >= 0 && LM.n < items.length ? [LM.n] : [] };
    }
    if (S.labelSel === "face_lmk") {
      const items = NL.cloneGenericItems(NL.currentGenericItems("face_lmk"))
        .filter((item) => item.pts?.some(Boolean));
      return { ...scope, items, selected: [] };
    }
    if (S.labelSel === "seatbelt") {
      const liveMask = typeof BT !== "undefined" && BT.key === rvKey(g) && BT.mask?.length
        ? BT.mask.slice() : null;
      return { ...scope, maskPromise: liveMask?.some(Boolean)
        ? Promise.resolve(liveMask) : NL.getFrameMask(g, S.gen).catch(() => null) };
    }
    return null;
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
      if (!bboxMode && state.vLabelSource?.g === g) state.vLabelSource = null;
      updateMarkedUI();
      notify(`Current frame unmarked · ${selectedFrames.size} remaining`);
      return;
    }
    if (!bboxMode && !state.vLabelSource && ["eye_lmk", "face_lmk", "seatbelt"].includes(S.labelSel))
      state.vLabelSource = captureVLabelSource(g);
    selectedFrames.add(g);
    updateMarkedUI();
    notify(`${selectedFrames.size} frames marked · Ctrl+B to choose Label actions or Change status`);
  }

  function buildMarkedBadge() {
    const badge = document.createElement("div");
    badge.id = "nl-marked-frames";
    badge.dataset.count = "0";
    badge.innerHTML = `<span class="nl-mark-box">✓</span><b>0 selected · V</b><button type="button" hidden>Clear selection</button><span class="nl-range-start-badge" hidden></span>`;
    badge.querySelector("button").addEventListener("click", clearMarkedFrames);
    document.body.appendChild(badge);
    state.markedBadge = badge;
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

  function closePartStatusMenu(restoreFocus = false) {
    const menu = state.partStatusMenu;
    if (!menu) return;
    state.partStatusMenu = null;
    menu.element.remove();
    menu.button.setAttribute("aria-expanded", "false");
    if (restoreFocus && menu.button.isConnected) menu.button.focus({ preventScroll: true });
  }

  function openPartStatusMenu(row, button) {
    if (button.disabled || !row.isConnected || !partStatusMatches(state.partScopes.get(row))) return;
    if (state.partStatusMenu?.button === button) {
      closePartStatusMenu(true);
      return;
    }
    closePartStatusMenu();
    closeClipStatusMenu();
    const menu = document.createElement("div");
    menu.id = "nl-part-status-menu";
    menu.setAttribute("role", "menu");
    menu.setAttribute("aria-label", `Set all frames in part ${row.dataset.partName}`);
    for (const [value, caption] of [["done", "Done all"], ["wip", "In progress all"]]) {
      const option = document.createElement("button");
      option.type = "button";
      option.setAttribute("role", "menuitem");
      option.dataset.state = value;
      option.textContent = caption;
      option.addEventListener("click", (event) => {
        event.stopPropagation();
        closePartStatusMenu();
        setWholePartState(row, value);
      });
      menu.append(option);
    }
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
    menu.addEventListener("focusout", () => setTimeout(() => {
      if (state.partStatusMenu?.element === menu && !menu.contains(document.activeElement) &&
          document.activeElement !== button) closePartStatusMenu();
    }, 0));
    document.body.append(menu);
    const rect = button.getBoundingClientRect();
    menu.style.left = `${Math.max(8, Math.min(rect.right + 4, innerWidth - menu.offsetWidth - 8))}px`;
    menu.style.top = `${Math.max(8, rect.bottom + menu.offsetHeight <= innerHeight - 8
      ? rect.bottom : rect.top - menu.offsetHeight)}px`;
    state.partStatusMenu = { element: menu, button, row };
    button.setAttribute("aria-expanded", "true");
    menu.querySelector("button")?.focus({ preventScroll: true });
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
    if (!partStatusMatches(operation) || state.operationBusy || state.statusOperationBusy || !details.isConnected ||
        source === value || !FRAME_STATES.includes(source) || !FRAME_STATES.includes(value)) return;
    if (state.bboxActive && state.bboxRefreshTimer) applyFilter();
    const targets = currentFrameLast(clipFrames(details).filter((g) => Number.isInteger(g) && frameState(g) === source));
    if (bboxCountsPendingFor(targets)) {
      notify("Wait for BBox counts to finish loading before changing clip status");
      refreshClipStatusControls(details);
      return;
    }

    if (!targets.length) {
      refreshClipStatusControls(details);
      return;
    }
    state.statusOperationBusy = true;
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
      state.statusOperationBusy = false;
      delete control.dataset.busy;
      control.removeAttribute("aria-busy");
      if (sourceButton.isConnected) sourceButton.textContent = originalText;
      if (control.isConnected && partStatusMatches(operation)) refreshClipStatusControls(details);
      refreshStatusControls();
    }
  }

  async function setWholePartState(row, value) {
    if (!partStatusMatches(state.partScopes.get(row)) || state.operationBusy || state.statusOperationBusy || !row.isConnected) {
      refreshPartStatusControls();
      return;
    }
    if (state.bboxActive && state.bboxRefreshTimer) applyFilter();
    state.partIndex = null;
    const targets = currentFrameLast(partFrames(row).filter((g) => frameState(g) !== value));
    if (!targets.length) { refreshPartStatusControls(); return; }
    if (bboxCountsPendingFor(targets)) {
      notify("Wait for BBox counts to finish loading before changing part status");
      refreshPartStatusControls();
      return;
    }
    const operation = {
      ...currentLabelScope(), name: row.dataset.partName,
      completed: 0, total: targets.length
    };
    state.statusOperationBusy = true;
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
      state.statusOperationBusy = false;
      refreshStatusControls();
    }
  }

  // Unfinished frames listed in the sidebar after part search and the BBox
  // filter; frames in collapsed clips count. Unknown BBox counts are skipped;
  // `loading` counts those whose segment can still be read.
  function sidebarUnfinishedFrames() {
    const cache = state.bboxActive ? bboxCountCache() : null;
    if (state.bboxWarnActive && cache && !cache.warningsReady) {
      return {
        targets: [],
        unknown: cache.warnUnknownFrames || 0,
        loading: Math.max(1, cache.warnLoadingFrames || 0)
      };
    }
    const targets = new Set();
    let unknown = 0;
    let loading = 0;
    for (const row of state.list?.querySelectorAll(":scope > .grp:not([hidden])") || []) {
      for (const li of row.querySelectorAll("li[data-g]:not([hidden])")) {
        if (li.closest(".nl-clip")?.hidden) continue;
        const g = Number(li.dataset.g);
        if (!Number.isInteger(g) || frameState(g) === "done") continue;
        if (cache && bboxCountForFrame(g, cache) === null) {
          unknown += 1;
          const segment = frameSegment(g);
          if (segment !== null && !cache.failed.has(segment)) loading += 1;
          continue;
        }
        targets.add(g);
      }
    }
    return { targets: [...targets], unknown, loading };
  }

  function currentFrameLast(frames) {
    const current = Number(S.shownG);
    if (!Number.isInteger(current) || !frames.includes(current)) return frames;
    return [...frames.filter((g) => g !== current), current];
  }

  async function doneAllSidebarFrames() {
    if (!pageLabelingReady() || state.operationBusy || state.statusOperationBusy) return;
    applyFilter();
    // Wait only for listed frames; segments read for auto_load_img elsewhere do not block.
    const listed = sidebarUnfinishedFrames();
    const targets = currentFrameLast(listed.targets);
    const { unknown, loading } = listed;
    if (loading) {
      notify("Wait for BBox counts to finish loading before using Done all");
      return;
    }
    if (!targets.length) {
      notify(unknown ? "No frames with a known BBox count to mark Done" : "All frames in the sidebar are already Done");
      return;
    }
    const operation = currentLabelScope();
    const skipped = unknown ? ` ${unknown} frames with unknown BBox counts will be skipped.` : "";
    if (!window.confirm(`Mark ${targets.length} unfinished frames in the sidebar Done for ${operation.label}?${skipped}`)) return;
    if (state.operationBusy || state.statusOperationBusy || !partStatusMatches(operation)) return;
    const button = state.doneAllButton;
    state.statusOperationBusy = true;
    button.disabled = true;
    button.textContent = `0/${targets.length}`;
    refreshStatusControls();
    try {
      if (typeof pause === "function") pause();
      const result = await runQueue(targets, async (g) => {
        if (!partStatusMatches(operation)) throw new Error("The session or label has changed");
        await saveFrameState(g, operation.label, "done", operation.generation, operation.session);
      }, (completed) => { button.textContent = `${completed}/${targets.length}`; });
      if (partStatusMatches(operation)) {
        if (typeof fsRender === "function") fsRender();
        notify(result.error
          ? `Done all: saved ${result.completed}/${targets.length}; stopped on error: ${result.error.message}`
          : `Done all: ${targets.length} frames set to Done`);
      }
    } finally {
      state.statusOperationBusy = false;
      button.textContent = "Done all";
      refreshStatusControls();
      applyFilter();
    }
  }

  function bboxFilterSupported() {
    return pageLabelingReady() && BBOX_LABELS.has(S.labelSel);
  }

  // Count state for the current session/generation/label. Auto-labels do not
  // change within a scope, so their per-frame counts are computed only once.
  function bboxCountCache() {
    const cache = state.bboxCounts;
    if (partStatusMatches(cache)) return cache;
    state.bboxCounts = {
      ...currentLabelScope(),
      auto: new Map(), // g -> auto-label box count
      empty: new Set(), // segments without auto-labels
      failed: new Set(), // segments whose auto-labels could not be read
      warnings: new Map(), // g -> { codes, label, title }
      warningsReady: false,
      warningsSignature: "",
      warnTotalFrames: 0,
      warnLoadingFrames: 0,
      warnUnknownFrames: 0,
      warnOrder: []
    };
    return state.bboxCounts;
  }

  function countValidBoxes(items) {
    if (!Array.isArray(items)) return 0;
    let count = 0;
    for (const item of items) {
      if (parseBoxBounds(item?.box)) count += 1;
    }
    return count;
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
      if (!data || data instanceof Promise) {
        if (!cache.empty.has(segmentIndex)) return null;
        cache.auto.set(g, 0);
        return 0;
      }
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
    const statusAllowed = state.statusFilters
      ? state.statusFilters[frameState(g)] !== false
      : !(typeof S !== "undefined" && S.onlyTodo && frameState(g) === "done");
    if (!statusAllowed) return false;
    if (!state.bboxActive) return true;
    const cache = state.bboxCounts;
    if (!partStatusMatches(cache)) return null;
    const count = bboxCountForFrame(g, cache);
    if (count === null) {
      const segment = frameSegment(g);
      if (cache.failed.has(segment)) return true;
      if (segment !== null) requestExtraBboxSegment(cache, segment);
      return null;
    }
    if (state.bboxFilter.length > 0 && !state.bboxFilter.includes(count)) return false;
    if (state.bboxWarnActive) {
      if (!cache.warningsReady) return null;
      return cache.warnings.has(g);
    }
    return true;
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
    if (state.bboxLoad) {
      state.bboxLoad.queue = [];
      state.bboxLoad.extra.clear();
    }
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

  function updateBboxProgress(active, totalFrames, matchedFrames, unknownFrames, loadingFrames, load, pending) {
    const wrap = state.bboxProgressWrap;
    if (!wrap) return;
    wrap.hidden = !active;
    if (!active) return;
    const countedFrames = totalFrames - unknownFrames;
    const processedFrames = totalFrames - loadingFrames;
    const isCounting = pending > 0 || loadingFrames > 0;
    const progressState = isCounting ? "loading" : unknownFrames > 0 ? "partial" : "done";
    wrap.dataset.state = progressState;
    state.bboxProgress.dataset.state = progressState;

    const totalLoads = load ? load.completed + pending : 0;
    const max = isCounting && loadingFrames === 0 && totalLoads > 0
      ? totalLoads
      : Math.max(1, totalFrames);
    const value = isCounting
      ? (loadingFrames === 0 && totalLoads > 0 ? load.completed : processedFrames)
      : (unknownFrames > 0 ? countedFrames : max);
    const percent = isCounting
      ? Math.min(99, Math.floor((value / max) * 100))
      : (totalFrames > 0 ? Math.floor((countedFrames / totalFrames) * 100) : 100);

    state.bboxProgress.max = max;
    state.bboxProgress.value = Math.min(max, Math.max(0, value));

    const segInfo = totalLoads > 0 ? ` · ${load.completed}/${totalLoads} segs` : "";
    const text = isCounting
      ? `Counting ${countedFrames.toLocaleString()}/${totalFrames.toLocaleString()} frames · ${matchedFrames.toLocaleString()} matched${segInfo}`
      : unknownFrames > 0
        ? `Counted ${countedFrames.toLocaleString()}/${totalFrames.toLocaleString()} frames · ${matchedFrames.toLocaleString()} matched · ${unknownFrames.toLocaleString()} unknown`
        : `✓ Counted ${totalFrames.toLocaleString()}/${totalFrames.toLocaleString()} frames · ${matchedFrames.toLocaleString()} matched`;
    const pctText = `${percent}%`;
    if (state.bboxProgressText.textContent !== text) state.bboxProgressText.textContent = text;
    if (state.bboxProgressPct.textContent !== pctText) state.bboxProgressPct.textContent = pctText;
    wrap.title = `${text} (${pctText})`;
  }

  function filterPartRowClips(row, active, countActive, warnActive, modeChanged, cache, metrics) {
    const clips = row.querySelectorAll(":scope > .nl-clips > .nl-clip");
    if (!clips.length) return true;
    let partVisible = false;
    for (const clip of clips) {
      let clipVisible = false;
      let clipChanged = modeChanged;
      for (const li of clip.querySelectorAll("li[data-g]")) {
        let keep = true;
        let warning = null;
        if (active) {
          const g = Number(li.dataset.g);
          const isCurrent = li.classList.contains("cur");
          if (isCurrent) {
            metrics.passedCurrent = true;
            metrics.currentSegment = frameSegment(g);
          }
          const count = bboxCountForFrame(g, cache);
          metrics.totalFrames += 1;
          if (count === null) {
            metrics.unknownFrames += 1;
            const segment = isCurrent ? metrics.currentSegment : frameSegment(g);
            if (segment !== null && !cache.failed.has(segment)) {
              metrics.loadingFrames += 1;
              if (!metrics.queued.has(segment)) {
                metrics.queued.add(segment);
                (metrics.passedCurrent ? metrics.ahead : metrics.behind).push(segment);
              }
            }
          } else {
            if (countActive && !state.bboxFilter.includes(count)) keep = false;
            if (keep && warnActive) {
              if (cache.warningsReady) {
                warning = cache.warnings.get(g) || null;
                keep = warning !== null;
              }
            }
            if (keep && (!warnActive || cache.warningsReady)) {
              metrics.matchedFrames += 1;
            }
          }
          if (keep) metrics.visibleFrames += 1;
        }
        if (warnActive || state.bboxWarnApplied) {
          setFrameWarnBadge(li, keep ? warning : null);
        }
        if (li.hidden === keep) {
          li.hidden = !keep;
          clipChanged = true;
        }
        if (keep) clipVisible = true;
      }
      if (clip.hidden === clipVisible) clip.hidden = !clipVisible;
      if (clipVisible) {
        partVisible = true;
        if (clipChanged) refreshClipSummary(clip);
      }
    }
    return partVisible;
  }

  function updateBboxFilterControls(supported, active, warnActive, cache, query, rowsCount, visibleParts, metrics) {
    const caption = query || active ? `${visibleParts}/${rowsCount} part` : `${rowsCount} part`;
    if (state.status.textContent !== caption) state.status.textContent = caption;

    const invalid = state.bboxInput.getAttribute("aria-invalid") === "true";
    state.bboxInput.disabled = !supported;
    state.bboxAllButton.disabled = !supported;
    if (state.bboxWarnButton) {
      state.bboxWarnButton.disabled = !supported;
      state.bboxWarnButton.setAttribute("aria-pressed", String(warnActive));
    }
    state.doneAllButton.disabled = !pageLabelingReady() || state.operationBusy || state.statusOperationBusy;
    state.bboxAllButton.setAttribute("aria-pressed", String(!state.bboxFilter.length && !warnActive));
    const load = state.bboxLoad;
    const rawPending = load ? load.queue.length + load.running : 0;
    const pending = rawPending + (warnActive && cache && !cache.warningsReady && !rawPending ? 1 : 0);
    const bboxCaption = !supported ? "Unavailable for this label" : invalid ? "Use 2,3,4" : !active ? "" :
      `${metrics.visibleFrames}/${metrics.totalFrames} frames` +
      (pending ? ` · loading ${load ? load.completed : 0}/${(load ? load.completed : 0) + pending}` :
        metrics.unknownFrames ? ` · ${metrics.unknownFrames} unknown` : "");
    if (state.bboxStatus.textContent !== bboxCaption) state.bboxStatus.textContent = bboxCaption;
    state.bboxStatus.title = bboxCaption;
    updateBboxProgress(
      active, metrics.totalFrames, metrics.matchedFrames,
      metrics.unknownFrames, metrics.loadingFrames, load, pending
    );

    if (!state.empty) {
      state.empty = document.createElement("div");
      state.empty.className = "nl-empty-filter";
    }
    const emptyMessage = active
      ? (warnActive && !state.bboxFilter.length ? "No frames with BBox warnings." : "No frames match the BBox filter.")
      : "No matching parts.";
    if (state.empty.textContent !== emptyMessage) state.empty.textContent = emptyMessage;
    const shouldShowEmpty = Boolean((query || active) && rowsCount && !visibleParts);
    if (shouldShowEmpty && !state.empty.isConnected) state.list.prepend(state.empty);
    else if (!shouldShowEmpty && state.empty.isConnected) state.empty.remove();
  }

  function applyFilter() {
    state.navigation = null;
    if (!state.list || !state.status) return;
    const query = normalize(state.filter);
    const rows = Array.from(state.list.querySelectorAll(":scope > .grp"));
    const supported = bboxFilterSupported();
    const countActive = supported && state.bboxFilter.length > 0;
    const warnActive = supported && Boolean(state.bboxWarnActive);
    const active = countActive || warnActive;
    if (active || state.bboxActive) state.bboxRevision += 1;
    const cache = active ? bboxCountCache() : null;
    if (warnActive) prepareSessionWarnings(cache);
    // Clip summaries count only listed rows while the filter applies; refresh a
    // clip when its listed rows or that counting mode change.
    const modeChanged = active !== state.bboxActive || (warnActive && cache.warningsReady !== state.bboxWarnApplied);
    state.bboxActive = active;
    // Frame rows are visited only while the BBox filter applies, plus one pass to unhide them.
    const touchFrames = active || state.bboxHiddenApplied || state.bboxWarnApplied;
    state.bboxHiddenApplied = active;
    const metrics = {
      totalFrames: 0, visibleFrames: 0, matchedFrames: 0, unknownFrames: 0, loadingFrames: 0,
      queued: new Set(), behind: [], ahead: [], passedCurrent: false, currentSegment: null
    };
    let visible = 0;

    for (const row of rows) {
      const partName = row.dataset.partName || row.querySelector(":scope > .vlab")?.textContent || "";
      const matched = !query || normalize(partName).includes(query);
      const partVisible = touchFrames && (matched || !active)
        ? filterPartRowClips(row, active, countActive, warnActive, modeChanged, cache, metrics)
        : !active;
      const hidePart = !matched || !partVisible;
      if (row.hidden !== hidePart) row.hidden = hidePart;
      if (!hidePart) visible += 1;
    }

    if (!warnActive && state.bboxWarnApplied) {
      for (const badge of state.list.querySelectorAll(".nl-warn-badge")) badge.remove();
      state.bboxWarnApplied = false;
    } else if (warnActive) {
      state.bboxWarnApplied = Boolean(cache.warningsReady);
    }

    if (active) {
      const { currentSegment, ahead, behind } = metrics;
      const order = currentSegment !== null && behind.includes(currentSegment)
        ? [currentSegment, ...ahead, ...behind.filter((segment) => segment !== currentSegment)]
        : [...ahead, ...behind];
      const fullOrder = warnActive ? [...new Set([...order, ...(cache.warnOrder || [])])] : order;
      requestBboxSegments(cache, fullOrder);
    } else {
      cancelBboxLoads();
    }

    if (touchFrames) refreshPartStatusControls();
    updateBboxFilterControls(supported, active, warnActive, cache, query, rows.length, visible, metrics);
  }

  Object.assign(NL, {
    buildToolbar, markedScopeMatches, bboxMarkedScopeMatches, syncMarkedScope,
    syncBboxMarkedScope, positionMarkedBadge, setFrameMarker, syncFrameMarkers, updateMarkedUI,
    clearMarkedFrames, toggleMarkedFrame, toggleRangeStart, buildMarkedBadge, closeClipStatusMenu,
    closePartStatusMenu, openPartStatusMenu,
    scheduleCloseClipStatusMenu, openClipStatusMenu, setClipSourceState, setWholePartState,
    sidebarUnfinishedFrames, doneAllSidebarFrames, bboxFilterSupported, bboxCountCache,
    countValidBoxes, bboxCountForFrame, bboxFilterWants, bboxLoadFor,
    requestBboxSegments, requestExtraBboxSegment, pumpBboxLoads, cancelBboxLoads,
    scheduleBboxFilterRefresh, refreshBboxFilter, updateBboxProgress, filterPartRowClips,
    updateBboxFilterControls, applyFilter
  });
})();
