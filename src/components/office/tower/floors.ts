// @ts-nocheck
/* CLAUDE Agent Floor — the tower: 5 themed floors.
 *   4  OPS        — workstations + the orchestrator
 *   3  LAB        — fabrication: holo-table, robot assembly, 3D printer
 *   2  SECURITY   — radar, camera wall, vault
 *   1  MAINFRAME  — server hall, reactor core, recharge pods
 *   0  LOUNGE     — café, sofas, arcade, jukebox
 * Every floor: 512x288 interior, elevator bay on the right, own obstacle
 * grid + POI set. Static art prerendered; anim/overlay passes per frame.
 */
window.HG = window.HG || {};

(function (HG) {
  "use strict";

  var W = HG.VIEW_W, H = HG.VIEW_H, CELL = HG.CELL;
  var GW = Math.ceil(W / CELL), GH = Math.ceil(H / CELL);
  var WALL_Y = 80;
  var PAL = HG.PAL;
  var P; // HG.Props bound on init

  function mkRng(seed) {
    var s = seed;
    return function () { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
  }

  /* ================= Floor base class ================= */

  function Floor(idx, name, accent) {
    this.idx = idx;
    this.name = name;
    this.accent = accent;
    this.pois = [];
    this.grid = [];
    for (var cy = 0; cy < GH; cy++) {
      var row = [];
      for (var cx = 0; cx < GW; cx++) row.push(false);
      this.grid.push(row);
    }
    this.base = document.createElement("canvas");
    this.base.width = W; this.base.height = H;
    this.animFns = [];
    this.overlayFns = [];
    this.seeds = [];
    var rng = mkRng(1000 + idx * 977);
    for (var i = 0; i < 24; i++) this.seeds.push(Math.floor(rng() * 1000));
  }

  Floor.prototype.block = function (x, y, w, h) {
    var x0 = Math.floor(x / CELL), y0 = Math.floor(y / CELL);
    var x1 = Math.ceil((x + w) / CELL), y1 = Math.ceil((y + h) / CELL);
    for (var cy = y0; cy < y1; cy++) {
      for (var cx = x0; cx < x1; cx++) {
        if (cy >= 0 && cy < GH && cx >= 0 && cx < GW) this.grid[cy][cx] = true;
      }
    }
  };

  Floor.prototype.poi = function (type, x, y, facing) {
    this.pois.push({ id: this.idx + "_" + type + "_" + this.pois.length, floor: this.idx, type: type, x: x, y: y, facing: facing || "up", occupiedBy: null });
  };

  Floor.prototype.isBlocked = function (cx, cy) {
    if (cx < 0 || cy < 0 || cx >= GW || cy >= GH) return true;
    return this.grid[cy][cx];
  };

  Floor.prototype.drawBase = function (ctx) { ctx.drawImage(this.base, 0, 0); };
  Floor.prototype.drawAnim = function (ctx, t) {
    for (var i = 0; i < this.animFns.length; i++) this.animFns[i](ctx, t);
    // elevator doors are common to all floors
    var amt = HG.Elevator ? HG.Elevator.doorAmount(this.idx) : 0;
    var here = HG.Elevator ? Math.round(HG.Elevator.carPos()) === this.idx : false;
    P.elevatorDoors(ctx, t, amt, this.accent, here);
  };
  Floor.prototype.drawOverlay = function (ctx, t) {
    for (var i = 0; i < this.overlayFns.length; i++) this.overlayFns[i](ctx, t);
  };

  /* ================= shared shell ================= */

  function shell(f, ctx, opts) {
    var rng = mkRng(31 + f.idx * 113);
    opts = opts || {};
    var wallCol = opts.wall || PAL.wall;

    // wall
    P.R(ctx, 0, 0, W, WALL_Y, HG.shade(wallCol, 0.78));
    // wall paneling
    for (var px = 0; px < W; px += 64) {
      P.R(ctx, px, 4, 62, WALL_Y - 10, wallCol);
      P.R(ctx, px, 4, 62, 2, HG.shade(wallCol, 1.18));
      P.R(ctx, px, WALL_Y - 8, 62, 2, HG.shade(wallCol, 0.7));
      P.R(ctx, px + 61, 4, 1, WALL_Y - 10, HG.shade(wallCol, 0.6));
    }
    // accent stripe
    P.R(ctx, 0, 12, W, 1, P.hexA(f.accent, 0.25));
    // baseboard
    P.R(ctx, 0, WALL_Y - 4, W, 4, PAL.wallLite);
    P.R(ctx, 0, WALL_Y - 1, W, 1, HG.shade(PAL.wallLite, 0.65));

    // floor tiles
    P.R(ctx, 0, WALL_Y, W, H - WALL_Y, opts.floor || PAL.floor);
    var fc = opts.floor || PAL.floor, fa = opts.floorAlt || PAL.floorAlt;
    for (var ty = WALL_Y; ty < H; ty += 16) {
      for (var tx = 0; tx < W; tx += 16) {
        if (((tx + ty) / 16) % 2 === 0) P.R(ctx, tx, ty, 16, 16, fa);
        if (rng() < 0.07) P.R(ctx, tx + 2 + Math.floor(rng() * 10), ty + 3 + Math.floor(rng() * 9), 2, 1, HG.shade(fc, 0.85));
      }
    }
    ctx.fillStyle = PAL.floorLine;
    for (var gy = WALL_Y; gy < H; gy += 16) ctx.fillRect(0, gy, W, 1);
    for (var gx = 0; gx < W; gx += 16) ctx.fillRect(gx, WALL_Y, 1, H - WALL_Y);

    // ceiling lamps + pools
    var lamps = opts.lamps || [90, 230, 380];
    for (var li = 0; li < lamps.length; li++) {
      P.ceilLamp(ctx, lamps[li], 10 + (li % 2) * 3, opts.lampCol);
      P.lightPool(ctx, lamps[li], WALL_Y + 6, 30, opts.poolCol);
    }

    // elevator bay
    P.elevatorBay(ctx, f.accent);

    // floor clutter: cables, paper scraps, scuffs, accent decal stripe
    var rng2 = mkRng(900 + f.idx * 31);
    ctx.fillStyle = PAL.cable;
    for (var cb = 0; cb < 2; cb++) {
      var cx0 = 60 + rng2() * 320, cy0 = 130 + rng2() * 80;
      for (var ci = 0; ci < 40; ci++) {
        ctx.fillRect(cx0, cy0, 3, 2);
        cx0 += (rng2() < 0.7 ? 3 : 0); cy0 += (rng2() < 0.4 ? 2 : -0 + (rng2() < 0.12 ? -2 : 0));
        if (cy0 > 272 || cx0 > 500) break;
      }
    }
    for (var pp2 = 0; pp2 < 7; pp2++) {
      ctx.fillStyle = rng2() < 0.5 ? "#c9cdb8" : "#aeb3a0";
      ctx.fillRect(40 + rng2() * 420, 130 + rng2() * 130, 4, 3);
      if (rng2() < 0.4) {
        ctx.fillStyle = "rgba(0,0,0,0.18)";
        ctx.fillRect(40 + rng2() * 420, 120 + rng2() * 140, 8, 5);
      }
    }
    // hazard / accent decal stripe along the bottom wall side
    for (var dz = 0; dz < 12; dz++) {
      ctx.fillStyle = dz % 2 ? "rgba(0,0,0,0.25)" : P.hexA(f.accent, 0.10);
      ctx.fillRect(20 + dz * 9, H - 22, 6, 3);
    }
    // wall vents
    for (var vn = 0; vn < 2; vn++) {
      var vx = 150 + vn * 220 + (f.idx * 37) % 60;
      ctx.fillStyle = "#10101a";
      ctx.fillRect(vx, WALL_Y - 14, 18, 8);
      ctx.fillStyle = "#22222e";
      for (var vl = 0; vl < 3; vl++) ctx.fillRect(vx + 2, WALL_Y - 12 + vl * 2, 14, 1);
    }

    // standard blocking: walls + canvas edges + elevator shaft sides
    f.block(0, 0, W, WALL_Y + 4);
    f.block(0, 0, 4, H); f.block(W - 4, 0, 4, H);
    f.block(0, H - 4, W, 4);

    // floor name stencil on the ground
    ctx.font = "bold 7px monospace";
    ctx.fillStyle = P.hexA(f.accent, 0.20);
    ctx.fillText("F" + f.idx + " · " + f.name, 8, H - 14);
  }

  /* ================= 0 LOUNGE ================= */

  function buildLounge(f) {
    var ctx = f.base.getContext("2d");
    shell(f, ctx, { wall: "#241b20", floor: "#221c24", floorAlt: "#272029", lamps: [60, 180, 320, 430], lampCol: "#ffd0a0", poolCol: "rgba(255,200,150,0.05)" });

    // rug
    P.dither(ctx, 130, 110, 110, 80, "#2a2238", "#332a44");
    P.outlineRect(ctx, 130, 110, 110, 80, "#241e30");

    // ---- café (left) ----
    P.R(ctx, 14, 24, 84, 38, PAL.woodDark);
    P.outlineRect(ctx, 14, 24, 84, 38);
    P.R(ctx, 17, 30, 78, 3, PAL.wood);
    P.R(ctx, 17, 44, 78, 3, PAL.wood);
    var mugCols = ["#c8553a", "#5a8ac8", "#d8b84a", "#7ac86a", "#c87ab8", "#8a6aD8"];
    for (var m = 0; m < 12; m++) {
      P.R(ctx, 20 + m * 6, 25 + (m % 2 === 0 ? 0 : 14), 4, 4, mugCols[m % mugCols.length]);
    }
    // counter
    P.R(ctx, 12, 62, 92, 16, PAL.wood);
    P.R(ctx, 12, 62, 92, 4, PAL.woodLite);
    P.dither(ctx, 12, 66, 92, 3, PAL.wood, PAL.woodLite);
    P.R(ctx, 12, 74, 92, 4, PAL.woodDark);
    P.outlineRect(ctx, 12, 62, 92, 16);
    // espresso machine
    P.R(ctx, 22, 50, 20, 13, "#3a3a44");
    P.R(ctx, 24, 52, 16, 4, "#52525e");
    P.R(ctx, 28, 50, 4, 2, "#c0392b");
    P.outlineRect(ctx, 22, 50, 20, 13);
    P.R(ctx, 62, 54, 9, 9, "#8a6a3a");
    // stools
    var stoolXs = [24, 52, 80];
    for (var st = 0; st < 3; st++) {
      var sx = stoolXs[st];
      P.R(ctx, sx + 1, 106, 1, 6, PAL.woodDark);
      P.R(ctx, sx + 5, 106, 1, 6, PAL.woodDark);
      P.R(ctx, sx, 101, 8, 5, PAL.wood);
      P.R(ctx, sx, 101, 8, 2, PAL.woodLite);
      P.outlineRect(ctx, sx, 101, 8, 5);
      f.poi("coffee", sx + 4, 98, "up");
    }
    f.block(12, 62, 92, 18);

    // ---- lounge center ----
    // sofa
    var sf = { x: 138, y: 116, w: 70, h: 27 };
    P.R(ctx, sf.x, sf.y, sf.w, sf.h, "#3a3a50");
    P.R(ctx, sf.x + 2, sf.y + 2, sf.w - 4, 9, "#4a4a64");
    P.dither(ctx, sf.x + 2, sf.y + 12, sf.w - 4, 11, "#565678", "#50506e");
    P.R(ctx, sf.x + 24, sf.y + 12, 1, 11, "#44445e");
    P.R(ctx, sf.x + 47, sf.y + 12, 1, 11, "#44445e");
    P.R(ctx, sf.x + 4, sf.y + 5, 9, 8, "#8a3a4a");
    P.R(ctx, sf.x + 57, sf.y + 5, 9, 8, "#3a6a8a");
    P.outlineRect(ctx, sf.x, sf.y, sf.w, sf.h);
    P.ao(ctx, sf.x, sf.y + sf.h, sf.w);
    f.block(sf.x, sf.y, sf.w, sf.h);
    f.poi("sofa", sf.x + 13, sf.y + 23, "down");
    f.poi("sofa", sf.x + 36, sf.y + 23, "down");
    f.poi("sofa", sf.x + 59, sf.y + 23, "down");

    // coffee table
    P.R(ctx, 152, 156, 40, 15, PAL.wood);
    P.R(ctx, 153, 157, 38, 4, PAL.woodLite);
    P.R(ctx, 154, 171, 3, 3, PAL.woodDark);
    P.R(ctx, 187, 171, 3, 3, PAL.woodDark);
    P.outlineRect(ctx, 152, 156, 40, 15);
    P.R(ctx, 164, 159, 5, 3, "#4fd8ff");
    P.R(ctx, 176, 160, 6, 2, "#c9cdb8");
    f.block(152, 156, 40, 18);

    // floor lamp
    P.R(ctx, 222, 112, 2, 28, "#2a2a3a");
    P.R(ctx, 219, 140, 8, 2, "#2a2a3a");
    P.R(ctx, 218, 102, 10, 10, "#e8d8a0");
    P.R(ctx, 218, 110, 10, 2, "#c8b070");
    P.outlineRect(ctx, 218, 102, 10, 10);
    f.block(217, 134, 12, 8);

    // bookshelf on wall
    P.R(ctx, 250, 22, 80, 56, PAL.woodDark);
    P.outlineRect(ctx, 250, 22, 80, 56);
    for (var sh2 = 0; sh2 < 4; sh2++) {
      P.R(ctx, 253, 28 + sh2 * 13, 74, 2, PAL.wood);
      for (var bk = 0; bk < 11; bk++) {
        P.R(ctx, 255 + bk * 6, 30 + sh2 * 13 - 8 + 8, 4, 8, mugCols[(bk + sh2) % mugCols.length]);
      }
    }
    f.poi("inspect", 290, 96, "up");

    // ---- arcade corner (right) ----
    var arcX = [344, 374];
    for (var ar = 0; ar < 2; ar++) {
      var ax = arcX[ar];
      P.R(ctx, ax, 96, 24, 40, ar ? "#203a5a" : "#3a2050");
      P.R(ctx, ax + 1, 97, 22, 4, ar ? "#2c4e76" : "#4c2a68");
      P.R(ctx, ax + 3, 103, 18, 15, "#0e0e16");
      P.R(ctx, ax + 2, 120, 20, 9, ar ? "#16283e" : "#2a163a");
      P.R(ctx, ax + 5, 122, 3, 3, "#ff4f6e");
      P.R(ctx, ax + 13, 122, 3, 3, "#4fd8ff");
      P.outlineRect(ctx, ax, 96, 24, 40);
      P.ao(ctx, ax, 136, 24);
      f.block(ax, 96, 24, 40);
      f.poi("fun", ax + 12, 142, "up");
    }
    // jukebox
    P.R(ctx, 412, 98, 24, 38, "#5a2a3a");
    P.R(ctx, 414, 100, 20, 8, "#ffba3b");
    P.R(ctx, 415, 110, 18, 12, "#2a1620");
    P.R(ctx, 414, 124, 20, 10, "#7a3a50");
    P.outlineRect(ctx, 412, 98, 24, 38);
    f.block(412, 98, 24, 38);
    f.poi("fun", 424, 142, "up");

    // vending
    P.R(ctx, 444, 96, 22, 38, "#23304a");
    P.R(ctx, 446, 98, 18, 22, "#2d3e60");
    var rows2 = ["#c0392b", "#d8b84a", "#4fd8ff", "#52f779"];
    for (var vr = 0; vr < 3; vr++) for (var vc = 0; vc < 4; vc++) {
      P.R(ctx, 448 + vc * 4, 100 + vr * 6, 3, 4, rows2[(vr + vc) % 4]);
    }
    P.R(ctx, 446, 124, 18, 6, "#16203a");
    P.outlineRect(ctx, 444, 96, 22, 38);
    f.block(444, 96, 22, 38);
    f.poi("vending", 455, 140, "up");

    // plants + crates
    P.plant(ctx, 112, 96); f.block(111, 102, 10, 9);
    P.plant(ctx, 240, 250); f.block(239, 256, 10, 9);
    P.crate(ctx, { x: 24, y: 240, w: 20, h: 16 }); f.block(24, 240, 20, 16);
    P.crate(ctx, { x: 48, y: 250, w: 16, h: 12 }); f.block(48, 250, 16, 12);

    // chat spots
    f.poi("chat", 130, 226, "down");
    f.poi("chat", 290, 200, "down");
    f.poi("chat", 396, 230, "down");
    f.poi("chat", 220, 250, "down");

    // animated: signs, string lights, espresso steam, arcade screens, jukebox
    f.animFns.push(function (ctx2, t) {
      var on1 = (Math.sin(t * 13.7) > -0.92 && Math.sin(t * 3.1) > -0.95);
      P.neonSign(ctx2, "CAFE", 30, 6, PAL.neonOrange, true);
      P.neonSign(ctx2, "CHILL", 150, 28, PAL.neonPink, on1);
      P.neonSign(ctx2, "PLAY", 360, 26, PAL.neonBlue, Math.sin(t * 9.3) > -0.97, true);

      var bulbCols = ["#ffd75c", "#ff9c4f", "#fff0c0"];
      for (var bl = 0; bl < 22; bl++) {
        var bx = 120 + bl * 16;
        if (bx > 470) break;
        var by = 16 + Math.round(Math.sin(bl * 0.9) * 3);
        ctx2.fillStyle = Math.sin(t * 2 + bl * 1.7) > -0.6 ? bulbCols[bl % 3] : "#4a4030";
        ctx2.fillRect(bx, by, 2, 2);
      }
      // espresso steam
      var stm = Math.floor(t * 3) % 4;
      if (stm !== 3) {
        ctx2.fillStyle = "rgba(220,228,236,0.5)";
        ctx2.fillRect(29, 44 - stm, 1, 1);
        ctx2.fillRect(33, 42 - ((stm + 1) % 3), 1, 1);
      }
      // arcade attract screens
      for (var ar2 = 0; ar2 < 2; ar2++) {
        var ax2 = [344, 374][ar2] + 3;
        P.R(ctx2, ax2, 103, 18, 15, "#0e0e16");
        ctx2.fillStyle = ar2 ? "#52f779" : "#ff4f6e";
        ctx2.fillRect(ax2 + 2 + Math.floor((Math.sin(t * (2 + ar2)) * 0.5 + 0.5) * 13), 106 + ar2 * 5, 3, 3);
        ctx2.fillStyle = "#4fd8ff";
        ctx2.fillRect(ax2 + 2 + Math.floor((Math.cos(t * 1.3 + ar2) * 0.5 + 0.5) * 13), 112 - ar2 * 3, 2, 2);
      }
      // jukebox glow + notes
      P.R(ctx2, 414, 100, 20, 8, Math.floor(t * 2) % 2 ? "#ffba3b" : "#ff9c4f");
      ctx2.fillStyle = "#ff9ad0";
      var np = (t * 0.7) % 1;
      if (np < 0.8) {
        ctx2.font = "7px monospace";
        ctx2.fillText("♪", 430 + Math.sin(t * 3) * 3, 92 - np * 18);
      }
      // vending glow
      P.R(ctx2, 446, 98, 18, 22, P.hexA("#4fd8ff", 0.06 + 0.04 * Math.sin(t * 2)));
    });
  }

  /* ================= 1 MAINFRAME ================= */

  function buildMainframe(f) {
    var ctx = f.base.getContext("2d");
    shell(f, ctx, { wall: "#15181b", floor: "#1a1e22", floorAlt: "#1f2428", lamps: [80, 240, 400], lampCol: "#c0ffd0", poolCol: "rgba(120,255,160,0.04)" });

    // wall racks (left + mid)
    for (var c = 0; c < 7; c++) P.serverRackWall(ctx, 14 + c * 22, 18, 20, 60);
    for (var c2 = 0; c2 < 5; c2++) P.serverRackWall(ctx, 196 + c2 * 22, 18, 20, 60);

    // reactor core column
    P.R(ctx, 330, 8, 52, 72, "#101418");
    P.outlineRect(ctx, 330, 8, 52, 72, "#05050a");
    P.R(ctx, 334, 12, 44, 64, "#181e24");
    P.R(ctx, 348, 8, 16, 72, "#0c1014");
    f.poi("inspect", 356, 100, "up");

    // coolant pipes right
    for (var pp = 0; pp < 3; pp++) {
      P.R(ctx, 398, 20 + pp * 16, 70, 6, "#2e3a42");
      P.R(ctx, 398, 20 + pp * 16, 70, 2, "#3e4e58");
      P.outlineRect(ctx, 398, 20 + pp * 16, 70, 6, "#0a0e12");
    }
    P.R(ctx, 462, 20, 6, 50, "#2e3a42");

    // recharge pods (floor-standing, left)
    f.pods = [
      { x: 28, y: 96, w: 24, h: 38, color: "#52f779" },
      { x: 64, y: 96, w: 24, h: 38, color: "#39d7e7" },
      { x: 100, y: 96, w: 24, h: 38, color: "#4fd8ff" }
    ];
    for (var pd = 0; pd < 3; pd++) {
      P.pod(ctx, f.pods[pd]);
      f.block(f.pods[pd].x - 1, f.pods[pd].y, f.pods[pd].w + 2, f.pods[pd].h + 5);
      f.poi("pod", f.pods[pd].x + f.pods[pd].w / 2, f.pods[pd].y + f.pods[pd].h + 8, "up");
    }

    // floor server rows
    var rows = [{ x: 170, y: 130 }, { x: 170, y: 196 }];
    for (var r = 0; r < rows.length; r++) {
      for (var u = 0; u < 3; u++) {
        var rx = rows[r].x + u * 44, ry = rows[r].y;
        P.serverRackWall(ctx, rx, ry, 38, 44);
        P.ao(ctx, rx, ry + 44, 38);
        f.block(rx, ry, 38, 46);
      }
      f.poi("inspect", rows[r].x + 19, rows[r].y + 56, "up");
      f.poi("inspect", rows[r].x + 107, rows[r].y + 56, "up");
    }

    // kiosk terminal
    P.R(ctx, 420, 150, 26, 20, "#22262e");
    P.R(ctx, 422, 144, 22, 8, "#101018");
    P.outlineRect(ctx, 420, 144, 26, 26, "#05050a");
    f.block(420, 144, 26, 28);
    f.poi("terminal", 433, 178, "up");

    // cables on floor
    ctx.fillStyle = PAL.cable;
    var rng = mkRng(77);
    var cx3 = 140, cy3 = 100;
    for (var i = 0; i < 70; i++) {
      ctx.fillRect(cx3, cy3, 3, 2);
      cx3 += (rng() < 0.7 ? 3 : 0); cy3 += (rng() < 0.45 ? 2 : 0);
      if (cy3 > 268 || cx3 > 500) break;
    }

    f.poi("chat", 250, 250, "down");
    f.poi("chat", 90, 200, "down");
    f.poi("chat", 380, 230, "down");

    // animated: rack LEDs, reactor pulse, steam vents, kiosk screen
    f.animFns.push(function (ctx2, t) {
      P.neonSign(ctx2, "MAINFRAME", 196, 2, PAL.neonGreen, true, true);
      for (var c = 0; c < 7; c++) P.rackLEDs(ctx2, 14 + c * 22, 18, 20, 60, t, PAL.termCyan);
      for (var c2 = 0; c2 < 5; c2++) P.rackLEDs(ctx2, 196 + c2 * 22, 18, 20, 60, t, PAL.termAmber);
      for (var r = 0; r < 2; r++) for (var u = 0; u < 3; u++) {
        P.rackLEDs(ctx2, 170 + u * 44, [130, 196][r], 38, 44, t * 0.8 + r, PAL.termGreen);
      }
      // reactor: rising energy bands
      for (var b = 0; b < 6; b++) {
        var ph = ((t * 0.5 + b / 6) % 1);
        var by = 72 - ph * 58;
        ctx2.fillStyle = P.hexA("#52f779", (1 - ph) * 0.5);
        ctx2.fillRect(336, Math.round(by), 40, 2);
      }
      ctx2.fillStyle = P.hexA("#52f779", 0.25 + 0.12 * Math.sin(t * 3));
      ctx2.fillRect(348, 8, 16, 72);
      ctx2.fillStyle = "rgba(82,247,121," + (0.06 + 0.04 * Math.sin(t * 3)) + ")";
      ctx2.fillRect(322, 80, 68, 10);
      // steam vents
      var sv = Math.floor(t * 4) % 5;
      if (sv < 3) {
        ctx2.fillStyle = "rgba(200,220,230,0.4)";
        ctx2.fillRect(404 + sv * 2, 16 - sv, 2, 2);
        ctx2.fillRect(440 - sv, 30 - sv, 2, 2);
      }
      // kiosk screen
      P.codeScreen(ctx2, 424, 146, 18, 5, t, 42, PAL.termGreen, true);
    });

    f.overlayFns.push(function (ctx2, t) {
      var occ = HG.Agents ? HG.Agents.podOccupancy() : [false, false, false];
      for (var i = 0; i < f.pods.length; i++) P.podGlass(ctx2, f.pods[i], t, occ[i], i);
    });
  }

  /* ================= 2 SECURITY ================= */

  function buildSecurity(f) {
    var ctx = f.base.getContext("2d");
    shell(f, ctx, { wall: "#1d1716", floor: "#221d1c", floorAlt: "#272120", lamps: [100, 260, 410], lampCol: "#ffc8a0", poolCol: "rgba(255,180,120,0.04)" });

    // camera monitor wall (3x3)
    P.R(ctx, 14, 14, 118, 64, "#101018");
    P.outlineRect(ctx, 14, 14, 118, 64, "#05050a");
    f.poi("watch", 45, 96, "up");
    f.poi("watch", 100, 96, "up");

    // radar console
    P.R(ctx, 160, 112, 74, 40, "#262a32");
    P.R(ctx, 162, 114, 70, 4, "#343a46");
    P.outlineRect(ctx, 160, 112, 74, 40, "#05050a");
    P.R(ctx, 168, 120, 58, 26, "#0a1410");        // radar screen bed (sweep in anim)
    P.ao(ctx, 160, 152, 74);
    f.block(158, 110, 78, 44);
    f.poi("watch", 197, 162, "up");

    // vault door
    P.R(ctx, 330, 14, 70, 64, "#2e2a26");
    P.outlineRect(ctx, 330, 14, 70, 64, "#05050a");
    P.R(ctx, 340, 20, 50, 52, "#3e3832");
    P.R(ctx, 342, 22, 46, 48, "#4a4239");
    // wheel
    P.R(ctx, 358, 38, 14, 14, "#5e564a");
    P.R(ctx, 362, 34, 6, 22, "#5e564a");
    P.R(ctx, 354, 42, 22, 6, "#5e564a");
    P.R(ctx, 362, 42, 6, 6, "#766b5a");
    // warning stripes under vault
    for (var w2 = 0; w2 < 9; w2++) {
      P.R(ctx, 332 + w2 * 8, 82, 5, 3, w2 % 2 ? "#3a3a1e" : "#8a7a2e");
    }
    f.poi("inspect", 364, 100, "up");

    // lockers
    for (var lk = 0; lk < 3; lk++) {
      P.R(ctx, 416 + lk * 18, 22, 16, 56, "#2a323c");
      P.R(ctx, 416 + lk * 18, 22, 16, 3, "#39434e");
      P.R(ctx, 422 + lk * 18, 44, 3, 6, "#1a2026");
      P.outlineRect(ctx, 416 + lk * 18, 22, 16, 56, "#05050a");
    }

    // security console desks (2, with seats)
    var cons = [{ x: 60, y: 170 }, { x: 270, y: 190 }];
    for (var cn = 0; cn < cons.length; cn++) {
      var c = cons[cn];
      P.R(ctx, c.x, c.y, 56, 14, "#2a2e36");
      P.R(ctx, c.x, c.y, 56, 3, "#3a404c");
      P.outlineRect(ctx, c.x, c.y, 56, 14, "#05050a");
      P.R(ctx, c.x + 6, c.y - 12, 18, 11, "#101018");
      P.R(ctx, c.x + 30, c.y - 12, 18, 11, "#101018");
      P.outlineRect(ctx, c.x + 6, c.y - 12, 18, 11, "#05050a");
      P.outlineRect(ctx, c.x + 30, c.y - 12, 18, 11, "#05050a");
      P.ao(ctx, c.x, c.y + 14, 56);
      f.block(c.x - 1, c.y - 13, 58, 30);
      f.poi("console", c.x + 28, c.y + 24, "up");
    }
    f.consoles = cons;

    // patrol waypoints + chat
    f.poi("patrol", 140, 240, "right");
    f.poi("patrol", 300, 130, "left");
    f.poi("patrol", 430, 160, "up");
    f.poi("patrol", 240, 260, "down");
    f.poi("chat", 360, 240, "down");
    f.poi("chat", 100, 130, "down");

    // animated: camera feeds, radar sweep, alarm strip, console screens
    f.animFns.push(function (ctx2, t) {
      P.neonSign(ctx2, "SECURITY", 226, 2, PAL.neonRed, Math.sin(t * 7.7) > -0.96, true);
      // 3x3 camera feeds
      for (var cy = 0; cy < 3; cy++) {
        for (var cx = 0; cx < 3; cx++) {
          var mx = 18 + cx * 39, my = 18 + cy * 20;
          var sd = f.seeds[cy * 3 + cx];
          P.R(ctx2, mx, my, 35, 16, "#0c1210");
          // static noise band + moving blip per feed
          var nz = Math.floor(t * (6 + cx) + sd) % 14;
          ctx2.fillStyle = "rgba(140,180,160,0.18)";
          ctx2.fillRect(mx, my + nz, 35, 1);
          ctx2.fillStyle = (cy === 1 && cx === 1) ? "#ff5c7a" : "#7ad7a0";
          ctx2.fillRect(mx + 3 + Math.floor((Math.sin(t * 0.6 + sd) * 0.5 + 0.5) * 28), my + 4 + (cy * 3 + cx) % 8, 2, 3);
          ctx2.fillStyle = "rgba(122,215,160,0.10)";
          ctx2.fillRect(mx, my, 35, 16);
        }
      }
      // radar sweep
      var rx0 = 197, ry0 = 133;
      P.R(ctx2, 168, 120, 58, 26, "#0a1410");
      ctx2.fillStyle = "rgba(82,247,121,0.18)";
      ctx2.fillRect(168, 126, 58, 1); ctx2.fillRect(168, 138, 58, 1);
      ctx2.fillRect(182, 120, 1, 26); ctx2.fillRect(211, 120, 1, 26);
      var ang = t * 1.6;
      for (var rr = 0; rr < 26; rr++) {
        var px2 = rx0 + Math.cos(ang) * rr, py2 = ry0 + Math.sin(ang) * rr * 0.45;
        if (px2 < 169 || px2 > 225 || py2 < 121 || py2 > 145) break;
        ctx2.fillStyle = "rgba(82,247,121," + (0.6 - rr * 0.02) + ")";
        ctx2.fillRect(Math.round(px2), Math.round(py2), 1, 1);
      }
      if (Math.floor(t * 0.8) % 4 === 0) { ctx2.fillStyle = "#ff5c7a"; ctx2.fillRect(rx0 + 14, ry0 - 6, 2, 2); }
      // console screens
      P.codeScreen(ctx2, 68, 160, 14, 7, t, f.seeds[10], PAL.termAmber, true);
      P.codeScreen(ctx2, 92, 160, 14, 7, t, f.seeds[11], PAL.termGreen, true);
      P.codeScreen(ctx2, 278, 180, 14, 7, t, f.seeds[12], PAL.termAmber, true);
      P.codeScreen(ctx2, 302, 180, 14, 7, t, f.seeds[13], PAL.termCyan, true);
      // vault keypad blink
      ctx2.fillStyle = Math.floor(t * 2) % 2 ? "#ff5c7a" : "#5a2a2a";
      ctx2.fillRect(394, 44, 3, 3);
    });
  }

  /* ================= 3 LAB ================= */

  function buildLab(f) {
    var ctx = f.base.getContext("2d");
    shell(f, ctx, { wall: "#161b20", floor: "#1c2126", floorAlt: "#21262c", lamps: [90, 250, 400], lampCol: "#c0e8ff", poolCol: "rgba(140,210,255,0.045)" });

    // pegboard + workbench (left)
    P.R(ctx, 14, 20, 96, 40, "#2a2e26");
    P.outlineRect(ctx, 14, 20, 96, 40, "#05050a");
    var tools = ["#8a93a5", "#c8b878", "#8a93a5", "#ff9c4f", "#8a93a5"];
    for (var tl = 0; tl < 8; tl++) {
      P.R(ctx, 20 + tl * 11, 26 + (tl % 2) * 12, 3, 9, tools[tl % tools.length]);
    }
    P.R(ctx, 12, 60, 100, 18, "#3a4048");
    P.R(ctx, 12, 60, 100, 4, "#4a525c");
    P.outlineRect(ctx, 12, 60, 100, 18, "#05050a");
    // bench clutter
    P.R(ctx, 20, 64, 10, 5, "#8a93a5");
    P.R(ctx, 44, 63, 8, 6, "#2a4a3a");
    P.R(ctx, 70, 64, 12, 4, "#c8b878");
    f.block(12, 60, 100, 20);
    f.poi("tinker", 34, 96, "up");
    f.poi("tinker", 84, 96, "up");

    // parts shelf bins
    P.R(ctx, 124, 22, 90, 56, "#222830");
    P.outlineRect(ctx, 124, 22, 90, 56, "#05050a");
    for (var by2 = 0; by2 < 3; by2++) for (var bx2 = 0; bx2 < 5; bx2++) {
      P.R(ctx, 128 + bx2 * 17, 26 + by2 * 17, 14, 13, by2 % 2 ? "#31404c" : "#3c4854");
      P.R(ctx, 128 + bx2 * 17, 26 + by2 * 17, 14, 2, "#4a5a68");
    }

    // whiteboard
    P.R(ctx, 228, 24, 86, 48, "#d8dce2");
    P.outlineRect(ctx, 228, 24, 86, 48, "#05050a");
    ctx.fillStyle = "#4a6a9a";
    ctx.fillRect(234, 32, 30, 1); ctx.fillRect(234, 38, 44, 1); ctx.fillRect(234, 44, 22, 1);
    ctx.fillStyle = "#c0506a";
    ctx.fillRect(270, 30, 14, 10);
    ctx.fillStyle = "#3a8a5a";
    ctx.fillRect(234, 54, 50, 1); ctx.fillRect(234, 60, 36, 1);
    f.poi("watch", 270, 96, "up");

    // holo table (center)
    P.R(ctx, 218, 160, 64, 22, "#262c36");
    P.R(ctx, 220, 162, 60, 4, "#39424e");
    P.R(ctx, 222, 180, 8, 4, "#1c222a");
    P.R(ctx, 270, 180, 8, 4, "#1c222a");
    P.outlineRect(ctx, 218, 160, 64, 22, "#05050a");
    P.ao(ctx, 218, 184, 64);
    f.block(216, 158, 68, 28);
    f.poi("watch", 204, 178, "right");
    f.poi("watch", 296, 178, "left");

    // 3D printer
    P.R(ctx, 130, 120, 30, 30, "#2e3640");
    P.R(ctx, 132, 122, 26, 5, "#3c4754");
    P.R(ctx, 134, 130, 22, 16, "#10161c");
    P.outlineRect(ctx, 130, 120, 30, 30, "#05050a");
    f.block(130, 120, 30, 32);
    f.poi("watch", 145, 158, "up");

    // robot assembly bay (right)
    P.R(ctx, 350, 110, 84, 40, "#21262e");
    P.outlineRect(ctx, 350, 110, 84, 40, "#05050a");
    P.R(ctx, 354, 114, 76, 32, "#2a3038");
    // half-built robot
    P.R(ctx, 382, 116, 16, 18, "#8a93a5");
    P.R(ctx, 384, 110, 12, 8, "#b8c0cf");
    P.R(ctx, 386, 112, 3, 2, "#39d7e7");
    P.R(ctx, 380, 120, 2, 10, "#5e6675");
    P.R(ctx, 398, 122, 4, 6, "#5e6675");
    // overhead gantry
    P.R(ctx, 348, 0, 4, 14, "#1c222a");
    P.R(ctx, 430, 0, 4, 14, "#1c222a");
    P.R(ctx, 348, 12, 86, 4, "#2a323c");
    f.block(350, 110, 84, 42);
    f.poi("inspect", 392, 162, "up");

    // crates
    P.crate(ctx, { x: 452, y: 120, w: 18, h: 14 }); f.block(452, 120, 18, 14);
    P.crate(ctx, { x: 30, y: 240, w: 20, h: 16 }); f.block(30, 240, 20, 16);

    f.poi("chat", 150, 230, "down");
    f.poi("chat", 350, 230, "down");
    f.poi("chat", 250, 260, "down");

    // animated: hologram, printer, gantry arm, sparks
    f.animFns.push(function (ctx2, t) {
      P.neonSign(ctx2, "LAB·R&D", 330, 2, PAL.neonBlue, true, true);
      // hologram: rotating wireframe pyramid above the table
      var hx = 250, hy = 138;
      ctx2.fillStyle = "rgba(57,215,231,0.10)";
      ctx2.fillRect(hx - 16, hy - 14, 32, 30);
      var a = t * 1.2;
      var pts = [];
      for (var i = 0; i < 4; i++) {
        var aa = a + i * Math.PI / 2;
        pts.push([hx + Math.round(Math.cos(aa) * 13), hy + 8 + Math.round(Math.sin(aa) * 5)]);
      }
      ctx2.fillStyle = "#39d7e7";
      for (var p2 = 0; p2 < 4; p2++) {
        var A = pts[p2], B = pts[(p2 + 1) % 4];
        var steps = 8;
        for (var s2 = 0; s2 <= steps; s2++) {
          ctx2.globalAlpha = 0.5;
          ctx2.fillRect(Math.round(A[0] + (B[0] - A[0]) * s2 / steps), Math.round(A[1] + (B[1] - A[1]) * s2 / steps), 1, 1);
          // edge to apex
          if (s2 === 0) {
            for (var s3 = 0; s3 <= 6; s3++) {
              ctx2.fillRect(Math.round(A[0] + (hx - A[0]) * s3 / 6), Math.round(A[1] + (hy - 10 - A[1]) * s3 / 6), 1, 1);
            }
          }
        }
      }
      ctx2.globalAlpha = 1;
      ctx2.fillStyle = "#aff5ff";
      ctx2.fillRect(hx, hy - 11, 1, 1);
      // scan beam on table
      ctx2.fillStyle = "rgba(57,215,231," + (0.20 + 0.1 * Math.sin(t * 5)) + ")";
      ctx2.fillRect(222, 163, 56, 1);

      // 3D printer: head sweeps, progress layer grows
      var prog = (t * 0.07) % 1;
      ctx2.fillStyle = "#39d7e7";
      ctx2.fillRect(136 + Math.floor((Math.sin(t * 4) * 0.5 + 0.5) * 18), 131, 3, 2, "#39d7e7");
      ctx2.fillStyle = "#7adcb0";
      var ph2 = Math.floor(prog * 12);
      ctx2.fillRect(138, 145 - ph2, 14, ph2 + 1);

      // gantry arm slides + welding sparks on the robot
      var gx = 360 + Math.floor((Math.sin(t * 0.7) * 0.5 + 0.5) * 60);
      ctx2.fillStyle = "#3c4754";
      ctx2.fillRect(gx, 14, 6, 4);
      ctx2.fillRect(gx + 2, 18, 2, 12);
      ctx2.fillStyle = "#8a93a5";
      ctx2.fillRect(gx + 1, 30, 4, 3);
      if (Math.floor(t * 7) % 5 === 0) {
        ctx2.fillStyle = ["#fff0a0", "#ffd75c", "#fffefa"][Math.floor(t * 3) % 3];
        ctx2.fillRect(gx + 1 + Math.floor(Math.sin(t * 31) * 2), 34, 1, 1);
        ctx2.fillRect(gx + 3, 36 + Math.floor(Math.cos(t * 23) * 2), 1, 1);
      }
    });
  }

  /* ================= 4 OPS ================= */

  function buildOps(f) {
    var ctx = f.base.getContext("2d");
    shell(f, ctx, { wall: "#1b1b29", lamps: [80, 250, 420], lampCol: "#e8e0c0" });

    // window with city
    var rng = mkRng(55);
    P.R(ctx, 186, 6, 140, 60, "#0c0c16");
    P.R(ctx, 188, 8, 136, 56, "#120e24");
    ctx.fillStyle = PAL.cityFar;
    var fx = 188;
    while (fx < 320) {
      var fw = 8 + Math.floor(rng() * 10), fh = 18 + Math.floor(rng() * 28);
      ctx.fillRect(fx, 64 - fh, fw, fh);
      fx += fw + 2;
    }
    ctx.fillStyle = PAL.cityNear;
    fx = 192;
    while (fx < 318) {
      var nw = 10 + Math.floor(rng() * 8), nh = 10 + Math.floor(rng() * 20);
      ctx.fillRect(fx, 64 - nh, nw, nh);
      fx += nw + 4;
    }
    var wcols = ["#ffd75c", "#ff4fd8", "#4fd8ff", "#52f779"];
    for (var lw = 0; lw < 52; lw++) {
      ctx.fillStyle = wcols[Math.floor(rng() * 4)];
      ctx.fillRect(190 + Math.floor(rng() * 132), 18 + Math.floor(rng() * 44), 1, 1);
    }
    P.R(ctx, 186, 34, 140, 2, "#2a2a3c");
    P.R(ctx, 255, 6, 2, 60, "#2a2a3c");
    P.outlineRect(ctx, 186, 6, 140, 60, "#3a3a50");
    f.poi("watch", 256, 94, "up");

    // wall monitors (left)
    P.R(ctx, 16, 16, 38, 28, "#0e0e16"); P.outlineRect(ctx, 16, 16, 38, 28, "#2a2a38");
    P.R(ctx, 62, 20, 30, 24, "#0e0e16"); P.outlineRect(ctx, 62, 20, 30, 24, "#2a2a38");
    P.R(ctx, 100, 16, 34, 20, "#0e0e16"); P.outlineRect(ctx, 100, 16, 34, 20, "#2a2a38");
    // status board (right)
    P.R(ctx, 350, 18, 110, 52, "#10141c");
    P.outlineRect(ctx, 350, 18, 110, 52, "#05050a");

    // walkway
    P.R(ctx, 246, WALL_Y, 16, H - WALL_Y, PAL.walkway);
    P.R(ctx, 246, WALL_Y, 1, H - WALL_Y, HG.shade(PAL.walkway, 0.8));
    P.R(ctx, 261, WALL_Y, 1, H - WALL_Y, HG.shade(PAL.walkway, 0.8));
    for (var hy = WALL_Y + 2; hy < H; hy += 22) {
      P.R(ctx, 248, hy, 4, 2, "#3a3a1e");
      P.R(ctx, 256, hy + 8, 4, 2, "#3a3a1e");
    }

    // desks
    f.desks = [];
    var cols = [200, 268, 336, 404];
    var rowsY = [148, 202, 256];
    for (var r = 0; r < 3; r++) {
      for (var c = 0; c < 4; c++) {
        var d = {
          x: cols[c], y: rowsY[r], w: 36, h: 14,
          seat: { x: cols[c] + 18, y: rowsY[r] + 24 },
          screen: { x: cols[c] + 11, y: rowsY[r] - 12, w: 14, h: 9 },
          active: false
        };
        f.desks.push(d);
        P.desk(ctx, d);
        f.block(d.x - 1, d.y - 2, d.w + 2, d.h + 5);
      }
    }

    // water cooler
    P.R(ctx, 30, 100, 12, 22, "#3a4250");
    P.R(ctx, 32, 96, 8, 8, "#6ab8d8");
    P.R(ctx, 33, 97, 3, 3, "#9adcf2");
    P.outlineRect(ctx, 30, 96, 12, 26, "#05050a");
    f.block(30, 96, 12, 28);
    f.poi("vending", 36, 130, "up");

    // plants
    P.plant(ctx, 96, 92); f.block(95, 98, 10, 9);
    P.plant(ctx, 452, 84); f.block(451, 90, 10, 9);
    P.plant(ctx, 24, 250); f.block(23, 256, 10, 9);

    f.poi("chat", 80, 180, "down");
    f.poi("chat", 120, 240, "down");
    f.poi("chat", 150, 130, "down");

    // animated: wall screens, status board, window life, desk monitors
    f.animFns.push(function (ctx2, t) {
      P.neonSign(ctx2, "CLAUDE OPS", 396, 2, PAL.neonYellow, true, true);
      P.codeScreen(ctx2, 16, 16, 38, 28, t, f.seeds[0], PAL.termGreen, true);
      P.codeScreen(ctx2, 62, 20, 30, 24, t * 0.8, f.seeds[1], PAL.termAmber, true);
      P.codeScreen(ctx2, 100, 16, 34, 20, t * 1.1, f.seeds[2], PAL.termCyan, true);
      // status board: agent grid
      var list = HG.Agents ? HG.Agents.list : [];
      for (var i = 0; i < Math.min(12, list.length); i++) {
        var bx = 356 + (i % 4) * 26, by = 24 + Math.floor(i / 4) * 14;
        var st = list[i].mode;
        var col = st === "working" ? "#ffd75c" : st === "error" ? "#ff5c7a" : "#39e75f";
        ctx2.fillStyle = "#1a202c";
        ctx2.fillRect(bx, by, 22, 10);
        ctx2.fillStyle = col;
        ctx2.fillRect(bx + 2, by + 2, 3, 3);
        if (st === "working" && Math.floor(t * 3) % 2) ctx2.fillRect(bx + 2, by + 6, 14, 1);
        ctx2.fillStyle = "rgba(160,180,210,0.5)";
        ctx2.fillRect(bx + 7, by + 3, 12, 1);
      }
      // window: twinkles + flying car
      for (var tw = 0; tw < 7; tw++) {
        if (Math.sin(t * 3 + tw * 2.4) > 0.3) {
          ctx2.fillStyle = ["#ffd75c", "#ff4fd8", "#4fd8ff"][tw % 3];
          ctx2.fillRect(190 + ((tw * 53 + Math.floor(t * 2) * 7) % 132), 16 + (tw * 17) % 46, 1, 1);
        }
      }
      var carP = (t % 8) / 8;
      if (carP < 0.5) {
        ctx2.fillStyle = "#ff6a6a";
        ctx2.fillRect(188 + carP * 2 * 136, 18 + Math.sin(carP * 12) * 2, 3, 1);
        ctx2.fillStyle = "rgba(255,106,106,0.4)";
        ctx2.fillRect(185 + carP * 2 * 136, 18 + Math.sin(carP * 12) * 2, 3, 1);
      }
      // desk monitors
      for (var dd = 0; dd < f.desks.length; dd++) {
        var d2 = f.desks[dd];
        P.codeScreen(ctx2, d2.screen.x, d2.screen.y, d2.screen.w, d2.screen.h, t, f.seeds[4 + dd], PAL.termGreen, d2.active);
      }
      // dust motes
      for (var dm = 0; dm < 8; dm++) {
        ctx2.fillStyle = "rgba(180,190,220,0.10)";
        ctx2.fillRect((dm * 53 + Math.floor(t * (3 + dm % 4))) % W, 90 + ((dm * 37 + Math.floor(t * 2)) % 160), 1, 1);
      }
    });
  }

  /* ================= registry ================= */

  var floors = [];

  HG.Floors = {
    WALL_Y: WALL_Y,
    count: 5,
    NAMES: ["LOUNGE", "MAINFRAME", "SECURITY", "LAB", "OPS"],
    ACCENTS: ["#ff4fd8", "#52f779", "#ff9c4f", "#39d7e7", "#ffd75c"],
    OPS: 4, MAINFRAME: 1,

    list: floors,

    init: function () {
      floors.length = 0;
      P = HG.Props;
      var builders = [buildLounge, buildMainframe, buildSecurity, buildLab, buildOps];
      for (var i = 0; i < 5; i++) {
        var fl = new Floor(i, this.NAMES[i], this.ACCENTS[i]);
        builders[i](fl);
        floors.push(fl);
      }
    },

    get: function (i) { return floors[i]; },

    isBlocked: function (floorIdx, cx, cy) {
      return floors[floorIdx].isBlocked(cx, cy);
    },

    allPois: function () {
      var out = [];
      for (var i = 0; i < floors.length; i++) out = out.concat(floors[i].pois);
      return out;
    },

    get desks() { return floors[4].desks; },
    get pods() { return floors[1].pods; }
  };
})(window.HG);
