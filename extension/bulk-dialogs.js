(() => {
  "use strict";

  const NL = window.__notaOrganizerV1 = window.__notaOrganizerV1 || {};
  const {
    BBOX_COPY_DUPLICATE_IOU_THRESHOLD, BBOX_COPY_MATCH_CONTAINMENT_THRESHOLD,
    BBOX_COPY_MATCH_IOU_THRESHOLD, BBOX_COPY_MATCH_LONG_AXIS_THRESHOLD,
    BBOX_COPY_MATCH_NARROW_AXIS_THRESHOLD, BBOX_COPY_MATCH_SIZE_THRESHOLD, BULK_TAB_KEY,
    FRAME_STATES, GENERIC_COPY_LABELS, QUICK_BBOX_LABELS, activeClipBaseContext,
    anyBulkDialogOpen, bboxCountsPendingFor, bboxHorizontalOrder, bboxIntersectionOverSmaller,
    bboxIntersectionOverUnion, bboxMarkedScopeMatches, bboxOverlapMetrics, cancelManualMode,
    clampBboxEdgeCoord, clipListedFrames, cloneEyeItems, cloneGenericItems,
    currentEyeClipContext, currentGenericClipContext, currentLabelScope, frameClipKey,
    frameState, genericLabelName, getFrameEyeItems, getFrameGenericItems, getFrameMask,
    maskBulkBlockReason, mergeEyeLandmarks, notify, pageLabelingReady, partStatusMatches,
    patchMatchesContext, quickBboxReady, refreshStatusControls, rememberBboxUndo, runQueue,
    sameGenericItem, saveFrameEyeItems, saveFrameGenericItems, saveFrameMask, saveFrameState,
    sessionLabelFrames, sidebarVisibleFrameSet, sliceBulkCandidates, state, statusName,
    syncBboxMarkedScope, syncMarkedScope, updateMarkedUI
  } = NL;

  function bboxDimensionSimilarity(left, right) {
    const metrics = bboxOverlapMetrics(left, right);
    if (!metrics || !metrics.widthA || !metrics.heightA || !metrics.widthB || !metrics.heightB) return null;
    const width = Math.min(metrics.widthA, metrics.widthB) / Math.max(metrics.widthA, metrics.widthB);
    const height = Math.min(metrics.heightA, metrics.heightB) / Math.max(metrics.heightA, metrics.heightB);
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
      clampBboxEdgeCoord(target.box, coord, width, height);
      return next;
    }
    return next;
  }

  function bulkStatusFrames() {
    if (state.bboxActive) {
      const visible = sidebarVisibleFrameSet();
      return visible ? [...visible.keys()].sort((a, b) => a - b) : [];
    }
    return sessionLabelFrames();
  }

  function bulkMarkedFrames() {
    if (quickBboxReady()) {
      syncBboxMarkedScope();
      return state.bboxMarkedFrames;
    }
    syncMarkedScope();
    return state.markedFrames;
  }

  function selectedGRangeTargets(context, includeCurrent) {
    syncMarkedScope();
    if (!Number.isInteger(state.rangeStart)) {
      return { targets: [], error: "No G start frame. Close this dialog and press G on the first frame." };
    }
    if (!context || context.sourceIndex < 0) {
      return { targets: [], error: "Open a frame in the current label's clip first." };
    }
    const startIndex = context.frames.indexOf(state.rangeStart);
    if (startIndex < 0) {
      return { targets: [], error: "The G start frame is outside this clip or the current BBox filter." };
    }
    const from = Math.min(startIndex, context.sourceIndex);
    const to = Math.max(startIndex, context.sourceIndex);
    const targets = context.frames.slice(from, to + 1)
      .filter((g) => includeCurrent || g !== context.source);
    return { targets, error: targets.length ? "" : "G is on the current frame. Move to another frame before applying a label action." };
  }

  function prepareBulkStatusContext() {
    const allowed = bulkStatusFrames();
    const source = Number(S.shownG);
    const sourceClip = typeof clipAt === "function" ? frameClipKey(source) : null;
    const row = state.list?.querySelector(`li[data-g="${source}"]`);
    const details = row?.closest(".nl-clip");
    const frames = state.bboxActive
      ? clipListedFrames(details, row)
      : sourceClip !== null ? allowed.filter((g) => frameClipKey(g) === sourceClip) :
      clipListedFrames(details);
    state.bulkStatusContext = {
      ...currentLabelScope(), source,
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
        <button type="button" data-status-direction="range">✓ From G to current frame</button>
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
    if (state.bulkStatusDirection === "range") return selectedGRangeTargets(context, true);
    if (context.sourceIndex < 0) return { targets: [], error: "Open a frame in the current label's clip first." };
    // Status counts include the frame currently being viewed. Label actions
    // use their own target selectors and continue to exclude the source frame.
    const candidates = state.bulkStatusDirection === "before"
      ? [context.source, ...context.frames.slice(0, context.sourceIndex).reverse()]
      : [context.source, ...context.frames.slice(context.sourceIndex + 1)];
    return sliceBulkCandidates(
      candidates,
      dialog.querySelector(".nl-status-count").value,
      "No more frames in this direction within the current clip."
    );
  }

  function updateBulkStatusPanel(dialog) {
    const context = state.bulkStatusContext;
    if (!context) return;
    for (const button of dialog.querySelectorAll("[data-status-direction]")) {
      button.classList.toggle("on", button.dataset.statusDirection === state.bulkStatusDirection);
    }
    const marked = Array.from(bulkMarkedFrames()).filter((g) => context.allowed.has(g)).length;
    dialog.querySelector('[data-status-direction="marked"]').textContent = `◆ Marked frames (${marked})`;
    dialog.querySelector(".nl-status-count").disabled = ["marked", "range"].includes(state.bulkStatusDirection);
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
        : state.bulkStatusDirection === "range"
          ? "From G to this frame, inclusive, within this clip. No count needed."
        : state.bboxActive
          ? "Within this clip's frames shown by the BBox filter, including the current frame."
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
    if (state.bboxActive && state.bulkStatusDirection !== "marked" && Number.isInteger(context?.source)) {
      allowed.add(context.source);
    }
    const targets = picked.targets.filter((g) => allowed.has(g) && frameState(g) !== value);
    if (bboxCountsPendingFor(targets)) {
      notify("Wait for BBox counts to finish loading before changing frame status");
      updateBulkStatusPanel(dialog);
      return;
    }
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
          <button type="button" data-eye-direction="range">✓ From G to current frame</button>
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
      const visible = sidebarVisibleFrameSet();
      const targets = Array.from(state.bboxMarkedFrames).filter((g) =>
        Number.isInteger(g) && g !== context.source && S.lseq?.includes(g) && (!visible || visible.has(g)));
      return targets.length
        ? { targets, error: "" }
        : { targets: [], error: "No target frames marked yet. Press V to mark frames." };
    }
    if (state.eyeBulkDirection === "range") return selectedGRangeTargets(context, false);
    const candidates = state.eyeBulkDirection === "before"
      ? context.frames.slice(0, context.sourceIndex).reverse()
      : context.frames.slice(context.sourceIndex + 1);
    return sliceBulkCandidates(
      candidates,
      state.eyeBulkDialog.querySelector(".nl-count").value,
      "No more frames in the selected direction within this clip."
    );
  }

  function formatEyeBulkPreview(context, operation, operationMode, eyeMode, boxMode, scope, writeMode, sourceCount, picked) {
    if (picked.error) return picked.error;
    if (!sourceCount) return `This frame has no ${context.labelName} objects to copy.`;
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
        ? `Set the ${operation.edge} ${context.labelName} edge to ${Number(operation.value).toFixed(1)} px`
        : `Copy ${sourceCount} ${eyeMode ? "eye groups" : boxMode ? "boxes" : "face 7pt groups"}`;
    const targetText = state.eyeBulkDirection === "range"
      ? `${picked.targets.length} frames from G to the current frame (source excluded)`
      : `${picked.targets.length} ${directionText} frames`;
    return `${actionText} across ${targetText}` +
      (operation?.type === "edge" ? " · keep the target box's other three edges; leave frames without a matching box unchanged" :
        operationMode ? " · keep other boxes and edges" : ` · ${writeText}`) +
      (skipped ? ` · skip ${skipped} Done frames` : "") + ". Up to 4 requests run at a time.";
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
    const visibleMarkedSet = sidebarVisibleFrameSet();
    const visibleMarkedCount = bboxMarkedScopeMatches()
      ? Array.from(state.bboxMarkedFrames).filter((g) => !visibleMarkedSet || visibleMarkedSet.has(g)).length
      : 0;
    markedButton.textContent = `◆ Marked frames (${visibleMarkedCount})`;
    if (!quickMode && state.eyeBulkDirection === "marked") state.eyeBulkDirection = "after";
    dialog.querySelector(".nl-count").disabled = ["marked", "range"].includes(state.eyeBulkDirection);
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
    dialog.querySelector(".nl-item-merge-text").textContent = eyeMode ? "Replace matching eyes and keep the others" : "";
    dialog.querySelector(".nl-item-replace-text").textContent = eyeMode ? "Replace all eyes in target frames" : "";
    dialog.querySelector(".nl-sub").textContent =
      `${context.clip} · source frame ${context.sourceIndex + 1}/${context.frames.length} · label ${context.labelName}.`;
    const picked = selectedEyeBulkTargets();
    const preview = dialog.querySelector(".nl-preview");
    preview.classList.toggle("err", Boolean(picked.error) || !sourceCount);
    preview.textContent = formatEyeBulkPreview(
      context, operation, operationMode, eyeMode, boxMode, scope, writeMode, sourceCount, picked
    );
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
    return activeClipBaseContext("seatbelt");
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
          <button type="button" data-direction="range">✓ From G to current frame</button>
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
    if (state.bulkDirection === "range") return selectedGRangeTargets(context, false);
    const candidates = state.bulkDirection === "before"
      ? context.frames.slice(0, context.sourceIndex).reverse()
      : context.frames.slice(context.sourceIndex + 1);
    return sliceBulkCandidates(
      candidates,
      state.bulkDialog.querySelector(".nl-count").value,
      "No more frames in the selected direction within this clip."
    );
  }

  function updateBulkDialog() {
    const dialog = state.bulkDialog;
    const context = state.bulkContext;
    if (!dialog || !context) return;
    dialog.querySelector(".nl-apply").textContent = "Apply · Enter";
    for (const button of dialog.querySelectorAll("[data-direction]")) {
      button.classList.toggle("on", button.dataset.direction === state.bulkDirection);
    }
    dialog.querySelector(".nl-count").disabled = state.bulkDirection === "range";

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
      preview.textContent = `${action} ${picked.targets.length} target frames · ${state.bulkDirection === "range" ? "between G and" : state.bulkDirection === "after" ? "after" : "before"} the current frame` +
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
        const value = operation === "subtract" ? 0 : 1;
        let changed = false;
        for (let index = 0; index < targetMask.length; index += 1) {
          if (!sourceMask[index] || targetMask[index] === value) continue;
          targetMask[index] = value;
          changed = true;
        }
        if (changed) await saveFrameMask(g, targetMask, context.generation);
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

  Object.assign(NL, {
    bboxDimensionSimilarity, bboxCopyMatchScore, findGenericBboxMatches,
    mergeCopiedGenericBbox, applyQuickOperationToItems, bulkStatusFrames, bulkMarkedFrames,
    prepareBulkStatusContext, installBulkTabs, selectBulkTab, showBulkDialog,
    emptyLabelBulkContext, selectedStatusTargets, updateBulkStatusPanel, applyBulkStatus,
    ensureEyeBulkDialog, cancelEyeBulkDialog, selectedEyeBulkTargets, formatEyeBulkPreview,
    updateEyeBulkDialog, openEyeBulkDialog, openGenericBulkDialog, currentClipContext,
    ensureBulkDialog, cancelBulkDialog, selectedBulkTargets, updateBulkDialog, openBulkDialog,
    applyEyeBulkCopy, applyItemBulkCopy, applyGenericBulkCopy, applyBulkAction, applyBulkCopy
  });
})();
