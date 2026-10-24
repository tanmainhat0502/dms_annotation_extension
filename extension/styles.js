(() => {
  "use strict";

  const NL = window.__notaOrganizerV1 = window.__notaOrganizerV1 || {};
  const {
    ROOT_ID, STYLE_ID, state
  } = NL;

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      #nl-status-filters { display: flex; flex-wrap: wrap; gap: 5px 10px; margin-top: 6px; }
      #nl-status-filters label { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; cursor: pointer; }
      #nl-status-filters input { margin: 0; accent-color: #55aaff; }
      #nl-clip-status-menu, #nl-part-status-menu {
        position: fixed; z-index: 10000; width: 205px; max-width: calc(100vw - 16px);
        box-sizing: border-box; padding: 6px; border: 1px solid #596273; border-radius: 5px;
        background: #202630; color: #dce4ee; font: 12px/1.4 "Segoe UI", sans-serif;
        box-shadow: 0 4px 16px #0008;
      }
      #nl-clip-status-menu .nl-menu-title { padding: 3px 5px 6px; color: #aeb9c8; }
      #nl-clip-status-menu button, #nl-part-status-menu button {
        display: block; width: 100%; padding: 7px; text-align: left; font: inherit;
        color: inherit; background: transparent; border: 0; border-radius: 3px; cursor: pointer;
      }
      #nl-clip-status-menu button:hover, #nl-clip-status-menu button:focus-visible,
      #nl-part-status-menu button:hover, #nl-part-status-menu button:focus-visible { background: #354355; }
      #nl-timeline-controls {
        display: flex; align-items: center; gap: 6px;
        flex: none; min-width: 0; height: 44px;
      }
      #nl-timeline-controls[hidden] { display: none !important; }
      #nl-timeline-controls > #bar { flex: 1 1 0; width: 0; min-width: 0; height: 44px; }
      #bar.nl-timeline-locked { cursor: not-allowed; touch-action: none; }
      #nl-timeline-lock {
        display: inline-flex; align-items: center; justify-content: center;
        flex: 0 0 32px; width: 32px; height: 32px; box-sizing: border-box; padding: 4px;
        border: 1px solid var(--line, #353b45); border-radius: 4px;
        background: var(--panel, #1d2128); color: var(--dim, #aab2bf); cursor: pointer;
      }
      #nl-timeline-lock:hover { border-color: var(--accent, #69b8ff); }
      #nl-timeline-lock:focus-visible { outline: 2px solid var(--accent, #69b8ff); outline-offset: 2px; }
      #nl-timeline-lock[aria-pressed="true"] { color: #ffd278; border-color: #a98136; background: #352d1e; }
      #${ROOT_ID} {
        display: flex;
        flex-wrap: wrap;
        flex-shrink: 0;
        align-items: center;
        gap: 6px;
        padding: 8px 6px;
        border-bottom: 1px solid var(--line, #353b45);
        background: var(--panel, #1d2128);
        position: sticky;
        top: 0;
        z-index: 4;
      }
      #${ROOT_ID}[hidden] { display: none !important; }
      #${ROOT_ID} .nl-search-wrap {
        position: relative;
        flex: 1;
        min-width: 0;
      }
      #${ROOT_ID} .nl-search {
        box-sizing: border-box;
        width: 100%;
        height: 32px;
        padding: 5px 30px 5px 9px;
        border: 1px solid #606978;
        border-radius: 5px;
        background: #11141a;
        color: #f4f6fa;
        font: inherit;
        outline: none;
      }
      #${ROOT_ID} .nl-search:focus {
        border-color: #55aaff;
        box-shadow: 0 0 0 2px rgba(85, 170, 255, .2);
      }
      #${ROOT_ID} .nl-clear {
        position: absolute;
        right: 3px;
        top: 3px;
        width: 26px;
        height: 26px;
        border: 0;
        border-radius: 4px;
        color: #c9d1dc;
        background: transparent;
        cursor: pointer;
        font-size: 17px;
        line-height: 24px;
      }
      #${ROOT_ID} .nl-clear:hover { background: #303641; color: #fff; }
      #${ROOT_ID} .nl-status {
        flex: none;
        min-width: 46px;
        color: #aeb9c8;
        font-size: 11px;
        text-align: right;
        white-space: nowrap;
      }
      #${ROOT_ID} .nl-bbox-controls {
        flex-wrap: wrap;
        display: flex;
        align-items: center;
        gap: 5px;
        flex: 0 0 100%;
        min-width: 0;
        font-size: 11px;
        color: #cbd5e1;
      }
      #${ROOT_ID} .nl-bbox-controls input {
        box-sizing: border-box;
        width: 94px;
        height: 27px;
        padding: 3px 5px;
        border: 1px solid #606978;
        border-radius: 4px;
        background: #11141a;
        color: #f4f6fa;
        font: inherit;
      }
      #${ROOT_ID} .nl-bbox-controls input[aria-invalid="true"] { border-color: #ff6b78; }
      #${ROOT_ID} .nl-bbox-all {
        flex: none;
        height: 27px;
        padding: 3px 6px;
        border: 1px solid #606978;
        border-radius: 4px;
        background: #242a33;
        color: #dce4ee;
        font: inherit;
        cursor: pointer;
      }
      #${ROOT_ID} .nl-bbox-all[aria-pressed="true"] { border-color: #55aaff; color: #d9f3ff; background: #17384c; }
      #${ROOT_ID} .nl-bbox-warn {
        flex: none;
        height: 27px;
        padding: 3px 6px;
        border: 1px solid #8a6528;
        border-radius: 4px;
        background: #2b2316;
        color: #ffd480;
        font: inherit;
        font-weight: 600;
        cursor: pointer;
      }
      #${ROOT_ID} .nl-bbox-warn:hover:not(:disabled) { border-color: #f59e0b; background: #3b2e19; }
      #${ROOT_ID} .nl-bbox-warn[aria-pressed="true"] { border-color: #f59e0b; color: #fff4d6; background: #5c3a10; }
      #labList li .nl-warn-badge {
        display: inline-block;
        margin-right: 5px;
        padding: 0 4px;
        border: 1px solid rgba(245, 158, 11, .55);
        border-radius: 3px;
        background: rgba(120, 53, 15, .55);
        color: #fcd34d;
        font-size: 10px;
        font-weight: 600;
        line-height: 1.35;
        vertical-align: baseline;
      }
      #${ROOT_ID} .nl-bbox-controls :disabled { opacity: .5; cursor: default; }
      #${ROOT_ID} .nl-done-all {
        flex: none;
        height: 27px;
        padding: 3px 7px;
        border: 1px solid #318f50;
        border-radius: 4px;
        background: #173d29;
        color: #a8ffbf;
        font: inherit;
        font-weight: 700;
        cursor: pointer;
      }
      #${ROOT_ID} .nl-bbox-status {
        flex: 1;
        min-width: 0;
        text-align: right;
        color: #aeb9c8;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      #${ROOT_ID} .nl-bbox-progress-wrap {
        flex: 0 0 100%;
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 3px;
        padding-top: 2px;
      }
      #${ROOT_ID} .nl-bbox-progress-wrap[hidden] { display: none !important; }
      #${ROOT_ID} .nl-bbox-progress-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 6px;
        min-width: 0;
        font-size: 11px;
        line-height: 1.25;
      }
      #${ROOT_ID} .nl-bbox-progress-text {
        flex: 1;
        min-width: 0;
        color: #93c5fd;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      #${ROOT_ID} .nl-bbox-progress-pct {
        flex: none;
        font-weight: 700;
        font-variant-numeric: tabular-nums;
        color: #93c5fd;
      }
      #${ROOT_ID} .nl-bbox-progress-wrap[data-state="done"] .nl-bbox-progress-text,
      #${ROOT_ID} .nl-bbox-progress-wrap[data-state="done"] .nl-bbox-progress-pct {
        color: #8cffaa;
      }
      #${ROOT_ID} .nl-bbox-progress-wrap[data-state="partial"] .nl-bbox-progress-text,
      #${ROOT_ID} .nl-bbox-progress-wrap[data-state="partial"] .nl-bbox-progress-pct {
        color: #ffd166;
      }
      #${ROOT_ID} .nl-bbox-progress {
        width: 100%;
        height: 5px;
        accent-color: #55aaff;
      }
      #${ROOT_ID} .nl-bbox-progress[data-state="done"] { accent-color: #59b780; }
      #${ROOT_ID} .nl-bbox-progress[data-state="partial"] { accent-color: #f59e0b; }
      #labList .nl-clip[hidden], #labList li[data-g][hidden] { display: none !important; }
      #labList .nl-organized > .nl-clips {
        flex: 1;
        min-width: 0;
      }
      #labList .nl-organized > .vlab {
        position: relative;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: flex-start;
        writing-mode: horizontal-tb;
      }
      #labList .nl-part-name { writing-mode: vertical-rl; text-orientation: upright; }
      #labList .nl-part-tools {
        position: sticky;
        top: calc(var(--nl-toolbar-height, 0px) + 4px);
        z-index: 2;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 6px;
        margin-top: 7px;
        background: #23272e;
        border-radius: 4px;
        letter-spacing: 0;
      }
      #labList .nl-part-total {
        display: inline-flex;
        align-items: center;
        padding: 5px 2px;
        border: 1px solid #397a9f;
        border-radius: 4px;
        color: #d9f3ff;
        background: #17384c;
        font-size: 10px;
        font-weight: 750;
        line-height: 1;
        white-space: nowrap;
        writing-mode: vertical-rl;
      }
      #labList .nl-part-done-label {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 4px;
        padding: 4px 1px;
        color: #8cffaa;
        font-size: 10px;
        line-height: 1.1;
        cursor: pointer;
      }
      #labList .nl-part-status-choice {
        padding: 0; border: 0; color: inherit; background: transparent; font: inherit;
        writing-mode: vertical-rl; text-orientation: mixed; cursor: pointer;
      }
      #labList .nl-part-status-choice:hover:not(:disabled),
      #labList .nl-part-status-choice:focus-visible { color: #fff; text-decoration: underline; }
      #labList .nl-part-status-choice:disabled { opacity: .5; cursor: progress; }
      #labList .nl-part-done { width: 16px; height: 16px; margin: 0; accent-color: #39b767; cursor: pointer; }
      #labList .nl-part-done:disabled { cursor: progress; }
      #labList .nl-part-tools[aria-busy="true"] { opacity: .7; }
      #labList > .grp[hidden] { display: none !important; }
      #labList .nl-clip {
        border-bottom: 1px solid rgba(255,255,255,.06);
      }
      #labList .nl-clip:last-child { border-bottom: 0; }
      #labList .nl-clip > summary {
        position: sticky;
        top: var(--nl-toolbar-height, 0px);
        z-index: 3;
        scroll-margin-top: var(--nl-toolbar-height, 0px);
        display: flex;
        align-items: center;
        gap: 7px;
        min-height: 30px;
        padding: 4px 7px;
        box-sizing: border-box;
        cursor: pointer;
        user-select: none;
        color: #f1f5f9;
        background: #222832;
        list-style: none;
      }
      #labList .nl-clip li[data-g] {
        scroll-margin-top: calc(var(--nl-toolbar-height, 0px) + 36px);
      }
      #labList .nl-clip > summary::-webkit-details-marker { display: none; }
      #labList .nl-clip > summary::before {
        content: "▶";
        width: 10px;
        flex: none;
        color: #65b5ff;
        font-size: 9px;
        transition: transform .12s ease;
      }
      #labList .nl-clip[open] > summary::before { transform: rotate(90deg); }
      #labList .nl-clip > summary:hover { background: #2a313d; }
      #labList .nl-clip.nl-current > summary {
        background: #29384a;
        box-shadow: inset 3px 0 0 #55aaff;
      }
      #labList .nl-clip-no {
        min-width: 30px;
        color: #fff;
      }
      #labList .nl-clip-meta {
        flex: 1;
        min-width: 0;
        color: #aeb9c8;
        font-size: 11px;
        text-align: right;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      #labList .nl-clip-status-actions {
        display: inline-flex;
        align-items: center;
        gap: 3px;
        flex: none;
      }
      #labList .nl-clip-status-actions button {
        min-height: 24px;
        padding: 2px 5px;
        border: 1px solid #596273;
        border-radius: 4px;
        background: #202630;
        color: #dce4ee;
        font: inherit;
        font-size: 9px;
        font-weight: 650;
        line-height: 1.1;
        white-space: nowrap;
        cursor: pointer;
      }
      #labList .nl-clip-status-actions button:hover:not(:disabled) { background: #303947; }
      #labList .nl-clip-status-actions button[data-state="done"] { border-color: #318f50; color: #8cffaa; }
      #labList .nl-clip-status-actions button[data-state="todo"] { border-color: #788394; color: #d9e0e8; }
      #labList .nl-clip-status-actions button[data-state="wip"] { border-color: #bd7b20; color: #ffc86f; }
      #labList .nl-clip-status-actions button.current { box-shadow: inset 0 0 0 1px currentColor; background: #303947; }
      #labList .nl-clip-status-actions button:disabled { opacity: .42; cursor: default; }
      #labList .nl-clip-status-actions[aria-busy="true"] { opacity: .62; }
      #labList .nl-checkpoint {
        flex: none;
        color: #ffd166;
        font-size: 11px;
        line-height: 1;
      }
      #labList li.nl-marked-frame {
        box-shadow: inset 3px 0 0 #bd76ee;
        background: rgba(116, 64, 161, .28);
      }
      #labList .nl-frame-mark {
        flex: none;
        color: #e3b6ff;
        font-size: 10px;
        font-weight: 700;
      }
      #labList li.nl-range-start-frame { box-shadow: inset 3px 0 0 #64dc9b; }
      #labList .nl-range-mark { flex: none; color: #64dc9b; font-size: 10px; font-weight: 700; }
      #labList .nl-clip > ul { width: 100%; }
      #labList .nl-empty-filter {
        margin: 10px 7px;
        padding: 10px;
        border: 1px dashed #596273;
        border-radius: 5px;
        color: #bac3cf;
        text-align: center;
        font-size: 12px;
      }
      body.sideMin #${ROOT_ID} { display: none !important; }
      body.sideMin #labList .nl-clip > summary { padding: 3px 4px; min-height: 25px; }
      body.sideMin #labList .nl-clip-meta { display: none; }
      body.sideMin #labList .nl-clip-status-actions { display: none; }

      #nl-polygon-tools {
        margin: 8px 0;
        padding: 7px;
        border: 1px solid #596273;
        border-radius: 5px;
        background: #171b22;
      }
      #nl-polygon-tools .nl-poly-buttons { display: grid; grid-template-columns: 1fr 1fr; gap: 5px; }
      #nl-polygon-tools button {
        padding: 6px 5px;
        border: 1px solid #596273;
        border-radius: 4px;
        color: #dce4ee;
        background: #202630;
        cursor: pointer;
        font-size: 11px;
      }
      #nl-polygon-tools button.on {
        border-color: #b56cff;
        color: #fff;
        background: #543074;
      }
      #nl-polygon-tools button[data-poly="subtract"] { color: #ff9ba4; border-color: #98515a; }
      #nl-polygon-tools button[data-poly="subtract"].on { color: #fff; border-color: #ff4d5a; background: #782b35; }
      #nl-polygon-tools .nl-poly-help { margin-top: 5px; color: #aeb9c8; font-size: 10px; line-height: 1.35; }

      .nl-bulk-dialog {
        width: min(520px, calc(100vw - 28px));
        padding: 0;
        border: 1px solid #8751b3;
        border-radius: 10px;
        color: #f1f3f7;
        background: #1c1e25;
        box-shadow: 0 20px 70px rgba(0,0,0,.55);
      }
      .nl-bulk-dialog::backdrop { background: rgba(0,0,0,.68); }
      .nl-bulk-dialog .nl-modal { padding: 20px; }
      .nl-bulk-dialog .nl-bulk-tabs { margin-bottom: 16px; }
      .nl-bulk-dialog .nl-label-panel[hidden], .nl-bulk-dialog .nl-status-panel[hidden] { display: none !important; }
      .nl-bulk-dialog h2 { margin: 0 0 5px; font-size: 20px; }
      .nl-bulk-dialog .nl-sub { margin: 0 0 15px; color: #c1c8d2; font-size: 13px; }
      .nl-bulk-dialog .nl-label { display: block; margin: 12px 0 6px; color: #e7eaf0; font-size: 13px; }
      .nl-bulk-dialog .nl-choice { display: grid; grid-template-columns: 1fr 1fr; gap: 7px; }
      .nl-bulk-dialog .nl-choice button,
      .nl-bulk-dialog .nl-actions button {
        min-height: 38px;
        border: 1px solid #596273;
        border-radius: 6px;
        color: #e9edf3;
        background: #171a20;
        cursor: pointer;
        font-weight: 600;
      }
      .nl-bulk-dialog .nl-choice button.on,
      .nl-bulk-dialog .nl-actions .primary { border-color: #bd76ee; background: #7440a1; color: #fff; }
      .nl-bulk-dialog .nl-scope { display: grid; gap: 6px; padding: 9px; border: 1px solid #414754; border-radius: 6px; }
      .nl-bulk-dialog .nl-scope[hidden], .nl-bulk-dialog .nl-label[hidden],
      .nl-bulk-dialog .nl-choice button[hidden] { display: none !important; }
      .nl-bulk-dialog .nl-scope label { display: flex; gap: 7px; align-items: flex-start; font-size: 12px; }
      .nl-bulk-dialog .nl-scope label[hidden] { display: none !important; }
      .nl-bulk-dialog .nl-mask-only[hidden] { display: none !important; }
      .nl-bulk-dialog .nl-count, .nl-bulk-dialog .nl-status-count {
        box-sizing: border-box;
        width: 100%;
        height: 40px;
        padding: 7px 10px;
        border: 1px solid #687181;
        border-radius: 6px;
        color: #fff;
        background: #101319;
        font: inherit;
      }
      .nl-bulk-dialog .nl-preview { margin-top: 10px; padding: 10px; border-radius: 6px; color: #ddd5e6; background: #2b2235; font-size: 12px; line-height: 1.45; }
      .nl-bulk-dialog .nl-preview.err { color: #ffb4b4; background: #3a2024; }
      .nl-bulk-dialog .nl-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 15px; }
      .nl-bulk-dialog .nl-actions button { min-width: 100px; padding: 0 12px; }
      .nl-bulk-dialog button:disabled { opacity: .5; cursor: default; }
      .nl-bulk-dialog.nl-subtract h2 { color: #ff9ba4; }
      .nl-bulk-dialog.nl-subtract .nl-preview { color: #ffd8dc; background: #3d252d; }
      .nl-bulk-dialog.nl-subtract .nl-actions .primary { border-color: #ff6b78; background: #9b3542; }
      .nl-bulk-dialog.nl-status-mode h2 { color: #e3b6ff; }
      .nl-bulk-dialog.nl-status-mode .nl-actions .primary { border-color: #bd76ee; background: #7440a1; }

      #nl-marked-frames {
        position: fixed;
        z-index: 20;
        display: flex;
        align-items: center;
        gap: 8px;
        min-height: 34px;
        padding: 5px 8px;
        border: 1px solid #8751b3;
        border-radius: 6px;
        color: #f1e8f7;
        background: rgba(31, 25, 39, .94);
        box-shadow: 0 5px 18px rgba(0,0,0,.35);
        font-size: 12px;
        pointer-events: none;
      }
      #nl-marked-frames[hidden] { display: none !important; }
      #nl-marked-frames .nl-mark-box {
        display: inline-grid;
        place-items: center;
        width: 15px;
        height: 15px;
        border: 1px solid #c6a0df;
        border-radius: 2px;
        color: #fff;
        background: #7440a1;
        font-size: 11px;
      }
      #nl-marked-frames[data-count="0"] .nl-mark-box { color: transparent; background: transparent; }
      #nl-marked-frames button {
        padding: 3px 7px;
        border: 1px solid #65566f;
        border-radius: 4px;
        color: #eee7f3;
        background: #31293a;
        cursor: pointer;
        font: inherit;
        pointer-events: auto;
      }
      #nl-marked-frames button[hidden] { display: none; }
      #nl-marked-frames .nl-range-start-badge { color: #64dc9b; font-weight: 700; }
      #nl-marked-frames .nl-range-start-badge[hidden] { display: none; }
      .nl-eye-group-hint {
        margin-top: 7px;
        padding: 7px 8px;
        border: 1px solid #4b5667;
        border-radius: 5px;
        color: #d7dce5;
        background: #242a33;
        font-size: 11px;
        line-height: 1.4;
      }
    `;
    document.head.appendChild(style);
  }

  Object.assign(NL, {
    injectStyle
  });
})();
