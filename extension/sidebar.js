(() => {
  "use strict";

  const NL = window.__notaOrganizerV1 = window.__notaOrganizerV1 || {};
  const {
    FRAME_STATES, STATUS_FILTER_KEY, currentLabelScope, frameState, insertBeforeFrameName,
    loadAutoLabel, notify, pageLabelingReady, partStatusMatches, sessionLabelFrames, state, statusIcon,
    statusName
  } = NL;
  const cancelBboxLoads = (...args) => NL.cancelBboxLoads(...args);
  const closeClipStatusMenu = (...args) => NL.closeClipStatusMenu(...args);
  const enhance = (...args) => NL.enhance(...args);
  const openClipStatusMenu = (...args) => NL.openClipStatusMenu(...args);
  const scheduleCloseClipStatusMenu = (...args) => NL.scheduleCloseClipStatusMenu(...args);
  const setWholePartState = (...args) => NL.setWholePartState(...args);
  const updateMarkedUI = (...args) => NL.updateMarkedUI(...args);

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

  function framePartKey(g) {
    const clip = clipAt(g);
    return clip ? (clip.long ? "__long" : clip.cat) : "__none";
  }

  function frameClipKey(g) {
    const clip = clipAt(g);
    return JSON.stringify([framePartKey(g), clip?.long ? clip.cat : clip?.n ?? null]);
  }

  function clipFrames(details) {
    if (state.bboxActive) return clipListedFrames(details);
    const visible = clipListedFrames(details);
    const row = details.closest(".grp");
    if (!row || !visible.length) return visible;
    partFrames(row); // Build the shared complete-label index, including hidden frames.
    return state.partIndex?.clips.get(frameClipKey(visible[0])) || visible;
  }

  function partFrames(row) {
    const visible = () => Array.from(row.querySelectorAll(state.bboxActive ? "li[data-g]:not([hidden])" : "li[data-g]"), (li) => Number(li.dataset.g));
    if (state.bboxActive || !S.review || typeof rvG !== "function" || typeof clipAt !== "function") return visible();
    let index = state.partIndex;
    if (!partStatusMatches(index) || index.review !== S.review) {
      index = { ...currentLabelScope(), review: S.review, groups: new Map(), clips: new Map() };
      for (const g of sessionLabelFrames()) {
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

  function clipVisibleItems(details) {
    return Array.from(details.querySelectorAll(state.bboxActive ? "li[data-g]:not([hidden])" : "li[data-g]"));
  }

  function clipListedFrames(details, includeRow = null) {
    if (!details) return [];
    return Array.from(details.querySelectorAll("li[data-g]"))
      .filter((li) => !state.bboxActive || !li.hidden || li === includeRow)
      .map((li) => Number(li.dataset.g))
      .filter(Number.isInteger);
  }

  function activeClipBaseContext(label) {
    if (!pageLabelingReady(label)) return null;
    const current = state.list?.querySelector(`li[data-g="${S.shownG}"]`) || state.list?.querySelector("li.cur");
    const details = current?.closest(".nl-clip");
    if (!details) return null;
    const frames = clipListedFrames(details, current);
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

  function organizedNavigationIndex() {
    if (!state.list || typeof S === "undefined") return null;
    const cached = state.navigation;
    if (partStatusMatches(cached) && cached.sequence === S.lseq &&
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
      ...currentLabelScope(),
      sequence: S.lseq,
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

  function prepareLandmarkFrame(g) {
    if (S.labelSel !== "face_lmk" && S.labelSel !== "eye_lmk") {
      state.landmarkEditorScope = null;
      return;
    }
    const previous = state.landmarkEditorScope;
    if (previous?.session === S.sess && previous.generation === S.gen &&
        previous.label === S.labelSel && previous.frame === g) return;
    state.landmarkEditorScope = {
      session: S.sess, generation: S.gen, label: S.labelSel, frame: g
    };
    // The native editor keys landmark data by segment name + local index. In
    // collected/grouped parts those keys can repeat across source segments.
    // Force a fresh read for each global frame so rapid navigation cannot
    // reuse a partial point set (most visibly a missing face point 0).
    if (typeof ED !== "undefined" && ED) ED.key = null;
    if (typeof LM !== "undefined" && LM) {
      LM.key = null;
      LM.sig = null;
    }
  }

  function ensureOrganizedPlayback() {
    if (!state.annotationReadyShowInstalled && typeof show === "function" &&
        typeof getFrame === "function" && typeof drawBar === "function") {
      const nativeShow = show;
      show = async function (target) {
        if (!pageLabelingReady() || !Number.isFinite(Number(target))) {
          return nativeShow.apply(this, arguments);
        }
        const g = Math.max(0, Math.min(S.G - 1, Number(target)));
        const request = {
          token: ++state.annotationShowToken,
          session: S.sess,
          generation: S.gen,
          label: S.labelSel,
          width: S.w,
          quality: S.q,
          g
        };
        const stillCurrent = () => state.annotationShowToken === request.token &&
          S.mode === "label" && S.sess === request.session && S.gen === request.generation &&
          S.labelSel === request.label && S.w === request.width && S.q === request.quality && S.g === g;
        // Update the navigation cursor immediately so repeated D/A presses can
        // keep moving, but retain the previous displayed image until both the
        // target bitmap and its annotations are ready.
        S.g = g;
        drawBar();
        const spinner = document.getElementById("spin");
        if (spinner) spinner.hidden = false;
        let imageError = null, annotationError = null;
        try {
          await Promise.all([
            Promise.resolve(getFrame(g)).catch((error) => { imageError = error; }),
            requestPlaybackAutoLabel(g).catch((error) => { annotationError = error; })
          ]);
          if (!stillCurrent()) return;
          if (imageError) return nativeShow.call(this, g);
          if (annotationError) {
            notify("Unable to load annotations. Press A or D to retry.");
            return;
          }
          prepareLandmarkFrame(g);
          return await nativeShow.call(this, g);
        } catch (_) {
          if (!stillCurrent()) return;
          return nativeShow.call(this, g);
        } finally {
          if (state.annotationShowToken === request.token && spinner) spinner.hidden = true;
        }
      };
      state.annotationReadyShowInstalled = true;
    }
    if (!state.organizedPlaybackInstalled && typeof playNext === "function") {
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
    if (state.organizedPlaybackLoopInstalled || typeof loop !== "function" ||
        typeof getFrame !== "function" || typeof fkey !== "function" || typeof SPEEDS === "undefined") return;
    const nativeLoop = loop;
    loop = function (token) {
      if (!pageLabelingReady() || !organizedNavigationIndex()) return nativeLoop.apply(this, arguments);
      return runOrganizedPlayback(token);
    };
    state.organizedPlaybackLoopInstalled = true;
  }

  function playbackAutoLabelSegment(g) {
    if (typeof loc !== "function" || !S.al || typeof S.al.has !== "function") return null;
    try {
      const segment = Number(loc(g)?.[0]);
      return Number.isInteger(segment) && segment >= 0 && segment < (S.sess?.segments?.length || 0)
        ? segment
        : null;
    } catch (_) {
      return null;
    }
  }

  function playbackFrameHasSavedLabel(g) {
    if (typeof rvKey !== "function") return false;
    try {
      const edits = S.ledits?.[rvKey(g)];
      return Boolean(edits && Object.prototype.hasOwnProperty.call(edits, S.labelSel));
    } catch (_) {
      return false;
    }
  }

  function requestPlaybackAutoLabel(g) {
    if (playbackFrameHasSavedLabel(g)) return Promise.resolve(null);
    const segment = playbackAutoLabelSegment(g);
    if (segment === null) return Promise.resolve(null);
    try {
      return Promise.resolve(loadAutoLabel(segment)).then((data) => {
        const expectsAnnotations = Boolean(S.sess?.segments?.[segment]?.al);
        if (expectsAnnotations && (!data || typeof data.frames !== "object")) {
          // Native ensureAL stores null after a failed request. Remove that
          // sentinel so the next navigation can retry instead of pinning an
          // empty landmark/bbox editor to the frame.
          if (S.al?.get(segment) === null) S.al.delete(segment);
          throw new Error("Annotation data is unavailable");
        }
        return data;
      });
    } catch (error) {
      return Promise.reject(error);
    }
  }

  function pendingAutoLabelLoads() {
    if (!S.al || typeof S.al.values !== "function") return 0;
    let pending = 0;
    for (const value of S.al.values()) {
      if (value && typeof value.then === "function") pending += 1;
    }
    return pending;
  }

  function warmPlaybackAutoLabels(from, step, count = 12) {
    if (!S.al || typeof S.al.has !== "function") return;
    let pending = pendingAutoLabelLoads();
    let g = from;
    for (let offset = 0; offset < count && pending < 2; offset += 1) {
      const next = playNext(g, step);
      if (next === g) break;
      g = next;
      if (playbackFrameHasSavedLabel(g)) continue;
      const segment = playbackAutoLabelSegment(g);
      if (segment === null || S.al.has(segment)) continue;
      pending += 1;
      loadAutoLabel(segment).catch(() => null);
    }
  }

  async function runOrganizedPlayback(token) {
    const session = S.sess, generation = S.gen, label = S.labelSel, width = S.w, quality = S.q;
    const alive = () => S.playing && S.tok === token;
    const sameScope = () => S.mode === "label" && S.sess === session && S.gen === generation &&
      S.labelSel === label && S.w === width && S.q === quality;
    let presentedAt = performance.now();
    try {
      while (alive() && sameScope()) {
        const navigation = organizedNavigationIndex();
        if (!navigation) return;
        const from = S.g, speedIndex = S.speedI;
        const speed = Number(SPEEDS[speedIndex]) || 1;
        const step = speed <= 2 ? 1 : Math.round(speed / 2);
        const next = playNext(from, step);
        if (next === from) return;
        const stillCurrent = () => alive() && sameScope() && S.g === from && S.speedI === speedIndex &&
          organizedNavigationIndex() === navigation;
        let bitmap;
        try {
          // Load the image and its segment annotations together. Presenting a
          // cached image before auto-labels arrive makes the native editor pin
          // an empty bbox list until the user leaves and revisits the frame.
          const autoLabel = requestPlaybackAutoLabel(next);
          const requested = getFrame(next);
          warmPlaybackAutoLabels(next, step);
          // Request the displayed frame first, before warming three successors.
          // Reuse the viewer cache / two-part preloader; do not fill all six
          // native request slots with later images ahead of the needed image.
          for (let offset = 0, g = next; offset < 3 && S.inflight.size < 4; offset++) {
            const following = playNext(g, step);
            if (following === g) break;
            g = following;
            if (!S.frames.has(fkey(g))) getFrame(g).catch(() => {});
          }
          bitmap = await requested;
          await autoLabel;
        } catch (_) {
          if (stillCurrent()) {
            notify("Unable to load the next image. Press Space to retry.");
            return;
          }
          continue;
        }
        if (!stillCurrent()) continue;
        if (!bitmap) return;
        // Label rows are selected samples, not a continuous source video.
        // Present ten rows/second at 1x regardless of timestamp gaps/repeats.
        // Keep the native speed/step choices, and give each image its own
        // browser render opportunity. After a stall, start from the actual
        // presentation time instead of painting several overdue frames at once.
        const due = presentedAt + 100 * step / speed;
        const time = await new Promise((resolve) => {
          const tick = (now) => {
            if (!stillCurrent()) { resolve(null); return; }
            if (now + 0.5 < due) requestAnimationFrame(tick);
            else resolve(now);
          };
          requestAnimationFrame(tick);
        });
        if (time === null) continue;
        presentedAt = time;
        S.g = next;
        S.shownG = next;
        S.bmp = bitmap;
        const pane = state.pane;
        const panePosition = pane ? { top: pane.scrollTop, left: pane.scrollLeft } : null;
        state.organizedPlaybackPainting = true;
        try {
          prepareLandmarkFrame(next);
          paint();
        } finally {
          state.organizedPlaybackPainting = false;
          // Playback still advances the current-row highlight, but it must not
          // drag the user's sidebar viewport through a long Other part.
          if (panePosition && pane === state.pane) {
            pane.scrollTop = panePosition.top;
            pane.scrollLeft = panePosition.left;
          }
        }
        drawBar();
      }
    } finally {
      // An older pending image must never pause a newer playback run.
      if (alive()) pause();
    }
  }

  function captureSidebarPosition(allowHiddenCurrent = false) {
    if (!pageLabelingReady() || state.sidebarScope?.generation !== S.gen ||
        state.sidebarScope?.label !== S.labelSel) return null;
    const current = state.list.querySelector("li.cur");
    const currentMatches = current && Number(current.dataset.g) === S.shownG;
    if (!currentMatches && !allowHiddenCurrent) return null;
    const pane = state.pane;
    const bounds = pane.getBoundingClientRect();
    const filters = document.getElementById("nl-status-filters")?.getBoundingClientRect();
    if (allowHiddenCurrent && filters?.height > 0 && filters.bottom > bounds.top && filters.top < bounds.bottom) {
      // While using the controls, preserve the controls' viewport. Anchoring a
      // part below them would scroll away from the checkbox when Done parts
      // are inserted above that part (even when scrollTop was initially zero).
      return {
        pane, generation: S.gen, label: S.labelSel, frame: S.shownG,
        top: pane.scrollTop, left: pane.scrollLeft, offset: null, anchor: null
      };
    }
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

  function playbackKeepsSidebarPosition() {
    return state.organizedPlaybackPainting || (pageLabelingReady() && S.playing);
  }

  function capturePlaybackSidebarPosition() {
    if (!playbackKeepsSidebarPosition() || !state.pane) return null;
    return { pane: state.pane, top: state.pane.scrollTop, left: state.pane.scrollLeft };
  }

  function restorePlaybackSidebarPosition(position) {
    if (!position || position.pane !== state.pane) return;
    position.pane.scrollTop = position.top;
    position.pane.scrollLeft = position.left;
  }

  function revealCurrentFrame(current = state.list?.querySelector("li.cur")) {
    // Auto-label completion, resize observers and list rebuilds can repaint
    // between player ticks. None of those background paints should follow the
    // current row and pull the sidebar out of the user's chosen part.
    if (playbackKeepsSidebarPosition()) return;
    ensureCurrentClipOpen(current);
    const pending = state.filterNavigation;
    if (pending && pending.session === S.sess && pending.generation === S.gen &&
        pending.label === S.labelSel && pending.target === Number(S.g)) return;
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
      const playbackPosition = capturePlaybackSidebarPosition();
      const position = playbackPosition ? null : state.sidebarRenderPosition || captureSidebarPosition();
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
          if (playbackPosition) restorePlaybackSidebarPosition(playbackPosition);
          else if (position) restoreSidebarPosition(position);
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
      const playbackPosition = state.renderingSidebar ? null : capturePlaybackSidebarPosition();
      const position = state.renderingSidebar || playbackPosition ? null : captureSidebarPosition();
      const result = nativeMark.apply(this, args);
      state.navigation = null;
      if (!state.renderingSidebar && pageLabelingReady()) {
        // Repaints also call scrollIntoView. Preserve the user's viewport on
        // the same frame, while genuine navigation still reveals the new row.
        if (playbackPosition) restorePlaybackSidebarPosition(playbackPosition);
        else if (position) restoreSidebarPosition(position);
        else revealCurrentFrame();
      }
      return result;
    };
    state.sidebarRenderingInstalled = true;
  }

  function statusFilterRestricted() {
    return state.statusFilters && FRAME_STATES.some((value) => !state.statusFilters[value]);
  }

  function followFilteredFrame(preserveViewport = false) {
    const navigation = organizedNavigationIndex();
    const rows = navigation?.visible.rows || [];
    if (rows.length && !navigation.visible.positions.has(Number(S.shownG))) {
      const next = rows.find((li) => Number(li.dataset.g) > S.shownG) || rows[0];
      if (typeof show === "function") {
        if (!preserveViewport) show(Number(next.dataset.g));
        else {
          // A filter may select a replacement image asynchronously. Update its
          // highlight without scrolling away from the user's filter controls.
          const pending = { session: S.sess, generation: S.gen, label: S.labelSel, target: Number(next.dataset.g) };
          state.filterNavigation = pending;
          const clear = () => { if (state.filterNavigation === pending) state.filterNavigation = null; };
          try { Promise.resolve(show(pending.target)).then(clear, clear); }
          catch (error) { clear(); throw error; }
        }
      }
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
        state.bboxRevision += 1;
        // A hidden current frame has no row to anchor. Capture the part/clip
        // the user is actually viewing before rebuilding the filtered list.
        state.sidebarRenderPosition = captureSidebarPosition(true);
        try { localStorage.setItem(STATUS_FILTER_KEY, JSON.stringify(state.statusFilters)); } catch (_) {}
        closeClipStatusMenu();
        if (typeof pause === "function") pause();
        input.blur();
        buildSeq();
        renderLabList();
        followFilteredFrame(true);
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
      state.bboxRevision += 1;
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

  function sidebarVisibleFrameSet() {
    return state.bboxActive ? organizedNavigationIndex()?.visible.positions || null : null;
  }

  function refreshClipSummary(details) {
    const frames = clipVisibleItems(details);
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
      insertBeforeFrameName(wanted, checkpoint);
    }
    const marker = wanted?.querySelector(":scope > .nl-checkpoint");
    if (marker) {
      const title = `Checkpoint: frame ${stats.checkpoint + 1}/${stats.total} trong clip`;
      if (marker.title !== title) marker.title = title;
    }
    refreshClipStatusControls(details);
  }

  // Returns true when the row was repainted. state.renderedRows (li -> {value, edited})
  // skips rows already showing the current fsGet/ledits state; rows rebuilt by
  // the native renderer are cache misses and get repainted once.
  function refreshFrameStatus(li, g) {
    const value = frameState(g);
    const edited = Boolean(typeof S !== "undefined" && S.ledits?.[rvKey(g)]);
    const rendered = state.renderedRows.get(li);
    if (rendered?.value === value && rendered.edited === edited) return false;
    state.renderedRows.set(li, { value, edited });

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
      const base = time.textContent.replace(/\s*✎\s*$/, "");
      const next = edited ? `${base} ✎` : base;
      if (time.textContent !== next) time.textContent = next;
    }
    return true;
  }

  function refreshVisibleFrameStates() {
    const changedClips = new Set();
    const refresh = (li, g) => {
      if (refreshFrameStatus(li, g)) changedClips.add(li.closest(".nl-clip"));
    };
    const all = organizedNavigationIndex()?.all;
    if (all) for (const [g, index] of all.positions) refresh(all.rows[index], g);
    else for (const li of state.list?.querySelectorAll("li[data-g]") || []) refresh(li, Number(li.dataset.g));
    changedClips.delete(null);
    for (const details of changedClips) refreshClipSummary(details);
    refreshPartStatusControls();
  }

  function ensureStatusRendering() {
    if (state.statusRenderingInstalled || typeof fsRender !== "function") return;
    const nativeRender = fsRender;
    fsRender = function (...args) {
      state.bboxRevision += 1;
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

  function buildPartHeaderTools(row, partName) {
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
    done.addEventListener("change", () => {
      done.blur();
      setWholePartState(row, done.checked ? "done" : "wip");
    });
    doneLabel.addEventListener("keydown", (event) => event.stopPropagation());
    doneLabel.addEventListener("click", (event) => event.stopPropagation());
    partTools.append(partTotal, doneLabel);
    return [partLabel, partTools];
  }

  function buildClipStatusActions(details, partName, no) {
    const statusActions = document.createElement("div");
    statusActions.className = "nl-clip-status-actions";
    statusActions.setAttribute("role", "group");
    statusActions.setAttribute("aria-label", `Change frames by current status in clip ${no} · ${partName}`);
    state.clipScopes.set(details, currentLabelScope());
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
    return statusActions;
  }

  function syncOpenClipState(details, open) {
    if (open) {
      state.openClips.add(details.dataset.key);
      state.manuallyClosedClips.delete(details.dataset.key);
    } else {
      state.openClips.delete(details.dataset.key);
      state.manuallyClosedClips.add(details.dataset.key);
    }
  }

  function buildClipElement(partName, no, items) {
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
      insertBeforeFrameName(items[stats.checkpoint], checkpoint);
    }

    const meta = document.createElement("span");
    meta.className = "nl-clip-meta";
    meta.textContent = stats.text;
    summary.append(noEl, meta, buildClipStatusActions(details, partName, no));

    summary.addEventListener("click", (event) => {
      if (event.defaultPrevented) return;
      event.preventDefault();
      // A sticky header may be far below its normal position in the list.
      // Collapse synchronously and anchor that header, not the old scrollTop:
      // keeping the old scrollTop would expose a later clip or another part.
      const top = Math.max(summary.getBoundingClientRect().top, state.toolbar.getBoundingClientRect().bottom);
      const opening = !details.open;
      syncOpenClipState(details, opening);
      details.open = opening;
      state.pane.scrollTop += summary.getBoundingClientRect().top - top;
    });

    const ul = document.createElement("ul");
    for (const li of items) ul.appendChild(li);

    const hasCurrent = items.some((li) => li.classList.contains("cur"));
    details.classList.toggle("nl-current", hasCurrent);
    details.open = state.openClips.has(details.dataset.key) ||
      (hasCurrent && !playbackKeepsSidebarPosition() &&
        !state.manuallyClosedClips.has(details.dataset.key));
    if (details.open) state.openClips.add(details.dataset.key);

    details.addEventListener("toggle", () => syncOpenClipState(details, details.open));
    details.append(summary, ul);
    refreshClipStatusControls(details);
    return details;
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

    label.replaceChildren(...buildPartHeaderTools(row, partName));

    // Move the large native list off the live document before redistributing
    // its rows. This avoids thousands of connected-DOM mutation/layout steps.
    const anchor = document.createComment("nota-clips");
    sourceList.replaceWith(anchor);

    const clips = document.createElement("div");
    clips.className = "nl-clips";
    for (const [no, items] of buckets) {
      clips.appendChild(buildClipElement(partName, no, items));
    }

    row.dataset.partName = partName;
    state.partScopes.set(row, currentLabelScope());
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
      button.disabled = !count || state.operationBusy || state.statusOperationBusy;
      button.title = `${count} ${statusName(value)} frames · Choose a new status`;
      button.setAttribute("aria-label", `${statusName(value)}: change ${count} frames in this clip`);
      button.setAttribute("aria-pressed", String(current));
    }
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
      input.disabled = !frames.length || state.operationBusy || state.statusOperationBusy;
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
    if (state.doneAllButton) state.doneAllButton.disabled = !pageLabelingReady() || state.operationBusy || state.statusOperationBusy;
    refreshPartStatusControls();
    for (const details of state.list?.querySelectorAll(".nl-clip") || []) refreshClipStatusControls(details);
  }

  function restoreNativeGroups() {
    if (!state.list) return;
    clearTimeout(state.bboxRefreshTimer);
    state.bboxRefreshTimer = 0;
    if (state.bboxActive) state.bboxRevision += 1;
    state.bboxActive = false;
    state.bboxHiddenApplied = false;
    state.bboxWarnApplied = false;
    cancelBboxLoads();
    if (state.bboxProgressWrap) state.bboxProgressWrap.hidden = true;
    state.markedRows.clear();
    state.rangeRow = null;
    state.applying = true;
    try {
      for (const row of state.list.querySelectorAll(":scope > .grp.nl-organized")) {
        const clips = row.querySelector(":scope > .nl-clips");
        if (!clips) continue;
        const ul = document.createElement("ul");
        for (const li of clips.querySelectorAll("li")) {
          li.querySelectorAll(".nl-checkpoint").forEach((marker) => marker.remove());
          li.querySelectorAll(".nl-frame-mark").forEach((marker) => marker.remove());
          li.querySelectorAll(".nl-range-mark").forEach((marker) => marker.remove());
          li.querySelectorAll(".nl-warn-badge").forEach((marker) => marker.remove());
          li.classList.remove("nl-marked-frame", "nl-range-start-frame");
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
    if (details && !details.open && !playbackKeepsSidebarPosition() &&
        !state.manuallyClosedClips.has(details.dataset.key)) {
      details.open = true;
      state.openClips.add(details.dataset.key);
    }
  }

  Object.assign(NL, {
    clipKey, getClipNo, getMeta, framePartKey, frameClipKey, clipFrames, partFrames,
    clipVisibleItems, clipListedFrames, activeClipBaseContext, organizedNavigationIndex,
    organizedNavigationTarget, navigateOrganizedFrames, prepareLandmarkFrame, ensureOrganizedPlayback,
    runOrganizedPlayback, captureSidebarPosition, sidebarAnchorElement, restoreSidebarPosition,
    capturePlaybackSidebarPosition, restorePlaybackSidebarPosition,
    revealCurrentFrame, ensureSidebarRendering, statusFilterRestricted, followFilteredFrame,
    renderStatusFilters, ensureStatusFilters, sidebarVisibleFrameSet, refreshClipSummary,
    refreshFrameStatus, refreshVisibleFrameStates, ensureStatusRendering, buildPartHeaderTools,
    buildClipStatusActions, syncOpenClipState, buildClipElement, organizeGroup,
    refreshClipStatusControls, refreshPartStatusControls, refreshStatusControls,
    restoreNativeGroups, ensureCurrentClipOpen
  });
})();
