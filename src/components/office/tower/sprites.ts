// @ts-nocheck
/* CLAUDE Agent Floor — procedural pixel-art sprites v2.
 *
 * Characters are 18x28 on a 20x30 canvas (1px margin for the outline pass),
 * assembled from layered features (hair styles, visors, robo arms, back
 * rigs, capes, exo frames...) defined per-skin in js/skins.js. Every frame
 * gets an automatic dark outline for that chunky 16-bit look.
 *
 * Poses: idle(2) walk(4) sit(2) type(2) sitFront(2) drink(2) point(2)
 *        recharge(2) celebrate(2)
 * Facings: down, up, left, right (left = mirrored right)
 */
window.HG = window.HG || {};

(function (HG) {
  "use strict";

  var CW = 20, CH = 30;       // canvas incl. 1px outline margin
  var OX = 1, OY = 1;         // sprite origin inside canvas
  var cache = {};

  var METAL = "#8a93a5", METAL_D = "#5e6675", METAL_L = "#b8c0cf";
  var DARK = "#14141c";

  function mkCanvas(w, h) {
    var c = document.createElement("canvas");
    c.width = w; c.height = h;
    return c;
  }

  function shade(hex, f) {
    if (hex[0] !== "#") return hex;
    var r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
    r = Math.max(0, Math.min(255, Math.round(r * f)));
    g = Math.max(0, Math.min(255, Math.round(g * f)));
    b = Math.max(0, Math.min(255, Math.round(b * f)));
    return "rgb(" + r + "," + g + "," + b + ")";
  }
  HG.shade = shade;

  function binder(ctx) {
    return function (x, y, w, h, col) {
      ctx.fillStyle = col;
      ctx.fillRect(x + OX, y + OY, w, h);
    };
  }

  function has(s, g) { return s.gear && s.gear.indexOf(g) !== -1; }

  /* =================== heads =================== */
  // head box x6..11 (6 wide), crown y0, face y3..8

  function hairFront(P, s) {
    var h = s.hair, st = s.hairStyle;
    if (has(s, "helmet")) { P(5, 0, 8, 4, s.trim); P(5, 3, 8, 1, shade(s.trim, 0.7)); P(6, 0, 6, 1, shade(s.trim, 1.25)); return; }
    if (has(s, "hardhat")) { P(5, 0, 8, 3, "#d8b84a"); P(5, 3, 8, 1, shade("#d8b84a", 0.75)); P(8, 0, 2, 1, "#fff0a0"); return; }
    if (has(s, "hood")) { P(4, 0, 10, 4, s.top); P(4, 3, 1, 5, s.top); P(13, 3, 1, 5, s.top); P(5, 0, 8, 1, shade(s.top, 1.2)); return; }
    if (has(s, "chromeSkull")) { P(6, 0, 6, 3, METAL_L); P(6, 2, 6, 1, METAL); return; }
    switch (st) {
      case "bald": P(6, 0, 6, 2, s.skin); P(6, 0, 6, 1, shade(s.skin, 1.1)); break;
      case "buzz": P(6, 0, 6, 2, shade(h, 0.9)); P(5, 1, 1, 3, shade(h, 0.9)); P(12, 1, 1, 3, shade(h, 0.9)); break;
      case "mohawk": P(6, 0, 6, 1, s.skin); P(8, -0, 2, 3, h); P(8, 0, 1, 3, shade(h, 1.2)); P(5, 1, 1, 2, s.skin); P(12, 1, 1, 2, s.skin); break;
      case "long": P(5, 0, 8, 3, h); P(4, 2, 2, 9, h); P(12, 2, 2, 9, shade(h, 0.85)); P(6, 0, 5, 1, shade(h, 1.2)); break;
      case "bun": P(6, 0, 6, 3, h); P(8, -0, 3, 1, shade(h, 1.15)); P(5, 1, 1, 3, h); P(12, 1, 1, 3, h); break;
      case "spiky": P(6, 1, 6, 2, h); P(6, 0, 1, 1, h); P(8, 0, 1, 1, h); P(10, 0, 1, 1, h); P(11, 0, 1, 1, shade(h, 1.2)); P(5, 1, 1, 3, h); P(12, 1, 1, 3, h); break;
      default: /* short */ P(5, 0, 8, 3, h); P(5, 2, 1, 2, h); P(12, 2, 1, 2, shade(h, 0.85)); P(6, 0, 6, 1, shade(h, 1.15));
    }
  }

  function faceFront(P, s, opts) {
    var sk = has(s, "chromeSkull") ? METAL_L : s.skin;
    P(6, 3, 6, 6, sk);
    P(6, 3, 6, 1, shade(sk, 0.92));
    P(11, 3, 1, 6, shade(sk, 0.88));
    if (has(s, "chromeSkull")) { P(6, 6, 6, 1, METAL); P(8, 7, 2, 1, METAL_D); }
    // eyes / eye gear
    if (has(s, "monoEye")) {
      P(6, 4, 6, 2, "#1a1a22");
      var ex = opts.t !== undefined ? 7 + (Math.floor(opts.t * 2) % 3) * 1.5 : 8;
      P(Math.floor(ex), 5, 2, 1, s.accent);
    } else if (has(s, "visor")) {
      P(5, 4, 8, 2, "#181820");
      P(6, 4, 6, 1, s.accent);
    } else if (has(s, "goggles")) {
      P(5, 3, 8, 1, "#3a3a30");
      P(6, 2, 2, 2, "#2a2a24"); P(10, 2, 2, 2, "#2a2a24");
      P(6, 2, 2, 1, s.accent); P(10, 2, 2, 1, s.accent);
      if (!opts.eyesClosed) { P(7, 5, 1, 1, "#1c1c28"); P(10, 5, 1, 1, "#1c1c28"); }
    } else if (!opts.eyesClosed) {
      P(7, 5, 1, 1, "#1c1c28"); P(10, 5, 1, 1, "#1c1c28");
      P(7, 4, 1, 1, "#ffffff"); P(10, 4, 1, 1, "#ffffff");
    } else {
      P(7, 5, 1, 1, shade(sk, 0.7)); P(10, 5, 1, 1, shade(sk, 0.7));
    }
    if (has(s, "halfChrome")) { P(6, 3, 3, 6, METAL_L); P(8, 3, 1, 6, METAL); P(7, 5, 1, 1, s.accent); }
    if (has(s, "thirdEye")) { P(8, 3, 2, 1, s.accent); }
    if (has(s, "mask")) { P(6, 6, 6, 3, "#dde6ee"); P(6, 8, 6, 1, "#b8c4d0"); }
    if (has(s, "headset")) { P(5, 5, 1, 2, "#2a2e38"); P(12, 5, 1, 2, "#2a2e38"); P(12, 5, 1, 1, s.accent); }
    if (has(s, "headphones")) { P(4, 4, 2, 3, "#22262e"); P(12, 4, 2, 3, "#22262e"); P(5, 0, 8, 1, "#22262e"); P(4, 5, 1, 1, s.accent); P(13, 5, 1, 1, s.accent); }
    if (has(s, "cap")) { P(5, 1, 8, 2, s.trim); P(4, 2, 10, 1, shade(s.trim, 0.8)); }
    if (has(s, "antenna")) { P(12, -0, 1, 3, METAL); P(12, 0, 1, 1, s.accent); }
    if (!has(s, "mask")) P(7, 8, 4, 1, shade(sk, 0.85));      // chin
  }

  function headFront(P, s, opts) { hairFront(P, s); faceFront(P, s, opts); }

  function headBack(P, s) {
    if (has(s, "helmet")) { P(5, 0, 8, 8, s.trim); P(5, 0, 8, 1, shade(s.trim, 1.2)); P(6, 7, 6, 1, shade(s.trim, 0.7)); return; }
    if (has(s, "hood")) { P(4, 0, 10, 8, s.top); P(5, 7, 8, 1, shade(s.top, 0.8)); return; }
    if (has(s, "hardhat")) { P(5, 0, 8, 4, "#d8b84a"); P(6, 4, 6, 4, s.skin); return; }
    var h = has(s, "chromeSkull") ? METAL_L : s.hair, st = s.hairStyle;
    if (st === "bald") { P(6, 0, 6, 4, has(s, "chromeSkull") ? METAL_L : s.skin); P(6, 4, 6, 4, shade(has(s, "chromeSkull") ? METAL : s.skin, 0.95)); }
    else if (st === "long") { P(5, 0, 8, 12, h); P(5, 10, 8, 2, shade(h, 0.8)); }
    else if (st === "mohawk") { P(6, 0, 6, 4, s.skin); P(8, 0, 2, 6, h); }
    else if (st === "bun") { P(5, 0, 8, 8, h); P(8, 0, 3, 2, shade(h, 1.15)); }
    else { P(5, 0, 8, 7, h); P(5, 6, 8, 1, shade(h, 0.85)); }
    if (has(s, "headphones")) { P(5, 0, 8, 1, "#22262e"); P(4, 4, 2, 3, "#22262e"); P(12, 4, 2, 3, "#22262e"); }
    if (has(s, "antenna")) { P(12, -0, 1, 3, METAL); P(12, 0, 1, 1, s.accent); }
    if (has(s, "cap")) P(5, 0, 8, 2, s.trim);
  }

  function headSide(P, s, opts) {
    // facing right
    var sk = has(s, "chromeSkull") ? METAL_L : s.skin;
    if (has(s, "helmet")) { P(5, 0, 8, 5, s.trim); P(9, 4, 4, 4, sk); P(5, 4, 4, 4, shade(s.trim, 0.85)); }
    else if (has(s, "hood")) { P(4, 0, 9, 6, s.top); P(9, 3, 4, 5, shade(sk, 0.9)); }
    else if (has(s, "hardhat")) { P(5, 0, 9, 3, "#d8b84a"); P(8, 3, 5, 5, sk); P(5, 3, 3, 5, shade(s.hair, 0.9)); }
    else {
      var h = s.hairStyle;
      P(8, 2, 5, 6, sk);
      if (h === "bald") { P(5, 0, 8, 3, sk); P(5, 3, 3, 5, shade(sk, 0.95)); }
      else if (h === "mohawk") { P(5, 2, 4, 5, sk); P(6, -0, 5, 2, s.hair); P(5, 1, 2, 2, s.hair); }
      else if (h === "long") { P(5, 0, 8, 3, s.hair); P(4, 2, 4, 10, s.hair); P(4, 10, 4, 2, shade(s.hair, 0.8)); }
      else { P(5, 0, 8, 3, s.hair); P(5, 2, 4, 5, s.hair); }
    }
    if (has(s, "monoEye")) { P(9, 4, 4, 2, "#1a1a22"); P(11, 5, 2, 1, s.accent); }
    else if (has(s, "visor")) { P(8, 4, 5, 2, "#181820"); P(9, 4, 4, 1, s.accent); }
    else if (has(s, "goggles")) { P(5, 2, 8, 1, "#3a3a30"); P(10, 2, 2, 2, "#2a2a24"); P(10, 2, 2, 1, s.accent); if (!opts.eyesClosed) P(11, 5, 1, 1, "#1c1c28"); }
    else if (!opts.eyesClosed) P(11, 5, 1, 1, "#1c1c28");
    if (has(s, "mask")) P(10, 6, 3, 3, "#dde6ee");
    if (has(s, "headset")) { P(7, 5, 2, 2, "#2a2e38"); P(7, 5, 1, 1, s.accent); P(9, 7, 3, 1, "#2a2e38"); }
    if (has(s, "headphones")) { P(6, 4, 3, 3, "#22262e"); P(7, 5, 1, 1, s.accent); P(5, 0, 8, 1, "#22262e"); }
    if (has(s, "cap")) { P(5, 1, 8, 2, s.trim); P(11, 2, 3, 1, shade(s.trim, 0.8)); }
    if (has(s, "antenna")) { P(6, -0, 1, 3, METAL); P(6, 0, 1, 1, s.accent); }
    if (has(s, "thirdEye")) P(10, 3, 1, 1, s.accent);
    P(9, 8, 4, 1, shade(sk, 0.85));
  }

  /* =================== back gear (drawn before body on front, after on back) === */

  function backGearFront(P, s, t) {
    // rig arms arc up from behind the shoulders
    if (has(s, "backRig")) {
      P(2, 2, 2, 2, METAL); P(14, 2, 2, 2, METAL);
      P(1, 4, 2, 3, METAL_D); P(15, 4, 2, 3, METAL_D);
      P(1, 3, 1, 1, s.accent); P(16, 3, 1, 1, s.accent);
      P(0, 6, 2, 2, METAL); P(16, 6, 2, 2, METAL);     // claws
      P(0, 8, 1, 1, METAL_D); P(17, 8, 1, 1, METAL_D);
    }
    if (has(s, "katana")) { P(13, 1, 1, 2, "#c8d0dc"); P(14, 0, 1, 1, "#c8d0dc"); P(12, 3, 1, 1, s.trim); }
    if (has(s, "jetpack")) { P(3, 11, 2, 5, METAL_D); P(13, 11, 2, 5, METAL_D); }
    if (has(s, "cape")) { P(3, 10, 2, 12, shade(s.top, 0.7)); P(13, 10, 2, 12, shade(s.top, 0.7)); }
  }

  function backGearBack(P, s, t) {
    if (has(s, "backRig")) {
      P(5, 9, 8, 7, METAL_D);                                  // pack
      P(6, 10, 6, 1, METAL);
      P(8, 12, 2, 2, s.accent);
      P(2, 2, 3, 3, METAL); P(13, 2, 3, 3, METAL);
      P(1, 4, 2, 4, METAL_D); P(15, 4, 2, 4, METAL_D);
      P(0, 7, 2, 2, METAL); P(16, 7, 2, 2, METAL);
    }
    if (has(s, "jetpack")) { P(5, 10, 8, 7, METAL_D); P(6, 11, 6, 2, METAL); P(7, 16, 2, 2, s.accent); P(10, 16, 2, 2, s.accent); }
    if (has(s, "tankPack")) { P(5, 9, 4, 8, "#7a8494"); P(10, 9, 4, 8, "#6b7484"); P(6, 9, 1, 8, METAL_L); P(5, 8, 9, 1, METAL_D); }
    if (has(s, "medpack")) { P(5, 9, 8, 8, "#d8d4c8"); P(8, 11, 2, 4, "#c0392b"); P(7, 12, 4, 2, "#c0392b"); }
    if (has(s, "katana")) { P(6, 2, 2, 2, "#c8d0dc"); P(7, 4, 2, 9, "#2a2a36"); P(8, 4, 1, 9, "#3a3a4a"); P(7, 12, 2, 2, s.trim); }
    if (has(s, "cape")) { P(4, 9, 10, 13, shade(s.top, 0.75)); P(4, 9, 10, 1, shade(s.top, 0.9)); P(4, 20, 10, 2, shade(s.top, 0.6)); }
  }

  /* =================== torso =================== */
  // torso x5..12, y10..18; arms x3..4 / x13..14

  function torsoCore(P, s, t, frame) {
    P(5, 10, 8, 9, s.top);
    P(5, 10, 8, 1, s.topLt);
    P(5, 10, 1, 9, shade(s.top, 1.08));
    P(12, 10, 1, 9, shade(s.top, 0.82));
    P(5, 18, 8, 1, s.trim);                      // belt
    P(8, 18, 2, 1, shade(s.trim, 1.3));          // buckle
    if (has(s, "coat")) { P(4, 10, 1, 12, s.top); P(13, 10, 1, 12, shade(s.top, 0.85)); P(8, 11, 1, 7, shade(s.top, 0.8)); P(5, 19, 3, 3, s.top); P(10, 19, 3, 3, shade(s.top, 0.9)); }
    if (has(s, "cloak")) { P(4, 9, 10, 10, s.top); P(4, 9, 10, 1, shade(s.top, 1.15)); P(4, 18, 10, 4, shade(s.top, 0.85)); }
    if (has(s, "armorVest")) { P(6, 11, 6, 6, shade(s.trim, 1.1)); P(6, 11, 6, 1, shade(s.trim, 1.35)); P(7, 13, 1, 2, shade(s.trim, 0.8)); P(10, 13, 1, 2, shade(s.trim, 0.8)); }
    if (has(s, "apron")) { P(6, 12, 6, 7, s.trim); P(7, 11, 4, 1, s.trim); P(7, 14, 4, 2, shade(s.trim, 0.85)); }
    if (has(s, "harness")) { P(5, 10, 1, 9, "#2e2a22"); P(12, 10, 1, 9, "#2e2a22"); P(5, 14, 8, 1, "#2e2a22"); P(6, 14, 1, 1, s.accent); }
    if (has(s, "shoulderPads")) { P(3, 9, 3, 2, METAL); P(12, 9, 3, 2, METAL); P(3, 9, 3, 1, METAL_L); P(12, 9, 3, 1, METAL_L); }
    if (has(s, "chestCore")) { P(8, 12, 2, 2, s.accent); P(7, 12, 1, 2, shade(s.accent, 0.6)); P(10, 12, 1, 2, shade(s.accent, 0.6)); }
    if (has(s, "circuit")) {
      var cvr = s.id.length % 3;
      if (cvr === 0) {
        P(6, 11, 1, 4, s.accent); P(6, 15, 3, 1, s.accent);
        P(11, 12, 1, 3, shade(s.accent, 0.8)); P(11, 16, 1, 1, s.accent);
      } else if (cvr === 1) {
        P(6, 12, 1, 1, s.accent); P(7, 13, 1, 1, s.accent); P(8, 14, 1, 1, s.accent);
        P(9, 14, 2, 1, shade(s.accent, 0.8)); P(11, 11, 1, 2, s.accent);
      } else {
        P(6, 11, 1, 6, shade(s.accent, 0.8)); P(11, 11, 1, 6, shade(s.accent, 0.8));
        P(7, 14, 4, 1, s.accent); P(8, 11, 2, 1, s.accent);
      }
    }
    if (has(s, "ledJacket")) {
      // animated equalizer bars
      for (var b = 0; b < 4; b++) {
        var hh = 1 + ((frame + b) % 3);
        P(6 + b * 2, 17 - hh, 1, hh, b % 2 ? s.accent : s.trim);
      }
    }
  }

  function armF(P, s, x, y, len, robo) {
    if (robo) {
      P(x, y, 2, len, METAL);
      P(x, y, 1, len, METAL_L);
      P(x, y + 2, 2, 1, METAL_D);                 // elbow joint
      P(x, y + len - 1, 2, 1, METAL_D);           // hand
      P(x + 1, y + 1, 1, 1, s.accent);
    } else if (has(s, "exoArms")) {
      P(x, y, 2, len, s.top);
      P(x, y, 1, len, METAL_D);
      P(x, y + 2, 1, 1, s.accent);
      P(x, y + len - 1, 2, 1, s.skin);
    } else {
      P(x, y, 2, len, s.top);
      P(x, y, 2, 1, s.topLt);
      P(x, y + len - 1, 2, 1, has(s, "gauntlet") ? METAL : s.skin);
    }
  }

  function armsFront(P, s, pose, frame) {
    var rl = has(s, "roboArms") || has(s, "roboArmL");
    var rr = has(s, "roboArms") || has(s, "roboArmR");
    if (pose === "up") {
      armF(P, s, 3, 5, 6, rl); armF(P, s, 13, 5, 6, rr);
      P(3, 4, 2, 1, rl ? METAL_D : s.skin); P(13, 4, 2, 1, rr ? METAL_D : s.skin);
    } else if (pose === "drink") {
      armF(P, s, 3, 11, 6, rl);
      P(13, 11, 2, 3, s.top); P(14, 8, 1, 4, rr ? METAL : s.top);
      P(13, 7, 3, 3, "#7a4a2e"); P(15, 7, 1, 2, "#9a6a44"); P(14, 7, 1, 1, "#5e3722");
    } else if (pose === "point") {
      armF(P, s, 3, 11, 6, rl);
      P(13, 11, 4, 2, rr ? METAL : s.top); P(17, 11, 1, 1, rr ? METAL_D : s.skin);
    } else {
      var sw = (pose === "walk") ? ((frame === 1 || frame === 2) ? 1 : 0) : 0;
      armF(P, s, 3, 11 + sw, 6, rl);
      armF(P, s, 13, 11 + (sw ? 0 : (pose === "walk" ? 1 : 0)), 6, rr);
    }
  }

  /* =================== legs =================== */

  function bootRow(P, s, x, w, y) {
    P(x, y, w, 3, s.boots);
    P(x, y, w, 1, shade(s.boots, 1.2));
    if (has(s, "exoLegs")) { P(x, y - 1, 1, 4, METAL_D); }
  }

  function legsStand(P, s) {
    P(6, 19, 3, 5, s.pants);
    P(9, 19, 3, 5, shade(s.pants, 0.88));
    if (has(s, "exoLegs")) { P(5, 19, 1, 5, METAL); P(12, 19, 1, 5, METAL); P(5, 21, 1, 1, s.accent); P(12, 21, 1, 1, s.accent); }
    bootRow(P, s, 6, 3, 24); bootRow(P, s, 9, 3, 24);
  }

  function legsWalkFront(P, s, fr) {
    if (fr === 0 || fr === 2) { legsStand(P, s); return; }
    var a = fr === 1 ? 1 : 0, b = fr === 1 ? 0 : 1;
    P(6, 19, 3, 5 - a, s.pants);
    P(9, 19, 3, 5 - b, shade(s.pants, 0.88));
    if (has(s, "exoLegs")) { P(5, 19, 1, 5 - a, METAL); P(12, 19, 1, 5 - b, METAL); }
    bootRow(P, s, 6, 3, 24 - a); bootRow(P, s, 9, 3, 24 - b);
  }

  function legsWalkSide(P, s, fr) {
    if (fr === 0 || fr === 2) {
      P(8, 19, 3, 5, s.pants);
      bootRow(P, s, 8, 3, 24);
    } else if (fr === 1) {
      P(5, 19, 3, 5, s.pants); P(10, 19, 3, 5, shade(s.pants, 0.88));
      bootRow(P, s, 4, 3, 24); bootRow(P, s, 11, 3, 24);
    } else {
      P(6, 19, 3, 5, s.pants); P(10, 19, 2, 5, shade(s.pants, 0.88));
      bootRow(P, s, 5, 3, 24); bootRow(P, s, 10, 3, 24);
    }
    if (has(s, "exoLegs")) { P(7, 19, 1, 5, METAL); P(7, 21, 1, 1, s.accent); }
  }

  /* =================== held props =================== */

  function heldProp(P, s, pose, frame) {
    if (!s.prop) return;
    if (pose !== "idle" && pose !== "point" && pose !== "walk") return;
    if (s.prop === "wrench") {
      P(14, 15, 1, 4, METAL); P(13, 14, 3, 1, METAL); P(13, 13, 1, 1, METAL); P(15, 13, 1, 1, METAL);
    } else if (s.prop === "tablet" && pose !== "walk") {
      P(13, 12, 4, 5, "#0e2a32");
      P(13, 12, 4, 1, METAL_D);
      P(14, 13, 2, 1, s.accent);
      P(14, 15, 2, 1, shade(s.accent, 0.7));
    } else if (s.prop === "mic" && pose === "point") {
      P(16, 9, 2, 2, "#c8d0dc"); P(16, 11, 1, 2, "#3a3a44");
    }
  }

  /* =================== torso (side / back) =================== */

  function torsoSide(P, s, fr, t) {
    P(6, 10, 6, 9, s.top);
    P(6, 10, 6, 1, s.topLt);
    P(6, 18, 6, 1, s.trim);
    if (has(s, "coat")) { P(5, 10, 1, 12, shade(s.top, 0.9)); P(6, 19, 5, 3, s.top); }
    if (has(s, "cloak") || has(s, "cape")) { P(4, 9, 3, 13, shade(s.top, 0.8)); }
    if (has(s, "armorVest")) { P(7, 11, 4, 6, shade(s.trim, 1.1)); }
    if (has(s, "apron")) P(9, 12, 3, 7, s.trim);
    if (has(s, "harness")) P(6, 14, 6, 1, "#2e2a22");
    if (has(s, "shoulderPads")) { P(7, 9, 4, 2, METAL); P(7, 9, 4, 1, METAL_L); }
    if (has(s, "backRig")) { P(4, 9, 3, 8, METAL_D); P(4, 3, 2, 3, METAL); P(3, 5, 2, 4, METAL_D); P(2, 8, 2, 2, METAL); }
    if (has(s, "jetpack")) { P(4, 10, 2, 8, METAL_D); P(4, 17, 2, 2, s.accent); }
    if (has(s, "tankPack")) { P(4, 9, 2, 8, "#7a8494"); }
    if (has(s, "medpack")) { P(4, 9, 2, 8, "#d8d4c8"); P(4, 12, 2, 2, "#c0392b"); }
    if (has(s, "katana")) { P(5, 3, 2, 2, "#c8d0dc"); P(5, 5, 1, 8, "#2a2a36"); }
    if (has(s, "ledJacket")) { for (var b = 0; b < 3; b++) { var hh = 1 + ((fr + b) % 3); P(7 + b * 2, 17 - hh, 1, hh, b % 2 ? s.accent : s.trim); } }
    if (has(s, "circuit")) { P(7, 11, 1, 4, s.accent); P(7, 15, 2, 1, s.accent); }
    // visible arm with swing
    var sw = [0, 1, 0, -1][fr] || 0;
    var robo = has(s, "roboArms") || has(s, "roboArmR");
    armF(P, s, 8 + sw, 11, 6, robo);
  }

  function torsoBack(P, s, frame) {
    P(5, 10, 8, 9, shade(s.top, 0.92));
    P(5, 10, 8, 1, shade(s.top, 0.8));
    P(5, 18, 8, 1, shade(s.trim, 0.9));
    if (has(s, "coat")) { P(4, 10, 1, 12, shade(s.top, 0.9)); P(13, 10, 1, 12, shade(s.top, 0.8)); P(5, 19, 8, 3, shade(s.top, 0.9)); }
    if (has(s, "cloak")) { P(4, 9, 10, 13, shade(s.top, 0.85)); }
    if (has(s, "harness")) { P(6, 10, 1, 9, "#2e2a22"); P(11, 10, 1, 9, "#2e2a22"); }
    if (has(s, "shoulderPads")) { P(3, 9, 3, 2, METAL); P(12, 9, 3, 2, METAL); }
    var rl = has(s, "roboArms") || has(s, "roboArmL");
    var rr = has(s, "roboArms") || has(s, "roboArmR");
    armF(P, s, 3, 11, 6, rr);   // mirrored sides from behind
    armF(P, s, 13, 11, 6, rl);
  }

  /* =================== pose assembly =================== */

  function renderFrame(s, pose, facing, frame) {
    var cv = mkCanvas(CW, CH);
    var ctx = cv.getContext("2d");
    var P = binder(ctx);
    var bob = 0;
    var opts = { eyesClosed: pose === "recharge" || (pose === "drink" && frame === 1), t: frame };

    function front(armPose) {
      backGearFront(P, s, frame);
      torsoCore(P, s, 0, frame);
      armsFront(P, s, armPose, frame);
      headFront(P, s, opts);
      heldProp(P, s, armPose === "down" ? pose : armPose, frame);
    }
    function back() {
      torsoBack(P, s, frame);
      headBack(P, s);
      backGearBack(P, s, frame);
    }
    function side() {
      torsoSide(P, s, pose === "walk" ? frame : 0, frame);
      headSide(P, s, opts);
      heldProp(P, s, pose, frame);
    }

    switch (pose) {
      case "idle":
      case "drink":
      case "point":
      case "recharge":
        bob = (frame === 1 && pose === "idle") ? 1 : 0;
        ctx.save(); ctx.translate(0, bob);
        if (facing === "up") back();
        else if (facing === "down") front(pose === "drink" ? "drink" : pose === "point" ? "point" : "down");
        else side();
        ctx.restore();
        if (facing === "up" || facing === "down") legsStand(P, s);
        else { P(8, 19, 3, 5, s.pants); bootRow(P, s, 8, 3, 24); }
        if (pose === "drink" && frame === 1 && facing === "down") { P(14, 4, 1, 1, "#cfd8e0"); P(15, 3, 1, 1, "#cfd8e0"); }
        break;

      case "walk":
        bob = (frame === 1 || frame === 3) ? 1 : 0;
        ctx.save(); ctx.translate(0, bob);
        if (facing === "up") back();
        else if (facing === "down") front("walk");
        else side();
        ctx.restore();
        if (facing === "up" || facing === "down") legsWalkFront(P, s, frame);
        else legsWalkSide(P, s, frame);
        break;

      case "sit":   // back view at desk; chair hides legs
      case "type":
        back();
        P(6, 19, 6, 2, shade(s.pants, 0.85));
        var tOff = (pose === "type") ? (frame ? 1 : 0) : 0;
        P(3, 13 + tOff, 2, 4, has(s, "roboArms") || has(s, "roboArmR") ? METAL : s.top);
        P(13, 13 + (tOff ? 0 : 1), 2, 4, has(s, "roboArms") || has(s, "roboArmL") ? METAL : s.top);
        break;

      case "sitFront":
        front("down");
        P(6, 19, 6, 3, s.pants);
        P(5, 20, 3, 2, s.boots); P(10, 20, 3, 2, shade(s.boots, 0.85));
        break;

      case "celebrate":
        bob = (frame === 1) ? -1 : 0;
        ctx.save(); ctx.translate(0, bob);
        backGearFront(P, s, frame);
        torsoCore(P, s, 0, frame);
        armsFront(P, s, "up", frame);
        headFront(P, s, opts);
        ctx.restore();
        legsStand(P, s);
        break;

      default:
        front("down");
        legsStand(P, s);
    }

    outlinePass(cv);
    return cv;
  }

  /* dark outline around the silhouette — the 16-bit polish pass */
  function outlinePass(cv) {
    var ctx = cv.getContext("2d");
    var img = ctx.getImageData(0, 0, cv.width, cv.height);
    var d = img.data, w = cv.width, h = cv.height;
    var solid = new Uint8Array(w * h);
    for (var i = 0; i < w * h; i++) solid[i] = d[i * 4 + 3] > 40 ? 1 : 0;
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var idx = y * w + x;
        if (solid[idx]) continue;
        var n = (x > 0 && solid[idx - 1]) || (x < w - 1 && solid[idx + 1]) ||
                (y > 0 && solid[idx - w]) || (y < h - 1 && solid[idx + w]);
        if (n) { var o = idx * 4; d[o] = 12; d[o + 1] = 12; d[o + 2] = 18; d[o + 3] = 235; }
      }
    }
    ctx.putImageData(img, 0, 0);
  }

  HG.Sprites = {
    W: CW, H: CH,

    get: function (skin, pose, facing, frame) {
      var mirror = facing === "left";
      var f = mirror ? "right" : facing;
      var key = skin.id + "|" + pose + "|" + f + "|" + frame + (mirror ? "|m" : "");
      if (cache[key]) return cache[key];
      var cv = renderFrame(skin, pose, f, frame);
      if (mirror) {
        var m = mkCanvas(CW, CH);
        var mc = m.getContext("2d");
        mc.translate(CW, 0); mc.scale(-1, 1);
        mc.drawImage(cv, 0, 0);
        cv = m;
      }
      cache[key] = cv;
      return cv;
    },

    draw: function (ctx, skin, pose, facing, frame, x, y) {
      var cv = this.get(skin, pose, facing, frame);
      ctx.drawImage(cv, Math.round(x - CW / 2), Math.round(y - CH + 1));
    }
  };

  /* =================== orchestrator orb (kept from v1, tuned) ============ */

  var ORB_R = 9;
  var rowSpan = [];
  (function () {
    for (var dy = -ORB_R; dy <= ORB_R; dy++) {
      rowSpan.push({ dy: dy, half: Math.floor(Math.sqrt(ORB_R * ORB_R - dy * dy)) });
    }
  })();
  var sparks = [];
  for (var i = 0; i < 26; i++) {
    sparks.push({ a: Math.random() * Math.PI * 2, r: 2 + Math.random() * 16, s: 0.15 + Math.random() * 0.5, p: Math.random() });
  }

  // The orb is drawn at native pixel size into an offscreen buffer, then
  // nearest-neighbor scaled onto the scene — so it can be enlarged without
  // losing the crisp pixel look. Buffer is sized to the orb's full footprint
  // (active halo + sparks above, glow below) around a local center.
  var ORB_BUF_W = 64, ORB_BUF_H = 88, ORB_CX = 32, ORB_CY = 46;
  var orbBuf = document.createElement("canvas");
  orbBuf.width = ORB_BUF_W; orbBuf.height = ORB_BUF_H;
  var orbCtx = orbBuf.getContext("2d");

  HG.Orb = {
    R: ORB_R,
    // `act` (0..1) is the smoothed activity level from the orchestrator: high
    // while you're talking to it (or agents are working), low when idle. It
    // is the single knob that drives the active↔idle look.
    draw: function (ctx, x, y, t, act, scale) {
      scale = scale || 1;
      act = Math.max(0, Math.min(1, act || 0));
      var O = HG.ORB;
      // Pulse slow + shallow when idle, fast + deep when active — the orb
      // visibly "breathes faster" the moment a conversation starts.
      var slow = 0.5 + 0.5 * Math.sin(t * 1.5);
      var fast = 0.5 + 0.5 * Math.sin(t * 4.6);
      var pulse = slow * (1 - act) + fast * act;
      var amp = 0.12 + 0.88 * act;        // overall energy: dim idle, bright active
      var c = orbCtx;
      c.clearRect(0, 0, ORB_BUF_W, ORB_BUF_H);
      var cx = ORB_CX, cy = ORB_CY;
      var bobY = cy + Math.round(Math.sin(t * 1.4) * (1 + act * 2));

      // Outer pulse halo — only blooms when active; the clearest "alive" cue.
      if (act > 0.05) {
        var hr = 16 + act * (6 + pulse * 8);
        c.fillStyle = "rgba(255,120,140," + ((0.05 + 0.22 * act) * (0.45 + 0.55 * pulse)).toFixed(3) + ")";
        for (var hk = 0; hk < 30; hk++) {
          var hang = hk / 30 * 6.2832;
          c.fillRect(cx + Math.round(Math.cos(hang) * hr), bobY + Math.round(Math.sin(hang) * hr * 0.6), 1, 1);
        }
      }

      var gy = cy + 26;
      c.fillStyle = "rgba(210,58,85," + (0.14 + 0.20 * pulse * amp).toFixed(3) + ")";
      c.fillRect(cx - 16, gy, 32, 3);
      c.fillStyle = "rgba(120,60,160," + (0.12 + 0.18 * act).toFixed(3) + ")";
      c.fillRect(cx - 22, gy + 3, 44, 2);

      // Soft aura behind the core — grows and brightens with activity.
      var ah = 13 + Math.round(act * 5);
      c.fillStyle = "rgba(255,107,122," + (0.04 + 0.14 * pulse * amp).toFixed(3) + ")";
      c.fillRect(cx - ah, bobY - ah, ah * 2, ah * 2);

      c.fillStyle = shade(O.ring, 0.7);
      for (var a = Math.PI * 0.95; a < Math.PI * 1.95; a += 0.18) {
        c.fillRect(cx + Math.round(Math.cos(a) * 14), bobY + Math.round(Math.sin(a) * 4) - 2, 2, 1);
      }
      for (var r = 0; r < rowSpan.length; r++) {
        var row = rowSpan[r];
        var col = O.core;
        if (row.dy < -5) col = O.coreLt;
        else if (row.dy < -2) col = shade(O.core, 1.12);
        else if (row.dy > 5) col = O.coreDk;
        else if (row.dy > 2) col = shade(O.core, 0.9);
        c.fillStyle = col;
        c.fillRect(cx - row.half, bobY + row.dy, row.half * 2 + 1, 1);
      }
      // Active core tint — the planet itself warms up while engaged.
      if (act > 0.08) {
        c.fillStyle = "rgba(255,226,232," + (0.22 * act).toFixed(3) + ")";
        for (var rt = 0; rt < rowSpan.length; rt++) {
          var rw = rowSpan[rt];
          c.fillRect(cx - rw.half, bobY + rw.dy, rw.half * 2 + 1, 1);
        }
      }
      c.fillStyle = shade(O.coreDk, 1.05);
      c.fillRect(cx - 7, bobY + 1, 12, 1);
      c.fillRect(cx - 8, bobY - 3, 9, 1);
      c.fillStyle = O.coreLt;
      c.fillRect(cx - 4, bobY - 6, 5, 1);
      c.fillStyle = O.ring;
      for (var a2 = -0.05; a2 < Math.PI * 0.95; a2 += 0.14) {
        c.fillRect(cx + Math.round(Math.cos(a2) * 14), bobY + Math.round(Math.sin(a2) * 4) - 2, 2, 1);
      }
      // Energy sparks — rise off the core only when active; idle is still.
      if (act > 0.06) {
        for (var sp2 = 0; sp2 < sparks.length; sp2++) {
          var sp = sparks[sp2];
          var lc = (t * sp.s + sp.p) % 1;
          if (lc < 0.05) continue;
          var sa = (1 - lc) * act * 0.95;
          if (sa < 0.04) continue;
          c.fillStyle = "rgba(207,232,255," + sa.toFixed(2) + ")";
          c.fillRect(cx + Math.round(Math.cos(sp.a + t * 0.3) * sp.r * 0.6), bobY - 10 - Math.round(lc * 26), 1, 1);
        }
      }
      // Hot white pinpoint — flickers only when clearly active.
      if (act > 0.45) {
        c.fillStyle = "rgba(255,255,255," + (0.3 * pulse * ((act - 0.45) / 0.55)).toFixed(2) + ")";
        c.fillRect(cx - 2, bobY - 2, 4, 4);
      }

      var prevSmooth = ctx.imageSmoothingEnabled;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(
        orbBuf, 0, 0, ORB_BUF_W, ORB_BUF_H,
        Math.round(x - ORB_CX * scale), Math.round(y - ORB_CY * scale),
        Math.round(ORB_BUF_W * scale), Math.round(ORB_BUF_H * scale)
      );
      ctx.imageSmoothingEnabled = prevSmooth;
    }
  };
})(window.HG);
