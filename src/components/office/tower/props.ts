// @ts-nocheck
/* CLAUDE Agent Floor — prop library + art helpers shared by all floors */
window.HG = window.HG || {};

(function (HG) {
  "use strict";

  var PAL = HG.PAL;
  var shade = null; // bound at first use (sprites.js defines HG.shade)

  function S(hex, f) { if (!shade) shade = HG.shade; return shade(hex, f); }

  function R(ctx, x, y, w, h, col) { ctx.fillStyle = col; ctx.fillRect(x, y, w, h); }

  // chunky outline box
  function outlineRect(ctx, x, y, w, h, col) {
    ctx.fillStyle = col || "#0c0c14";
    ctx.fillRect(x - 1, y - 1, w + 2, 1);
    ctx.fillRect(x - 1, y + h, w + 2, 1);
    ctx.fillRect(x - 1, y, 1, h);
    ctx.fillRect(x + w, y, 1, h);
  }

  // checkerboard dither blend between two colors
  function dither(ctx, x, y, w, h, c1, c2) {
    R(ctx, x, y, w, h, c1);
    ctx.fillStyle = c2;
    for (var yy = 0; yy < h; yy++) {
      for (var xx = (yy % 2); xx < w; xx += 2) {
        ctx.fillRect(x + xx, y + yy, 1, 1);
      }
    }
  }

  // soft ambient-occlusion strip under furniture
  function ao(ctx, x, y, w) {
    R(ctx, x, y, w, 2, "rgba(0,0,0,0.30)");
  }

  // stepped pool of light on the floor under a ceiling lamp
  function lightPool(ctx, cx, y, rad, col) {
    ctx.fillStyle = col || "rgba(220,230,255,0.045)";
    ctx.fillRect(cx - rad, y, rad * 2, 26);
    ctx.fillRect(cx - rad - 6, y + 4, rad * 2 + 12, 18);
    ctx.fillStyle = col || "rgba(220,230,255,0.035)";
    ctx.fillRect(cx - rad + 4, y + 2, rad * 2 - 8, 22);
  }

  // hanging ceiling lamp (paired with lightPool below it)
  function ceilLamp(ctx, cx, drop, col) {
    R(ctx, cx, 0, 1, drop, "#101018");
    R(ctx, cx - 4, drop, 9, 3, "#22222e");
    R(ctx, cx - 3, drop + 3, 7, 1, col || "#e8e0c0");
  }

  function hexA(hex, a) {
    var r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
    return "rgba(" + r + "," + g + "," + b + "," + a.toFixed(2) + ")";
  }

  /* ------------ signage ------------ */

  function signFrame(ctx, x, y, w, h) {
    R(ctx, x, y, w, h, "#0c0c14");
    outlineRect(ctx, x, y, w, h, "#2e2e40");
  }

  function neonText(ctx, text, x, y, color, on) {
    ctx.font = "bold 9px monospace";
    ctx.textBaseline = "top";
    if (on) {
      ctx.fillStyle = color;
      ctx.fillText(text, x, y);
      ctx.globalAlpha = 0.30;
      ctx.fillText(text, x + 1, y);
      ctx.fillText(text, x, y + 1);
      ctx.globalAlpha = 1;
    } else {
      ctx.fillStyle = "rgba(120,120,140,0.4)";
      ctx.fillText(text, x, y);
    }
  }

  function neonSign(ctx, text, x, y, color, on, small) {
    ctx.font = (small ? "bold 7px" : "bold 9px") + " monospace";
    var w = ctx.measureText(text).width + 10;
    var h = small ? 12 : 16;
    signFrame(ctx, x, y, w, h);
    ctx.font = (small ? "bold 7px" : "bold 9px") + " monospace";
    ctx.textBaseline = "top";
    if (on) {
      ctx.fillStyle = hexA(color, 0.18);
      ctx.fillRect(x - 2, y - 2, w + 4, h + 4);
      ctx.fillStyle = color;
      ctx.fillText(text, x + 5, y + (small ? 3 : 4));
    } else {
      ctx.fillStyle = "rgba(120,120,140,0.4)";
      ctx.fillText(text, x + 5, y + (small ? 3 : 4));
    }
    return w;
  }

  /* ------------ screens ------------ */

  function codeScreen(ctx, x, y, w, h, t, seed, color, active) {
    R(ctx, x, y, w, h, active ? "#0a1410" : "#0a0a10");
    if (!active) {
      if (Math.floor(t * 1.5 + seed) % 3 === 0) {
        R(ctx, x + 1, y + 1, 3, 1, "rgba(57,231,95,0.25)");
      }
      return;
    }
    ctx.fillStyle = hexA("#39e75f", 0.10 + 0.05 * Math.sin(t * 4 + seed));
    ctx.fillRect(x - 2, y - 2, w + 4, h + 4);
    R(ctx, x, y, w, h, "#0a1410");
    var lines = Math.floor(h / 2);
    var scroll = Math.floor(t * 6 + seed);
    for (var l = 0; l < lines; l++) {
      var n = (scroll + l) * 2654435761 % 97;
      var lw = 2 + (n % Math.max(2, w - 4));
      ctx.fillStyle = (n % 11 === 0) ? "#ffba3b" : color;
      ctx.globalAlpha = 0.5 + (n % 5) * 0.1;
      ctx.fillRect(x + 1, y + 1 + l * 2, Math.min(lw, w - 2), 1);
    }
    ctx.globalAlpha = 1;
  }

  /* ------------ furniture ------------ */

  function desk(ctx, d) {
    // chair
    R(ctx, d.seat.x - 6, d.seat.y - 9, 12, 8, "#262634");
    R(ctx, d.seat.x - 6, d.seat.y - 10, 12, 2, "#34344a");
    outlineRect(ctx, d.seat.x - 6, d.seat.y - 10, 12, 9);
    // desk top
    R(ctx, d.x, d.y, d.w, d.h, PAL.wood);
    R(ctx, d.x, d.y, d.w, 4, PAL.woodLite);
    dither(ctx, d.x, d.y + 4, d.w, 2, PAL.wood, PAL.woodLite);
    R(ctx, d.x, d.y + d.h - 3, d.w, 3, PAL.woodDark);
    R(ctx, d.x + 1, d.y + d.h, 3, 4, PAL.woodDark);
    R(ctx, d.x + d.w - 4, d.y + d.h, 3, 4, PAL.woodDark);
    outlineRect(ctx, d.x, d.y, d.w, d.h);
    ao(ctx, d.x + 1, d.y + d.h + 3, d.w - 2);
    // monitor
    var s = d.screen;
    R(ctx, s.x - 2, s.y - 2, s.w + 4, s.h + 4, "#101018");
    outlineRect(ctx, s.x - 2, s.y - 2, s.w + 4, s.h + 4, "#05050a");
    R(ctx, s.x + s.w / 2 - 2, s.y + s.h + 2, 4, 2, "#1e1e2c");
    // keyboard + clutter
    R(ctx, d.x + 10, d.y + 6, 16, 4, "#22222e");
    R(ctx, d.x + 11, d.y + 7, 14, 2, "#3a3a4c");
    R(ctx, d.x + 4, d.y + 5, 4, 4, "#8a6a3a");
    R(ctx, d.x + d.w - 8, d.y + 6, 4, 2, "#3a4a5e");
  }

  function serverRackWall(ctx, x, y, w, h) {
    R(ctx, x, y, w, h, "#10101a");
    outlineRect(ctx, x, y, w, h, "#05050a");
    R(ctx, x, y, 2, h, "#1c1c2a");
    for (var u = y + 4; u < y + h - 4; u += 8) {
      R(ctx, x + 3, u, w - 6, 6, "#1c1c2c");
      R(ctx, x + 3, u + 5, w - 6, 1, "#0c0c14");
      R(ctx, x + 4, u + 1, 3, 1, "#2a2a3c");
    }
  }

  function rackLEDs(ctx, x, y, w, h, t, hue) {
    for (var u = 0; u < Math.floor((h - 8) / 8); u++) {
      var uy = y + 6 + u * 8;
      for (var led = 0; led < Math.floor((w - 10) / 7); led++) {
        var on = Math.sin(t * (2.2 + led) + u * 1.7 + x) > 0.1;
        ctx.fillStyle = on ? (u % 4 === 0 ? hue : PAL.termGreen) : "#16201a";
        ctx.fillRect(x + 6 + led * 7, uy, 2, 2);
      }
    }
  }

  function pod(ctx, p) {
    R(ctx, p.x - 2, p.y + p.h, p.w + 4, 5, "#2a2a38");
    R(ctx, p.x - 2, p.y + p.h, p.w + 4, 2, "#383848");
    R(ctx, p.x, p.y, p.w, p.h, "#30303f");
    R(ctx, p.x + 1, p.y + 1, p.w - 2, 2, "#3c3c4e");
    R(ctx, p.x + 3, p.y + 5, p.w - 6, p.h - 9, PAL.glassDark);
    R(ctx, p.x + p.w / 2 - 2, p.y + 1, 4, 1, p.color);
    R(ctx, p.x + p.w / 2 - 1, 0, 2, p.y, PAL.cable);
    outlineRect(ctx, p.x, p.y, p.w, p.h, "#05050a");
    ao(ctx, p.x - 1, p.y + p.h + 4, p.w + 2);
  }

  function podGlass(ctx, p, t, occupied, idx) {
    var glow = occupied ? (0.34 + 0.12 * Math.sin(t * 5)) : (0.16 + 0.06 * Math.sin(t * 2 + idx));
    R(ctx, p.x + 3, p.y + 5, p.w - 6, p.h - 9, hexA(p.color, glow));
    R(ctx, p.x + 4, p.y + 6, 2, p.h - 11, "rgba(220,240,255,0.10)");
    if (!occupied) {
      ctx.fillStyle = p.color;
      var bx = p.x + p.w / 2 - 1, by = p.y + 14;
      ctx.fillRect(bx, by, 2, 4); ctx.fillRect(bx - 1, by + 4, 2, 4);
    }
  }

  function plant(ctx, x, y) {
    R(ctx, x, y + 8, 8, 6, "#5a3a28");
    R(ctx, x, y + 8, 8, 1, "#6e4a34");
    outlineRect(ctx, x, y + 8, 8, 6);
    R(ctx, x + 1, y, 2, 9, "#2e6a3a");
    R(ctx, x + 4, y + 2, 2, 7, "#37804a");
    R(ctx, x - 1, y + 3, 2, 6, "#2e6a3a");
    R(ctx, x + 6, y + 4, 2, 5, "#256032");
    ao(ctx, x, y + 14, 8);
  }

  function crate(ctx, b) {
    R(ctx, b.x, b.y, b.w, b.h, "#4a3a26");
    R(ctx, b.x + 1, b.y + 1, b.w - 2, 3, "#5c4a32");
    R(ctx, b.x + b.w / 2 - 1, b.y, 2, b.h, "#38301e");
    outlineRect(ctx, b.x, b.y, b.w, b.h);
    ao(ctx, b.x, b.y + b.h, b.w);
  }

  /* ------------ elevator bay (per floor, right side) ------------ */

  var ELE = { x: 480, w: 30, doorY: 26, doorH: 54, standX: 495, standY: 96 };

  function elevatorBay(ctx, accent) {
    // frame on the wall
    R(ctx, ELE.x - 4, ELE.doorY - 8, ELE.w + 8, ELE.doorH + 10, "#22222e");
    R(ctx, ELE.x - 4, ELE.doorY - 8, ELE.w + 8, 2, "#34344a");
    outlineRect(ctx, ELE.x - 4, ELE.doorY - 8, ELE.w + 8, ELE.doorH + 10, "#05050a");
    // dark opening (doors drawn in anim pass)
    R(ctx, ELE.x, ELE.doorY, ELE.w, ELE.doorH, "#08080e");
    // call panel
    R(ctx, ELE.x - 10, 46, 4, 8, "#1a1a26");
    R(ctx, ELE.x - 9, 48, 2, 2, accent);
    // floor strip light above
    R(ctx, ELE.x + 2, ELE.doorY - 6, ELE.w - 4, 2, "#101018");
  }

  function elevatorDoors(ctx, t, openAmt, accent, indicator) {
    // indicator lamp
    R(ctx, ELE.x + 2, ELE.doorY - 6, ELE.w - 4, 2, "#101018");
    ctx.fillStyle = indicator ? accent : "#2a2a38";
    ctx.fillRect(ELE.x + ELE.w / 2 - 2, ELE.doorY - 6, 4, 2);
    // car interior visible when open
    if (openAmt > 0.05) {
      R(ctx, ELE.x + 1, ELE.doorY + 1, ELE.w - 2, ELE.doorH - 2, "#2e3240");
      R(ctx, ELE.x + 2, ELE.doorY + 2, ELE.w - 4, 2, "#3c4254");
      R(ctx, ELE.x + 3, ELE.doorY + ELE.doorH - 5, ELE.w - 6, 3, "#262a36");
    }
    // sliding doors
    var half = ELE.w / 2;
    var slide = Math.round(half * openAmt);
    R(ctx, ELE.x - 0, ELE.doorY, half - slide, ELE.doorH, "#3a3f52");
    R(ctx, ELE.x + half + slide, ELE.doorY, half - slide, ELE.doorH, "#343a4c");
    if (half - slide > 1) {
      R(ctx, ELE.x + half - slide - 1, ELE.doorY, 1, ELE.doorH, "#1e2230");
      R(ctx, ELE.x + half + slide, ELE.doorY, 1, ELE.doorH, "#1e2230");
      R(ctx, ELE.x + 1, ELE.doorY + 2, half - slide - 2, 1, "#4a5066");
      R(ctx, ELE.x + half + slide + 1, ELE.doorY + 2, half - slide - 2, 1, "#4a5066");
    }
  }

  HG.Props = {
    R: R, outlineRect: outlineRect, dither: dither, ao: ao,
    lightPool: lightPool, ceilLamp: ceilLamp, hexA: hexA,
    signFrame: signFrame, neonText: neonText, neonSign: neonSign,
    codeScreen: codeScreen,
    desk: desk, serverRackWall: serverRackWall, rackLEDs: rackLEDs,
    pod: pod, podGlass: podGlass, plant: plant, crate: crate,
    ELE: ELE, elevatorBay: elevatorBay, elevatorDoors: elevatorDoors
  };
})(window.HG);
