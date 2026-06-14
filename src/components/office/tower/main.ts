// @ts-nocheck
/* CLAUDE Agent Tower — boot/destroy lifecycle, camera (tower / floor views), game loop.
 *
 * Adapted from Agents_GUI/js/main.js for Mission Control: instead of
 * self-booting and owning the page, the engine exposes HG.boot(rootEl) /
 * HG.destroy() so the React wrapper can mount and unmount it with the
 * office tab. Sizing follows the mount container (ResizeObserver), not the
 * window; the data feed is pushed in by the host (no HG.API polling).
 */
window.HG = window.HG || {};

(function (HG) {
  "use strict";

  // tower-view layout
  var MINI_W = 256, MINI_H = 144;       // floors decimated 0.5x
  var BX = 22, ROOF = 50, SLOT = 154, BASE = 16;
  var BW = 300, BH = ROOF + 5 * SLOT + BASE;

  var rootEl = null;
  var canvas = null;
  var ctx = null;
  var scratch = null;
  var sctx = null;
  var rafId = 0;
  var resizeObs = null;
  var hoverSlot = -1;
  var last = 0;

  // The world (floors, agents, elevator, view) lives on the HG singleton and
  // persists across React mount/unmount — so leaving and returning to the
  // tab keeps every agent exactly where it was. It is only (re)built on the
  // first mount or when the roster signature genuinely changes.
  var worldBuilt = false;
  var worldSig = null;

  HG.View = {
    mode: "building",
    floor: 4,
    setFloor: function (i) {
      this.mode = "floor";
      this.floor = Math.max(0, Math.min(4, i));
      resize();
    },
    setBuilding: function () {
      this.mode = "building";
      if (HG.UI) HG.UI.setHover(null);
      resize();
    }
  };

  function slotY(floorIdx) { return ROOF + (4 - floorIdx) * SLOT; }

  function resize() {
    if (!canvas || !rootEl) return;
    var iw = HG.View.mode === "building" ? BW : HG.VIEW_W;
    var ih = HG.View.mode === "building" ? BH : HG.VIEW_H;
    canvas.width = iw;
    canvas.height = ih;
    var cw = rootEl.clientWidth || iw, ch = rootEl.clientHeight || ih;
    var s = Math.min(cw / iw, ch / ih);
    if (s >= 1) s = Math.max(1, Math.floor(s));
    canvas.style.width = Math.round(iw * s) + "px";
    canvas.style.height = Math.round(ih * s) + "px";
    ctx.imageSmoothingEnabled = false;
  }

  function toCanvas(e) {
    var r = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - r.left) / r.width * canvas.width,
      y: (e.clientY - r.top) / r.height * canvas.height
    };
  }

  /* ---------------- floor rendering pipeline ---------------- */

  function renderFloor(floorIdx, c, t, withUI) {
    var fl = HG.Floors.get(floorIdx);
    fl.drawBase(c);
    fl.drawAnim(c, t);
    HG.Agents.draw(c, t, floorIdx,
      withUI ? HG.UI.hoverAgent : null,
      withUI ? HG.UI.selectedAgent : null);
    fl.drawOverlay(c, t);
    if (floorIdx === HG.Orchestrator.FLOOR) HG.Orchestrator.draw(c, t);
  }

  /* ---------------- tower view ---------------- */

  var stars = [];
  (function () {
    var s = 4242;
    function rnd() { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; }
    for (var i = 0; i < 90; i++) stars.push([Math.floor(rnd() * BW), Math.floor(rnd() * BH), rnd()]);
  })();

  function renderBuilding(t) {
    // night sky
    ctx.fillStyle = "#07070f";
    ctx.fillRect(0, 0, BW, BH);
    for (var st = 0; st < stars.length; st++) {
      if (Math.sin(t * (1 + stars[st][2] * 2) + st) > -0.2) {
        ctx.fillStyle = "rgba(200,210,255," + (0.25 + stars[st][2] * 0.4) + ")";
        ctx.fillRect(stars[st][0], stars[st][1], 1, 1);
      }
    }

    // floors (live, decimated)
    for (var f = 0; f < 5; f++) {
      renderFloor(f, sctx, t, false);
      ctx.drawImage(scratch, 0, 0, HG.VIEW_W, HG.VIEW_H, BX, slotY(f), MINI_W, MINI_H);
      // hover tint
      if (hoverSlot === f) {
        ctx.fillStyle = "rgba(160,200,255,0.06)";
        ctx.fillRect(BX, slotY(f), MINI_W, MINI_H);
      }
    }

    // frame: side columns
    ctx.fillStyle = "#1a1a26";
    ctx.fillRect(BX - 12, ROOF - 6, 12, 5 * SLOT + 8);
    ctx.fillRect(BX + MINI_W, ROOF - 6, 12, 5 * SLOT + 8);
    ctx.fillStyle = "#23232f";
    ctx.fillRect(BX - 12, ROOF - 6, 2, 5 * SLOT + 8);
    ctx.fillRect(BX + MINI_W + 10, ROOF - 6, 2, 5 * SLOT + 8);
    for (var rv = 0; rv < 5 * SLOT; rv += 18) {
      ctx.fillStyle = "#2e2e3e";
      ctx.fillRect(BX - 7, ROOF + rv, 2, 2);
      ctx.fillRect(BX + MINI_W + 5, ROOF + rv, 2, 2);
    }

    // slabs between floors + labels
    for (var f2 = 0; f2 < 5; f2++) {
      var sy = slotY(f2) + MINI_H;
      ctx.fillStyle = "#23232f";
      ctx.fillRect(BX - 12, sy, MINI_W + 24, SLOT - MINI_H);
      ctx.fillStyle = "#2e2e3e";
      ctx.fillRect(BX - 12, sy, MINI_W + 24, 2);
      ctx.fillStyle = "#101018";
      ctx.fillRect(BX - 12, sy + SLOT - MINI_H - 2, MINI_W + 24, 2);
      // label
      ctx.font = "bold 7px monospace";
      ctx.textBaseline = "top";
      ctx.fillStyle = HG.Floors.ACCENTS[f2];
      ctx.fillText("F" + f2 + " " + HG.Floors.NAMES[f2], BX + 2, sy + 2);
      // agent count
      var n = HG.Agents.onFloor(f2).length;
      ctx.fillStyle = "#8a93b5";
      ctx.fillText(n + "⬤", BX + MINI_W - 24, sy + 2);
    }

    // elevator shaft (right area of interiors) + car
    var shaftX = BX + Math.round(HG.Props.ELE.x / 2);
    var shaftW = Math.round(HG.Props.ELE.w / 2);
    ctx.fillStyle = "rgba(10,10,16,0.55)";
    ctx.fillRect(shaftX, ROOF - 4, shaftW, 5 * SLOT + 4);
    ctx.fillStyle = "#2e2e3e";
    ctx.fillRect(shaftX - 1, ROOF - 4, 1, 5 * SLOT + 4);
    ctx.fillRect(shaftX + shaftW, ROOF - 4, 1, 5 * SLOT + 4);
    // car
    var p = HG.Elevator.carPos();
    var carY = ROOF + (4 - p) * SLOT + 13;
    ctx.fillStyle = "#3a3f52";
    ctx.fillRect(shaftX, Math.round(carY), shaftW, 27);
    ctx.fillStyle = "#4a5066";
    ctx.fillRect(shaftX, Math.round(carY), shaftW, 2);
    ctx.fillStyle = "#161a24";
    ctx.fillRect(shaftX + 2, Math.round(carY) + 4, shaftW - 4, 18);
    // riders as dots
    var riders = HG.Elevator.riders();
    for (var rd = 0; rd < Math.min(riders.length, 5); rd++) {
      ctx.fillStyle = riders[rd].skin.accent;
      ctx.fillRect(shaftX + 3 + rd * 3, Math.round(carY) + 16, 2, 5);
    }
    // cable
    ctx.fillStyle = "#101018";
    ctx.fillRect(shaftX + shaftW / 2, ROOF - 6, 1, Math.round(carY) - ROOF + 6);

    // roof
    ctx.fillStyle = "#1e1e2a";
    ctx.fillRect(BX - 16, ROOF - 12, MINI_W + 32, 8);
    ctx.fillStyle = "#2a2a38";
    ctx.fillRect(BX - 16, ROOF - 12, MINI_W + 32, 2);
    // antenna + beacon
    var antX = BX + 30;
    ctx.fillStyle = "#3a3a4c";
    ctx.fillRect(antX, ROOF - 40, 2, 28);
    ctx.fillRect(antX - 4, ROOF - 26, 10, 1);
    ctx.fillStyle = Math.floor(t * 1.5) % 2 ? "#ff4f6e" : "#5a2030";
    ctx.fillRect(antX - 1, ROOF - 43, 4, 3);
    // holo sign — the orchestrator's name (set by the host via HG.setSign)
    ctx.font = "bold 12px monospace";
    var flick = Math.sin(t * 11) > -0.9;
    var sign = HG.SIGN || "CLAUDE";
    var sw = ctx.measureText(sign).width;
    var sx0 = Math.round(BX + MINI_W / 2 - sw / 2);
    ctx.fillStyle = "rgba(79,216,255,0.18)";
    ctx.fillRect(sx0 - 2, ROOF - 38, Math.round(sw) + 4, 16);
    ctx.fillStyle = flick ? "rgba(79,216,255,0.85)" : "rgba(79,216,255,0.25)";
    ctx.fillText(sign, sx0, ROOF - 36);
    // orchestrator status dot on the sign
    ctx.fillStyle = HG.Orchestrator.intensity(t) > 0.6 ? "#ffd75c" : "#39e75f";
    ctx.fillRect(sx0 + Math.round(sw) + 6, ROOF - 33, 3, 3);

    // base / street
    ctx.fillStyle = "#15151f";
    ctx.fillRect(0, BH - BASE, BW, BASE);
    ctx.fillStyle = "#23232f";
    ctx.fillRect(BX - 18, BH - BASE, MINI_W + 36, 3);
  }

  /* ---------------- loop ---------------- */

  function loop(ms) {
    var t = ms / 1000;
    var dt = Math.min(0.05, t - last);
    last = t;

    HG.Agents.update(dt, t);
    HG.Elevator.update(dt, t);
    HG.Orchestrator.update(dt, t);

    if (HG.View.mode === "building") {
      renderBuilding(t);
    } else {
      renderFloor(HG.View.floor, ctx, t, true);
      // CRT scanlines
      ctx.fillStyle = "rgba(0,0,0,0.06)";
      for (var y = 0; y < HG.VIEW_H; y += 3) ctx.fillRect(0, y, HG.VIEW_W, 1);
    }

    HG.UI.refresh();
    rafId = requestAnimationFrame(loop);
  }

  /* ---------------- input ---------------- */

  function slotAt(p) {
    for (var f = 0; f < 5; f++) {
      if (p.x >= BX && p.x <= BX + MINI_W && p.y >= slotY(f) && p.y <= slotY(f) + MINI_H) return f;
    }
    return -1;
  }

  function onMouseMove(e) {
    var p = toCanvas(e);
    if (HG.View.mode === "building") {
      hoverSlot = slotAt(p);
      canvas.style.cursor = hoverSlot >= 0 ? "pointer" : "default";
    } else {
      var a = HG.Agents.agentAt(HG.View.floor, p.x, p.y);
      HG.UI.setHover(a);
      canvas.style.cursor = a ? "pointer" : "default";
    }
  }

  function onClick(e) {
    var p = toCanvas(e);
    if (HG.View.mode === "building") {
      var f = slotAt(p);
      if (f >= 0) HG.View.setFloor(f);
    } else {
      HG.UI.select(HG.Agents.agentAt(HG.View.floor, p.x, p.y));
    }
  }

  // exposed for tooling/tests
  HG.render = { floor: renderFloor, building: renderBuilding };

  /* ---------------- lifecycle ---------------- */

  // Build (or rebuild) the simulated world. Resets every agent to the lounge,
  // so this runs only on first boot or a real roster change — never on a
  // plain remount.
  function buildWorld() {
    HG.View.mode = "building";
    HG.Elevator.reset();
    HG.Orchestrator.reset();
    HG.Floors.init();
    HG.Agents.init();
    worldBuilt = true;
  }

  // Bind the engine to a freshly-mounted DOM root and start the loop. Reuses
  // the existing world unless `sig` (the roster signature) changed.
  HG.boot = function (el, sig) {
    if (rootEl) detach();   // defensive: never run two loops

    if (!worldBuilt || sig !== worldSig) {
      buildWorld();
      worldSig = sig;
    }

    rootEl = el;
    canvas = el.querySelector("#game");
    ctx = canvas.getContext("2d");
    scratch = document.createElement("canvas");
    scratch.width = HG.VIEW_W; scratch.height = HG.VIEW_H;
    sctx = scratch.getContext("2d");
    hoverSlot = -1;

    HG.UI.init(el);
    resize();   // honors the preserved HG.View.mode/floor

    resizeObs = new ResizeObserver(resize);
    resizeObs.observe(el);
    canvas.addEventListener("mousemove", onMouseMove);
    canvas.addEventListener("click", onClick);

    rafId = requestAnimationFrame(function (ms) { last = ms / 1000; rafId = requestAnimationFrame(loop); });
  };

  // Detach from the DOM and freeze the loop, but KEEP the world in memory so
  // a later boot() resumes every agent exactly where it left off.
  function detach() {
    if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
    if (resizeObs) { resizeObs.disconnect(); resizeObs = null; }
    if (canvas) {
      canvas.removeEventListener("mousemove", onMouseMove);
      canvas.removeEventListener("click", onClick);
    }
    HG.UI.destroy();
    rootEl = null; canvas = null; ctx = null; scratch = null; sctx = null;
  }

  HG.destroy = detach;
})(window.HG);
