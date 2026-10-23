// Keep compressed images for at most two labeling parts. Background downloads
// never call show(), decode an image, or read/write annotation data.
(() => {
  "use strict";
  const FLAG = "__notaPartImagePreloaderV1";
  if (window[FLAG] || !["https://ntt.dev.nota.ai", "http://10.169.1.102:8765"].includes(location.origin)) return;
  window[FLAG] = true;

  const DATABASE = "nota-part-images-v1";
  // Chrome opens at most 6 HTTP/1.1 connections per host; leave 2 for DMS
  // navigation and saves. HTTP/2 and HTTP/3 multiplex one connection.
  const PARALLEL = /^h[23]/.test(performance.getEntriesByType("navigation")[0]?.nextHopProtocol || "") ? 6 : 4;
  const YIELD_POLL_MS = 50;
  const REQUEST_TIMEOUT = 20000;
  const FILTER_API = "__notaBboxFilterV1"; // Published by content.js.
  const rawFetch = window.fetch.bind(window); // Retain DMS authentication/CSRF handling.
  const tabId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  let ownerSequence = 0;
  let database;
  let scope = null;
  let parts = [];
  let slots = [];
  let running = false;
  let changing = false;
  let statusWrites = 0;
  let statusHook = null;
  let lastPart = -1;
  let message = "";
  let timer = 0;
  let orderedFrame = -1; // Frame the current part's download order was built around.
  let panel = null;
  let filterRevision = null;
  let windowRevision = null; // Filter revision the current two-part window was chosen with.
  const pending = new Map();

  const ready = () => typeof S !== "undefined" && S.mode === "label" && !!S.sess;
  const matchesScope = () => ready() && scope && scope.session === S.sess &&
    scope.generation === S.gen && scope.label === S.labelSel && scope.width === S.w && scope.quality === S.q;
  const ownerRange = (owner) => IDBKeyRange.bound([owner], [owner, []]);

  function openDatabase() {
    if (database) return database;
    database = new Promise((resolve, reject) => {
      const request = indexedDB.open(DATABASE, 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore("images", { keyPath: ["owner", "url"] });
        request.result.createObjectStore("owners", { keyPath: "id" });
      };
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error("Image storage is busy in another tab."));
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => { db.close(); database = null; };
        // Normally cleared on window rotation, scope change or page exit. Remove abandoned
        // owners after a day as well (e.g. a browser crash during a download).
        const tx = db.transaction(["images", "owners"], "readwrite");
        const cursor = tx.objectStore("owners").openCursor();
        cursor.onsuccess = () => {
          const row = cursor.result;
          if (!row) return;
          if (row.value.expires < Date.now()) {
            tx.objectStore("images").delete(ownerRange(row.key));
            row.delete();
          }
          row.continue();
        };
        tx.oncomplete = () => resolve(db);
        tx.onabort = () => { db.close(); reject(tx.error); };
      };
    }).catch((error) => { database = null; throw error; });
    return database;
  }

  async function storage(mode, action) {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(["images", "owners"], mode);
      let request;
      try { request = action(tx.objectStore("images"), tx.objectStore("owners")); }
      catch (error) { tx.abort(); reject(error); return; }
      tx.oncomplete = () => resolve(request?.result);
      tx.onabort = () => reject(tx.error || new Error("Image storage failed."));
    });
  }

  function collectParts() {
    const grouped = new Map();
    // Use the full authorized label list, including Done frames hidden by the
    // native "only todo" filter. Search/collapsed clips must not shorten a part.
    if (S.review && typeof rvG === "function" && typeof clipAt === "function") {
      const frames = [...new Set(Object.values(S.review)
        .filter((item) => item.labels?.includes(S.labelSel))
        .map((item) => rvG(item)).filter((g) => Number.isInteger(g) && g >= 0))].sort((a, b) => a - b);
      for (const g of frames) {
        const clip = clipAt(g);
        const key = clip ? (clip.long ? "__long" : clip.cat) : "__none";
        if (!grouped.has(key)) {
          const name = key === "__long" ? "Acting" : key === "__none" ? "Other" :
            (typeof TAG_KO !== "undefined" && TAG_KO[key]) || key;
          grouped.set(key, { key, name, frames: [] });
        }
        grouped.get(key).frames.push(g);
      }
    } else {
      for (const row of document.querySelectorAll("#labList > .grp")) {
        const name = row.dataset.partName || row.querySelector(".vlab")?.textContent || "Part";
        const frames = [...new Set([...row.querySelectorAll("li[data-g]")].map((li) => Number(li.dataset.g)))];
        if (frames.length) grouped.set(name, { key: name, name, frames });
      }
    }
    return [...grouped.values()];
  }

  function frameURL(g) {
    const [si, i] = loc(g);
    return new URL(`/api/frame?bucket=${encodeURIComponent(S.sess.bucket)}&prefix=${encodeURIComponent(segPfx(si))}` +
      `&seg=${encodeURIComponent(S.sess.segments[si].name)}&i=${i}&w=${S.w}&q=${S.q}`, location.origin).href;
  }

  const shownFrame = () => Number.isInteger(S.shownG) && S.shownG >= 0 ? S.shownG : S.g;

  function partAtCurrentFrame() {
    const g = shownFrame();
    return parts.findIndex((part) => part.frames.includes(g));
  }

  // Download sequentially from the open frame to the part's end, then the
  // frames before it. Restarting the cursor is cheap: cached images are skipped.
  function prioritize(slot) {
    const all = slot.partEntries;
    const pivot = Math.max(0, all.findIndex((entry) => entry.g === shownFrame()));
    slot.entries = all.slice(pivot).concat(all.slice(0, pivot));
    slot.cursor = 0;
  }

  // Sidebar filter verdict for frame g: true = fetch, false = filtered out,
  // null = count still loading. Without the organizer, honor native onlyTodo.
  function wants(g) {
    const filter = window[FILTER_API];
    if (filter) return filter.wants(g);
    return !(S.onlyTodo && typeof fsGet === "function" && fsGet(g, scope?.label) === "done");
  }

  function indexWanted(slot) {
    const prev = slot.wanted;
    const wanted = new Set();
    let waiting = 0;
    for (const entry of slot.entries) {
      const verdict = wants(entry.g);
      if (verdict === true) wanted.add(entry.url);
      else if (verdict === null) waiting++;
    }
    if (!prev || waiting !== slot.waiting || wanted.size !== prev.size ||
        [...wanted].some((url) => !prev.has(url))) {
      slot.wanted = wanted;
      slot.waiting = waiting;
      slot.cursor = 0;
    }
  }

  const currentFilterRevision = () => window[FILTER_API]?.revision ?? 0;

  function syncFilter() {
    filterRevision = currentFilterRevision();
    for (const slot of slots) indexWanted(slot);
  }

  function countWanted(slot, urls) {
    if (slot.wanted.size === slot.entries.length) return urls.size;
    let count = 0;
    for (const url of urls.keys()) if (slot.wanted.has(url)) count++;
    return count;
  }

  function partHasWanted(part) {
    // Load any part that still has frames matching the active sidebar filters
    // (including Done frames when Done is shown in the sidebar).
    return part.frames.length > 0 && part.frames.some((g) => wants(g) !== false);
  }

  function wantedWindow(index) {
    const wanted = [];
    for (let i = Math.max(0, index); i < parts.length && wanted.length < 2; i++) {
      if (partHasWanted(parts[i])) wanted.push(parts[i]);
    }
    return wanted;
  }

  function stopRequests(slot = null) {
    for (const request of pending.values()) {
      if ((!slot || request.slot === slot) && !request.foreground) {
        request.cancelled = true;
        request.controller.abort();
      }
    }
  }

  async function release(slot) {
    slot.alive = false;
    stopRequests(slot);
    slot.cached.clear();
    slot.failed.clear();
    // Leave the displayed image alive until normal navigation replaces it.
    if (matchesScope() && typeof fkey === "function") {
      for (const g of slot.part.frames) {
        const key = fkey(g), bitmap = S.frames?.get(key);
        if (bitmap && bitmap !== S.bmp && !S.inflight?.has(key)) {
          S.frames.delete(key);
          bitmap.close();
        }
      }
    }
    if (database) await storage("readwrite", (images, owners) => {
      images.delete(ownerRange(slot.owner));
      return owners.delete(slot.owner);
    });
  }

  function clearScope() {
    running = false;
    clearTimeout(timer);
    stopRequests();
    const old = slots;
    slots = [];
    for (const slot of old) release(slot).catch(() => {});
    scope = null;
    parts = [];
    lastPart = -1;
    orderedFrame = -1;
    message = "";
    render();
  }

  async function setWindow(index) {
    if (changing || !matchesScope()) return;
    changing = true;
    windowRevision = currentFilterRevision();
    const expected = scope;
    try {
      // Skip parts with no frames in the sidebar. Fill with the next two matching
      // parts, retaining the already downloaded overlap when moving 1+2 -> 2+3.
      const wanted = wantedWindow(index);
      const removed = slots.filter((slot) => !wanted.includes(slot.part));
      slots = slots.filter((slot) => wanted.includes(slot.part));
      await Promise.all(removed.map(release));
      if (scope !== expected || !matchesScope()) return;
      for (const part of wanted) {
        if (slots.some((slot) => slot.part === part)) continue;
        const entries = part.frames.map((g) => ({ g, url: frameURL(g) }));
        const slot = {
          part, owner: `${tabId}-${++ownerSequence}`, alive: true, cursor: 0,
          partEntries: entries, entries, byURL: new Map(entries.map((entry) => [entry.url, entry])),
          cached: new Set(), failed: new Map()
        };
        prioritize(slot);
        indexWanted(slot);
        slots.push(slot);
      }
      slots.sort((a, b) => parts.indexOf(a.part) - parts.indexOf(b.part));
      if (!slots.length) { running = false; message = "All remaining parts are Done."; }
    } catch (error) { storageFailed(error); }
    finally { changing = false; render(); schedule(); }
  }

  function storageFailed(error) {
    running = false;
    stopRequests();
    message = error?.name === "QuotaExceededError"
      ? "Storage full. Free browser storage, then start again."
      : `Image storage unavailable: ${error?.message || "unknown error"}`;
    render();
  }

  function load(slot, entry, foreground = false, init = {}) {
    const key = `${slot.owner}|${entry.url}`;
    const existing = pending.get(key);
    if (existing && !existing.controller.signal.aborted) {
      if (foreground) existing.foreground = true;
      return existing.promise;
    }
    const request = { slot, foreground, controller: new AbortController(), promise: null };
    pending.set(key, request);
    request.promise = (async () => {
      if (slot.cached.has(entry.url)) {
        try {
          const saved = await storage("readonly", (images) => images.get([slot.owner, entry.url]));
          if (saved?.blob) return saved.blob;
          slot.cached.delete(entry.url); // Storage may have been evicted by Chrome.
        } catch (error) { storageFailed(error); }
      }
      if (!slot.alive || !matchesScope()) throw new DOMException("Scope changed", "AbortError");
      const timeout = setTimeout(() => request.controller.abort(), REQUEST_TIMEOUT);
      let blob;
      try {
        const response = await rawFetch(entry.url, {
          ...init, credentials: "same-origin",
          priority: request.foreground ? "high" : "low", signal: request.controller.signal
        });
        if (!response.ok) {
          const error = new Error(`HTTP ${response.status}`);
          error.response = response;
          throw error;
        }
        blob = await response.blob();
        if (!blob.size || !/^image\//i.test(blob.type)) throw new Error("The server did not return an image.");
      } finally { clearTimeout(timeout); }
      if (slot.alive && matchesScope() && !request.controller.signal.aborted) {
        try {
          await storage("readwrite", (images, owners) => {
            // Do not resurrect an owner released while IndexedDB was opening.
            if (!slot.alive || !matchesScope()) return;
            owners.put({ id: slot.owner, expires: Date.now() + 86400000 });
            return images.put({ owner: slot.owner, url: entry.url, blob });
          });
          if (slot.alive && matchesScope()) {
            slot.cached.add(entry.url);
            slot.failed.delete(entry.url);
          }
        } catch (error) { storageFailed(error); }
      }
      return blob;
    })().catch((error) => {
      if (request.cancelled) error.preloadCancelled = true;
      throw error;
    }).finally(() => {
      if (pending.get(key) === request) pending.delete(key);
      render();
      schedule();
    });
    return request.promise;
  }

  // Refill as soon as a request settles; poll only while yielding to DMS traffic.
  function schedule(delay = 0) {
    clearTimeout(timer);
    if (running) timer = setTimeout(pump, delay);
  }

  function pump() {
    if (!running || changing || !matchesScope()) return;
    // Status saves get the network to themselves. While DMS fetches or decodes
    // frames, keep one background request so loading still progresses.
    const yielding = statusWrites > 0 || S.inflight?.size > 0;
    const limit = statusWrites ? 0 : yielding ? 1 : PARALLEL;
    syncFilter();
    let active = [...pending.values()].filter((request) => !request.foreground && !request.controller.signal.aborted).length;
    for (const slot of slots) {
      while (slot.cursor < slot.entries.length && active < limit) {
        const entry = slot.entries[slot.cursor++];
        if (!slot.wanted.has(entry.url) || slot.cached.has(entry.url) || slot.failed.has(entry.url)) continue;
        // A filter reindex rewinds the cursor; do not count live downloads twice.
        if (pending.get(`${slot.owner}|${entry.url}`)?.controller.signal.aborted === false) continue;
        active++;
        load(slot, entry).catch((error) => {
          if (!slot.alive) return;
          if (error.name === "AbortError") {
            // Stop and resume retry canceled work; a running timeout is shown.
            if (running && !error.preloadCancelled) slot.failed.set(entry.url, "Request timed out");
          } else {
            slot.failed.set(entry.url, error.message);
            if ([401, 403].includes(error.response?.status)) {
              running = false;
              stopRequests();
              message = `${error.message}. Check your access, then start again.`;
            }
          }
          render();
        });
      }
      if (active >= limit) break;
    }
    if (yielding) schedule(YIELD_POLL_MS);
    render();
  }

  function render() {
    if (!panel) return;
    syncFilter();
    const total = slots.reduce((n, slot) => n + slot.wanted.size + slot.waiting, 0);
    const loaded = slots.reduce((n, slot) => n + countWanted(slot, slot.cached), 0);
    const failed = slots.reduce((n, slot) => n + countWanted(slot, slot.failed), 0);
    const waiting = slots.reduce((n, slot) => n + slot.waiting, 0);
    const start = panel.querySelector(".nl-load-start");
    const stop = panel.querySelector(".nl-load-stop");
    start.disabled = running || changing || !ready();
    stop.disabled = !running;
    const status = running ? (loaded === total && total ? "Ready" : "Loading") : total ? "Stopped" : "Loaded";
    const caption = `${status} ${loaded.toLocaleString()} / ${total.toLocaleString()} images` +
      `${failed ? ` · ${failed} failed` : ""}${waiting ? ` · ${waiting} awaiting BBox counts` : ""}`;
    const names = message || (slots.length ? slots.map((slot) => slot.part.name).join(" + ") : "Current part + next part");
    if (panel.querySelector(".nl-load-count").textContent !== caption) panel.querySelector(".nl-load-count").textContent = caption;
    if (panel.querySelector(".nl-load-parts").textContent !== names) panel.querySelector(".nl-load-parts").textContent = names;
    panel.title = `Up to 2 parts, ${PARALLEL} background downloads. Stop keeps downloaded images. Start retries missing images.`;
    panel.querySelector("progress").max = Math.max(1, total);
    panel.querySelector("progress").value = loaded;
  }

  async function start() {
    if (!ready() || changing || running) return;
    message = "";
    if (!matchesScope()) {
      clearScope();
      scope = { session: S.sess, generation: S.gen, label: S.labelSel, width: S.w, quality: S.q };
      parts = collectParts();
    }
    if (!parts.length) { message = "Open a labeled part first."; render(); return; }
    const index = partAtCurrentFrame();
    if (index < 0) { message = "Open a frame in the part you want to load."; render(); return; }
    running = true;
    lastPart = index;
    await setWindow(index);
    orderedFrame = shownFrame();
    for (const slot of slots) { prioritize(slot); slot.failed.clear(); }
    schedule();
    render();
  }

  function stop() {
    running = false;
    clearTimeout(timer);
    stopRequests();
    render();
  }

  function install() {
    const toolbar = document.getElementById("nota-labeling-organizer-v1");
    if (!toolbar || panel?.isConnected) return;
    const style = document.createElement("style");
    style.textContent = `
      #nota-labeling-organizer-v1 { flex-wrap: wrap; }
      .nl-image-preload { flex: 0 0 100%; min-width: 0; display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
      .nl-image-preload button { border: 1px solid #66758a; border-radius: 4px; padding: 4px 7px; background: #253447; color: #eef5ff; cursor: pointer; font: inherit; font-size: 11px; }
      .nl-image-preload button:disabled { opacity: .5; cursor: default; }
      .nl-load-count { flex: 1 1 100%; font-size: 11px; color: #a5e3ba; }
      .nl-load-parts { min-width: 0; flex: 1 1 100%; font-size: 10px; color: #becadc; overflow-wrap: anywhere; }
      .nl-image-preload progress { width: 100%; height: 5px; accent-color: #59b780; }
    `;
    document.head.appendChild(style);
    panel = document.createElement("div");
    panel.className = "nl-image-preload";
    panel.innerHTML = `<button type="button" id="start_auto_load" class="nl-load-start" aria-label="Start auto loading images">auto_load_img</button>
      <button type="button" id="stop_auto_load" class="nl-load-stop">Stop</button>
      <span class="nl-load-count" role="status" aria-live="polite"></span>
      <progress aria-label="Images loaded for the current two parts" max="1" value="0"></progress>
      <span class="nl-load-parts"></span>`;
    toolbar.appendChild(panel);
    panel.querySelector(".nl-load-start").addEventListener("click", () => start().catch(storageFailed));
    panel.querySelector(".nl-load-stop").addEventListener("click", stop);
    render();
  }

  function pulse() {
    install();
    // fsSet is optimistic. Wait for its complete save/rollback before rotating.
    if (typeof fsSet === "function" && fsSet !== statusHook) {
      const nativeSet = fsSet;
      statusHook = async function (...args) {
        statusWrites++;
        try { return await nativeSet.apply(this, args); }
        finally { statusWrites--; }
      };
      fsSet = statusHook;
    }
    if (scope && !matchesScope()) { clearScope(); return; }
    if (!running || changing || statusWrites) { render(); return; }
    const current = partAtCurrentFrame();
    if (current >= 0) lastPart = current;
    // setWindow skips parts without sidebar-matching frames, and updates the
    // two-part window whenever the current part or active filters change.
    const desired = wantedWindow(lastPart);
    const windowChanged = desired.length !== slots.length ||
      desired.some((part, i) => slots[i]?.part !== part);
    if (windowChanged || currentFilterRevision() !== windowRevision) {
      setWindow(lastPart);
      return;
    }
    const shown = shownFrame();
    if (shown !== orderedFrame) {
      orderedFrame = shown;
      const slot = slots.find((candidate) => candidate.part === parts[current]);
      if (slot) prioritize(slot);
    }
    schedule();
    render();
  }

  window.fetch = function (input, init = {}) {
    let url;
    try { url = new URL(typeof input === "string" ? input : input.url, location.href); }
    catch (_) { return rawFetch(input, init); }
    const method = (init.method || (typeof input !== "string" && input.method) || "GET").toUpperCase();
    if (url.origin === location.origin && url.pathname === "/api/frame_status" && method !== "GET") {
      statusWrites++;
      return rawFetch(input, init).finally(() => { statusWrites--; });
    }
    if (url.origin !== location.origin || url.pathname !== "/api/frame" || method !== "GET" ||
        typeof input !== "string" || init.signal || !matchesScope()) return rawFetch(input, init);
    for (const slot of slots) {
      const entry = slot.byURL.get(url.href);
      if (!entry || (!running && !slot.cached.has(entry.url))) continue;
      return load(slot, entry, true, init).then((blob) => new Response(blob, {
        status: 200, headers: { "Content-Type": blob.type }
      })).catch((error) => error.response || rawFetch(input, init));
    }
    return rawFetch(input, init);
  };

  setInterval(pulse, 500);
  window.addEventListener("pagehide", clearScope);
  pulse();
})();
