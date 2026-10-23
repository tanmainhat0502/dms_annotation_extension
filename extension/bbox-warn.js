(() => {
  "use strict";

  const NL = window.__notaOrganizerV1 = window.__notaOrganizerV1 || {};
  const {
    OBJECT_BBOX_LABELS, bboxIntersectionOverSmaller, bboxIntersectionOverUnion,
    frameClipKey, frameSegment, insertBeforeFrameName, parseBoxBounds,
    sessionLabelFrames, state
  } = NL;

  const SINGLE_PERSON_ANATOMY_LABELS = new Set(["head", "face", "nose", "mouth", "face_mask"]);
  const CONTINUOUS_ANATOMY_LABELS = new Set(["body", "head", "face", "nose", "mouth", "eye", "face_mask"]);

  const WARN_DESCRIPTIONS = {
    dup: "Duplicate or overlapping boxes",
    tiny: "Degenerate or abnormally small box",
    size: "Box area outlier vs session distribution",
    ratio: "Box aspect ratio outlier vs session distribution",
    pos: "Box position outlier vs session distribution",
    jump: "Sudden frame-to-frame coordinate jump or bulk-edit step",
    count: "Inconsistent box count in clip or session",
    drift: "Static bulk-copied box drifted from moving auto-label"
  };

  function medianNumbers(values) {
    if (!values.length) return 0;
    const sorted = Float64Array.from(values).sort();
    const mid = sorted.length >> 1;
    return (sorted.length & 1) ? sorted[mid] : 0.5 * (sorted[mid - 1] + sorted[mid]);
  }

  function parseSortedBoxes(items) {
    if (!Array.isArray(items)) return { boxes: [], invalidCount: 0 };
    const boxes = [];
    let invalidCount = 0;
    for (const item of items) {
      const bounds = parseBoxBounds(item?.box);
      if (!bounds || bounds[2] <= bounds[0] || bounds[3] <= bounds[1]) {
        invalidCount += 1;
        continue;
      }
      const [x1, y1, x2, y2] = bounds;
      const w = x2 - x1;
      const h = y2 - y1;
      const area = w * h;
      boxes.push({
        box: bounds, x1, y1, x2, y2, w, h, area,
        cx: 0.5 * (x1 + x2), cy: 0.5 * (y1 + y2),
        logArea: Math.log(area), logRatio: Math.log(w / h)
      });
    }
    boxes.sort((a, b) => a.cx - b.cx || a.cy - b.cy);
    return { boxes, invalidCount };
  }

  function rawAutoItemsForFrame(g, label) {
    try {
      const [segmentIndex, frameIndex] = loc(g);
      const data = S.al?.get(segmentIndex);
      if (!data || data instanceof Promise) return [];
      const frame = data.frames?.[String(frameIndex)];
      return frame && typeof alBoxes === "function" ? alBoxes(frame, label) || [] : [];
    } catch (_) {
      return [];
    }
  }

  function readFrameWarningInput(g, cache) {
    const label = cache.label;
    const key = typeof rvKey === "function" ? rvKey(g) : "";
    const edited = key ? S.ledits?.[key]?.[label] : undefined;
    const hasEdit = Array.isArray(edited);
    const autoParsed = parseSortedBoxes(rawAutoItemsForFrame(g, label));
    const currentParsed = hasEdit ? parseSortedBoxes(edited) : autoParsed;
    return {
      g,
      clipKey: frameClipKey(g),
      hasEdit,
      boxes: currentParsed.boxes,
      invalidCount: currentParsed.invalidCount,
      autoBoxes: autoParsed.boxes
    };
  }

  function computeSlotDistribution(boxes) {
    const logAreas = boxes.map((b) => b.logArea);
    const logRatios = boxes.map((b) => b.logRatio);
    const widths = boxes.map((b) => b.w);
    const heights = boxes.map((b) => b.h);
    const cxs = boxes.map((b) => b.cx);
    const cys = boxes.map((b) => b.cy);
    const medLogArea = medianNumbers(logAreas);
    const medLogRatio = medianNumbers(logRatios);
    const medCx = medianNumbers(cxs);
    const medCy = medianNumbers(cys);
    return {
      count: boxes.length,
      medLogArea,
      madLogArea: Math.max(0.06, medianNumbers(logAreas.map((v) => Math.abs(v - medLogArea)))),
      medLogRatio,
      madLogRatio: Math.max(0.05, medianNumbers(logRatios.map((v) => Math.abs(v - medLogRatio)))),
      medW: Math.max(6, medianNumbers(widths)),
      medH: Math.max(6, medianNumbers(heights)),
      medCx,
      madCx: Math.max(10, medianNumbers(cxs.map((v) => Math.abs(v - medCx)))),
      medCy,
      madCy: Math.max(10, medianNumbers(cys.map((v) => Math.abs(v - medCy))))
    };
  }

  function buildSessionStats(frameInputs) {
    const allBoxes = [];
    const countHist = new Map();
    let nonEmptyFrames = 0;
    let atMostOneFrames = 0;
    for (const input of frameInputs) {
      const n = input.boxes.length;
      if (n > 0) {
        nonEmptyFrames += 1;
        if (n <= 1) atMostOneFrames += 1;
        countHist.set(n, (countHist.get(n) || 0) + 1);
        for (const box of input.boxes) allBoxes.push(box);
      }
    }
    const globalSlot = computeSlotDistribution(allBoxes);
    let dominantCount = 1;
    let dominantFreq = 0;
    for (const [count, freq] of countHist) {
      if (freq > dominantFreq) {
        dominantCount = count;
        dominantFreq = freq;
      }
    }
    const multiCountFrames = [...countHist.entries()]
      .filter(([count]) => count >= 2)
      .reduce((sum, [, freq]) => sum + freq, 0);
    const slotCount = nonEmptyFrames >= 10 && multiCountFrames / nonEmptyFrames >= 0.2
      ? Math.min(4, Math.max(2, dominantCount))
      : 1;

    let slots = [globalSlot];
    if (slotCount > 1 && allBoxes.length >= slotCount * 6) {
      const exactFrames = frameInputs.filter((input) => input.boxes.length === slotCount);
      const centers = [];
      if (exactFrames.length >= 4) {
        const refBoxes = exactFrames[0].boxes;
        const aligned = exactFrames.map((f) => matchBoxesToReference(refBoxes, f.boxes));
        for (let s = 0; s < slotCount; s++) {
          centers.push({
            cx: medianNumbers(aligned.map((boxes) => boxes[s].cx)),
            cy: medianNumbers(aligned.map((boxes) => boxes[s].cy))
          });
        }
      } else {
        const sortedCx = Float64Array.from(allBoxes.map((b) => b.cx)).sort();
        for (let s = 0; s < slotCount; s++) {
          const idx = Math.min(sortedCx.length - 1, Math.floor(((s + 0.5) / slotCount) * sortedCx.length));
          centers.push({ cx: sortedCx[idx], cy: globalSlot.medCy });
        }
      }
      const buckets = Array.from({ length: slotCount }, () => []);
      for (const box of allBoxes) {
        let bestSlot = 0;
        let bestDist = Infinity;
        for (let s = 0; s < slotCount; s++) {
          const dist = Math.hypot(box.cx - centers[s].cx, box.cy - centers[s].cy);
          if (dist < bestDist) {
            bestDist = dist;
            bestSlot = s;
          }
        }
        buckets[bestSlot].push(box);
      }
      slots = buckets.map((bucket) => bucket.length >= 6 ? computeSlotDistribution(bucket) : globalSlot);
    }

    return {
      totalFrames: frameInputs.length,
      nonEmptyFrames,
      nonEmptyFraction: frameInputs.length ? nonEmptyFrames / frameInputs.length : 0,
      singleBoxFraction: nonEmptyFrames ? atMostOneFrames / nonEmptyFrames : 1,
      globalSlot,
      slots
    };
  }

  function nearestSlotStats(box, stats) {
    if (stats.slots.length === 1) return stats.globalSlot;
    let best = stats.slots[0];
    let bestDist = Infinity;
    for (const slot of stats.slots) {
      const dist = Math.hypot(box.cx - slot.medCx, box.cy - slot.medCy);
      if (dist < bestDist) {
        bestDist = dist;
        best = slot;
      }
    }
    return best;
  }

  function addReason(map, g, code) {
    let set = map.get(g);
    if (!set) {
      set = new Set();
      map.set(g, set);
    }
    set.add(code);
  }

  function evaluateFrameRules(input, stats, label, srcW, srcH, reasonsByFrame) {
    const { g, boxes, invalidCount } = input;
    if (invalidCount > 0) addReason(reasonsByFrame, g, "tiny");
    if (!boxes.length) return;

    if (SINGLE_PERSON_ANATOMY_LABELS.has(label) && stats.singleBoxFraction >= 0.85 && boxes.length > 1) {
      addReason(reasonsByFrame, g, "count");
    }

    const strictAspect = SINGLE_PERSON_ANATOMY_LABELS.has(label) || label === "eye";
    const maxAspect = strictAspect ? 4.5 : 8.0;
    const minAspect = strictAspect ? 0.22 : 0.125;

    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      if (b.w < 5 || b.h < 5 || b.area < 25) addReason(reasonsByFrame, g, "tiny");
      const ratio = b.w / b.h;
      if (ratio > maxAspect || ratio < minAspect) addReason(reasonsByFrame, g, "ratio");
      if (b.x1 < -2 || b.y1 < -2 || b.x2 > srcW + 2 || b.y2 > srcH + 2) addReason(reasonsByFrame, g, "pos");

      for (let j = i + 1; j < boxes.length; j++) {
        const other = boxes[j];
        const iou = bboxIntersectionOverUnion(b.box, other.box);
        const ioMin = bboxIntersectionOverSmaller(b.box, other.box);
        const sizeRatio = Math.min(b.area, other.area) / Math.max(b.area, other.area);
        if (iou >= 0.72 || (ioMin >= 0.88 && sizeRatio >= 0.45)) {
          addReason(reasonsByFrame, g, "dup");
        }
      }

      if (stats.nonEmptyFrames < 6) continue;
      const slot = nearestSlotStats(b, stats);
      const dArea = Math.abs(b.logArea - slot.medLogArea);
      const zArea = dArea / slot.madLogArea;
      const dRatio = Math.abs(b.logRatio - slot.medLogRatio);
      const zRatio = dRatio / slot.madLogRatio;
      const dx = Math.abs(b.cx - slot.medCx);
      const dy = Math.abs(b.cy - slot.medCy);
      const zx = dx / slot.madCx;
      const zy = dy / slot.madCy;
      const zPos = Math.hypot(zx, zy);

      if (zArea > 3.8 && dArea > 0.28) addReason(reasonsByFrame, g, "size");
      if (zRatio > 3.8 && dRatio > 0.22) addReason(reasonsByFrame, g, "ratio");
      if ((zx > 4.2 && dx > Math.max(24, 0.25 * slot.medW)) ||
          (zy > 4.2 && dy > Math.max(24, 0.25 * slot.medH)) ||
          (zPos > 4.8 && Math.hypot(dx, dy) > Math.max(30, 0.3 * Math.hypot(slot.medW, slot.medH)))) {
        addReason(reasonsByFrame, g, "pos");
      }
      if (zArea > 1.8 && zRatio > 1.8 && dArea > 0.18 &&
          Math.hypot(zArea, zRatio, 0.4 * zPos) > 4.4) {
        addReason(reasonsByFrame, g, "size");
      }

      const touchesVerticalEdge = b.x1 <= 1 || b.x2 >= srcW - 1;
      const touchesHorizontalEdge = b.y1 <= 1 || b.y2 >= srcH - 1;
      if ((touchesVerticalEdge && b.w < 0.42 * slot.medW) ||
          (touchesHorizontalEdge && b.h < 0.42 * slot.medH)) {
        addReason(reasonsByFrame, g, "size");
      }
    }
  }

  function matchBoxesToReference(refBoxes, targetBoxes) {
    const n = refBoxes.length;
    if (n <= 1 || targetBoxes.length !== n) return targetBoxes;
    if (n === 2) {
      const dKeep = Math.hypot(refBoxes[0].cx - targetBoxes[0].cx, refBoxes[0].cy - targetBoxes[0].cy) +
        Math.hypot(refBoxes[1].cx - targetBoxes[1].cx, refBoxes[1].cy - targetBoxes[1].cy);
      const dSwap = Math.hypot(refBoxes[0].cx - targetBoxes[1].cx, refBoxes[0].cy - targetBoxes[1].cy) +
        Math.hypot(refBoxes[1].cx - targetBoxes[0].cx, refBoxes[1].cy - targetBoxes[0].cy);
      return dSwap + 1e-6 < dKeep ? [targetBoxes[1], targetBoxes[0]] : targetBoxes;
    }
    const used = new Uint8Array(n);
    const matched = new Array(n);
    for (let i = 0; i < n; i++) {
      let bestJ = -1;
      let bestDist = Infinity;
      for (let j = 0; j < n; j++) {
        if (used[j]) continue;
        const dist = Math.hypot(refBoxes[i].cx - targetBoxes[j].cx, refBoxes[i].cy - targetBoxes[j].cy);
        if (dist < bestDist) {
          bestDist = dist;
          bestJ = j;
        }
      }
      used[bestJ] = 1;
      matched[i] = targetBoxes[bestJ];
    }
    return matched;
  }

  function sameBoxCoords(boxesA, boxesB, tolerance = 0.5) {
    if (!boxesA.length || boxesA.length !== boxesB.length) return false;
    const alignedB = matchBoxesToReference(boxesA, boxesB);
    for (let i = 0; i < boxesA.length; i++) {
      for (let k = 0; k < 4; k++) {
        if (Math.abs(boxesA[i].box[k] - alignedB[i].box[k]) > tolerance) return false;
      }
    }
    return true;
  }

  function evaluateClipRules(clipInputs, stats, label, reasonsByFrame) {
    const m = clipInputs.length;
    if (!m) return;
    const counts = clipInputs.map((input) => input.boxes.length);

    const nonEmptyInClip = counts.filter((c) => c > 0).length;
    if (CONTINUOUS_ANATOMY_LABELS.has(label) && stats.nonEmptyFraction >= 0.8 &&
        stats.totalFrames >= 6 && nonEmptyInClip / m >= 0.5) {
      for (let t = 0; t < m; t++) {
        if (counts[t] === 0) addReason(reasonsByFrame, clipInputs[t].g, "count");
      }
    }

    if (m >= 4) {
      for (let span = 1; span <= 3; span++) {
        for (let t = 1; t + span < m; t++) {
          const neighborCount = counts[t - 1];
          if (neighborCount !== counts[t + span]) continue;
          let allDifferent = true;
          for (let u = t; u < t + span; u++) {
            if (counts[u] === neighborCount) { allDifferent = false; break; }
          }
          if (allDifferent) {
            for (let u = t; u < t + span; u++) addReason(reasonsByFrame, clipInputs[u].g, "count");
          }
        }
      }
    }

    if (m >= 5) {
      const freq = new Map();
      for (const c of counts) freq.set(c, (freq.get(c) || 0) + 1);
      let modeCount = 0;
      let modeFreq = 0;
      for (const [c, f] of freq) {
        if (f > modeFreq) { modeCount = c; modeFreq = f; }
      }
      const modeThreshold = OBJECT_BBOX_LABELS.has(label) ? 0.85 : 0.75;
      if (modeCount >= 1 && modeFreq / m >= modeThreshold) {
        for (let t = 0; t < m; t++) {
          if (counts[t] !== modeCount) addReason(reasonsByFrame, clipInputs[t].g, "count");
        }
      }
    }

    for (let t = 1; t < m - 1; t++) {
      const cur = clipInputs[t].boxes;
      const rawPrev = clipInputs[t - 1].boxes;
      const rawNext = clipInputs[t + 1].boxes;
      if (!cur.length || rawPrev.length !== cur.length || rawNext.length !== cur.length) continue;
      const prev = matchBoxesToReference(cur, rawPrev);
      const next = matchBoxesToReference(cur, rawNext);
      for (let r = 0; r < cur.length; r++) {
        const pBox = prev[r].box, cBox = cur[r].box, nBox = next[r].box;
        for (let k = 0; k < 4; k++) {
          const mid = 0.5 * (pBox[k] + nBox[k]);
          const span = Math.abs(nBox[k] - pBox[k]);
          const scale = k === 0 || k === 2 ? cur[r].w : cur[r].h;
          if (Math.abs(cBox[k] - mid) > Math.max(10, 0.12 * scale, 2.2 * span)) {
            addReason(reasonsByFrame, clipInputs[t].g, "jump");
            break;
          }
        }
      }
    }

    for (let t = 2; t < m - 2; t++) {
      const b1 = clipInputs[t].boxes;
      const rawB0 = clipInputs[t - 1].boxes, rawB2 = clipInputs[t + 1].boxes, rawB3 = clipInputs[t + 2].boxes;
      if (!b1.length || rawB0.length !== b1.length || b1.length !== rawB2.length || rawB2.length !== rawB3.length) continue;
      const b0 = matchBoxesToReference(b1, rawB0);
      const b2 = matchBoxesToReference(b1, rawB2);
      const b3 = matchBoxesToReference(b2, rawB3);
      for (let r = 0; r < b1.length; r++) {
        for (let k = 0; k < 4; k++) {
          const dBefore = Math.abs(b1[r].box[k] - b0[r].box[k]);
          const dStep = Math.abs(b2[r].box[k] - b1[r].box[k]);
          const dAfter = Math.abs(b3[r].box[k] - b2[r].box[k]);
          const scale = k === 0 || k === 2 ? b1[r].w : b1[r].h;
          if (dBefore <= 1.5 && dAfter <= 1.5 && dStep > Math.max(16, 0.18 * scale)) {
            const slot = nearestSlotStats(b1[r], stats);
            const err1 = Math.abs(b1[r].logArea - slot.medLogArea) / slot.madLogArea +
              Math.hypot(b1[r].cx - slot.medCx, b1[r].cy - slot.medCy) / Math.hypot(slot.madCx, slot.madCy);
            const err2 = Math.abs(b2[r].logArea - slot.medLogArea) / slot.madLogArea +
              Math.hypot(b2[r].cx - slot.medCx, b2[r].cy - slot.medCy) / Math.hypot(slot.madCx, slot.madCy);
            let target;
            if (Math.abs(err1 - err2) > 0.1) {
              target = err1 > err2 ? clipInputs[t].g : clipInputs[t + 1].g;
            } else {
              target = clipInputs[t].hasEdit && !clipInputs[t + 1].hasEdit ? clipInputs[t + 1].g : clipInputs[t].g;
            }
            addReason(reasonsByFrame, target, "jump");
            break;
          }
        }
      }
    }

    for (let t = 0; t < m; t++) {
      const cur = clipInputs[t];
      if (!cur.hasEdit || !cur.boxes.length || cur.boxes.length !== cur.autoBoxes.length) continue;
      const prevSame = t > 0 && clipInputs[t - 1].hasEdit && sameBoxCoords(cur.boxes, clipInputs[t - 1].boxes);
      const nextSame = t + 1 < m && clipInputs[t + 1].hasEdit && sameBoxCoords(cur.boxes, clipInputs[t + 1].boxes);
      if (!prevSame && !nextSame) continue;
      const rawAdjAuto = prevSame ? clipInputs[t - 1].autoBoxes : clipInputs[t + 1].autoBoxes;
      if (rawAdjAuto.length !== cur.autoBoxes.length) continue;
      const curAuto = matchBoxesToReference(cur.boxes, cur.autoBoxes);
      const adjAuto = matchBoxesToReference(curAuto, rawAdjAuto);
      for (let r = 0; r < cur.boxes.length; r++) {
        const autoSmooth = bboxIntersectionOverUnion(curAuto[r].box, adjAuto[r].box) >= 0.65;
        const editAutoIou = bboxIntersectionOverUnion(cur.boxes[r].box, curAuto[r].box);
        if (autoSmooth && editAutoIou < 0.45) {
          addReason(reasonsByFrame, cur.g, "drift");
          break;
        }
      }
    }
  }

  function computeEditsSignature(cache) {
    const parts = [String(state.bboxEditRevision || 0)];
    if (typeof S !== "undefined" && S.ledits) {
      for (const [key, entry] of Object.entries(S.ledits)) {
        const items = entry?.[cache.label];
        if (Array.isArray(items)) parts.push(`${key}:${JSON.stringify(items)}`);
      }
    }
    return parts.join("|");
  }

  function isSegmentSettled(segment, cache) {
    if (segment === null || cache.empty.has(segment) || cache.failed.has(segment)) return true;
    if (typeof S !== "undefined" && S.sess?.segments?.[segment] && !S.sess.segments[segment].al) {
      cache.empty.add(segment);
      return true;
    }
    const data = S.al?.get(segment);
    return Boolean(data && !(data instanceof Promise));
  }

  function prepareSessionWarnings(cache) {
    const signature = computeEditsSignature(cache);
    if (cache.warningsReady && cache.warningsSignature === signature) return true;

    const allFrames = sessionLabelFrames();
    const currentG = typeof S !== "undefined" ? Number(S.shownG) : -1;
    const currentSeg = Number.isInteger(currentG) && currentG >= 0 ? frameSegment(currentG) : null;
    const queued = new Set();
    const behind = [];
    const ahead = [];
    let passedCurrent = currentSeg === null;
    let loadingFrames = 0;
    let unknownFrames = 0;

    for (const g of allFrames) {
      const seg = frameSegment(g);
      if (seg === currentSeg) passedCurrent = true;
      if (isSegmentSettled(seg, cache)) {
        if (cache.failed.has(seg) && !Array.isArray(S.ledits?.[rvKey(g)]?.[cache.label])) {
          unknownFrames += 1;
        }
        continue;
      }
      loadingFrames += 1;
      if (seg !== null && !queued.has(seg)) {
        queued.add(seg);
        (passedCurrent ? ahead : behind).push(seg);
      }
    }

    const order = currentSeg !== null && behind.includes(currentSeg)
      ? [currentSeg, ...ahead, ...behind.filter((seg) => seg !== currentSeg)]
      : [...ahead, ...behind];

    cache.warnTotalFrames = allFrames.length;
    cache.warnLoadingFrames = loadingFrames;
    cache.warnUnknownFrames = unknownFrames;
    cache.warnOrder = order;

    if (order.length > 0) {
      cache.warningsReady = false;
      return false;
    }

    const srcW = Number(S.sess?.src_w) || 1920;
    const srcH = Number(S.sess?.src_h) || 1080;
    const frameInputs = [];
    const clips = new Map();
    for (const g of allFrames) {
      const seg = frameSegment(g);
      if (cache.failed.has(seg) && !Array.isArray(S.ledits?.[rvKey(g)]?.[cache.label])) continue;
      const input = readFrameWarningInput(g, cache);
      frameInputs.push(input);
      if (!clips.has(input.clipKey)) clips.set(input.clipKey, []);
      clips.get(input.clipKey).push(input);
    }

    const stats = buildSessionStats(frameInputs);
    const reasonsByFrame = new Map();
    for (const input of frameInputs) {
      evaluateFrameRules(input, stats, cache.label, srcW, srcH, reasonsByFrame);
    }
    for (const clipInputs of clips.values()) {
      evaluateClipRules(clipInputs, stats, cache.label, reasonsByFrame);
    }

    const warnings = new Map();
    for (const [g, codeSet] of reasonsByFrame) {
      const codes = [...codeSet];
      const title = codes.map((code) => WARN_DESCRIPTIONS[code] || code).join(" · ");
      warnings.set(g, { codes, label: `⚠ ${codes.join(",")}`, title });
    }
    cache.warnings = warnings;
    cache.warningsSignature = signature;
    cache.warningsReady = true;
    return true;
  }

  function setFrameWarnBadge(li, warning) {
    const existing = li.querySelector(":scope > .nl-warn-badge");
    if (!warning) {
      existing?.remove();
      return;
    }
    const badge = existing || document.createElement("span");
    badge.className = "nl-warn-badge";
    if (badge.textContent !== warning.label) badge.textContent = warning.label;
    if (badge.title !== warning.title) badge.title = warning.title;
    if (!existing) insertBeforeFrameName(li, badge);
  }

  Object.assign(NL, {
     isSegmentSettled, matchBoxesToReference, prepareSessionWarnings, setFrameWarnBadge
  });
})();
