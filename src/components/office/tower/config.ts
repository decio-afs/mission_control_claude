// @ts-nocheck
/* CLAUDE Agent Tower — global config, palette, cast plumbing.
 *
 * Adapted from Agents_GUI/js/config.js for Mission Control: the fixed
 * 12-agent demo cast is gone — the host (GhostOffice.tsx) builds the cast
 * from the live Mc roster and installs it with HG.setCast() before
 * HG.boot(). Wardrobe palettes from the original cast are kept as presets
 * that cycle across however many real agents exist.
 */
window.HG = window.HG || {};

(function (HG) {
  "use strict";

  // Internal pixel resolution (scaled up with nearest-neighbor)
  HG.VIEW_W = 512;
  HG.VIEW_H = 288;

  // Pathfinding grid cell size (px)
  HG.CELL = 4;

  // Environment palette (inspired by reference scene)
  HG.PAL = {
    bgDeep:    "#07070f",
    wallDark:  "#14141f",
    wall:      "#1b1b29",
    wallLite:  "#242436",
    floor:     "#1e1e2c",
    floorAlt:  "#232333",
    floorLine: "#15151f",
    walkway:   "#191926",
    metal:     "#2e2e42",
    metalLite: "#3c3c55",
    wood:      "#4a3327",
    woodLite:  "#5d4233",
    woodDark:  "#392619",
    shadow:    "rgba(0,0,0,0.35)",
    neonPink:  "#ff4fd8",
    neonBlue:  "#4fd8ff",
    neonGreen: "#52f779",
    neonYellow:"#ffe14f",
    neonOrange:"#ff9c4f",
    neonRed:   "#ff4f6e",
    termGreen: "#39e75f",
    termAmber: "#ffba3b",
    termCyan:  "#39d7e7",
    glassDark: "#0d2018",
    cable:     "#101018",
    cityFar:   "#1a1430",
    cityMid:   "#241b42",
    cityNear:  "#2e2255"
  };

  // Orchestrator orb colors (pink planet w/ ring) — matches the brand coral
  // the rest of the Nexus deck reserves for the core.
  HG.ORB = {
    core:   "#ff6b7a",
    coreLt: "#ffa3ad",
    coreDk: "#d23a55",
    ring:   "#ff8da0",
    glow:   "rgba(255, 107, 122, 0.18)",
    spark:  "#cfe8ff"
  };

  // Wardrobe presets (the original 12 cast outfits, minus identity). The host
  // cycles these across the live roster; `accent` is overridden per agent
  // with its squad color so glow/visor identity matches the rest of the deck.
  HG.WARDROBE = [
    { skin: "#e8b08a", hair: "#5a4632", top: "#d8d4c8", topLt: "#efece2", pants: "#4a5568", boots: "#6b4a32", accent: "#7ad7ff", trim: "#b8b4a8", acc: "mask" },
    { skin: "#e8b08a", hair: "#8a5a3a", top: "#bcd4e8", topLt: "#e2f0fa", pants: "#bcd4e8", boots: "#9ab8d8", accent: "#4fd8ff", trim: "#7aa8cc", acc: "none" },
    { skin: "#c89068", hair: "#3a3228", top: "#5a614a", topLt: "#737a5e", pants: "#4a5040", boots: "#6b4a32", accent: "#52f779", trim: "#8a8a6a", acc: "visor" },
    { skin: "#d8a078", hair: "#2a2a32", top: "#3a4248", topLt: "#4d565e", pants: "#46505a", boots: "#5a4636", accent: "#4fd8ff", trim: "#2e343a", acc: "none" },
    { skin: "#e8b08a", hair: "#3a2a1e", top: "#3a4a66", topLt: "#4c5e80", pants: "#38415e", boots: "#4a3327", accent: "#ffba3b", trim: "#6b4a32", acc: "apron" },
    { skin: "#d8a078", hair: "#4a3a2a", top: "#6b6248", topLt: "#857a5c", pants: "#55503e", boots: "#6b4a32", accent: "#39d7e7", trim: "#4a4435", acc: "goggles" },
    { skin: "#b88058", hair: "#8a8a8a", top: "#5a6478", topLt: "#71809a", pants: "#4d5668", boots: "#6b4a32", accent: "#52f779", trim: "#c8b878", acc: "arm" },
    { skin: "#e8b08a", hair: "#4a3a2a", top: "#cac6ba", topLt: "#e5e2d8", pants: "#4a5568", boots: "#5a4636", accent: "#52f779", trim: "#a8a49a", acc: "mask" },
    { skin: "#c89068", hair: "#2e2a22", top: "#4d5444", topLt: "#636c58", pants: "#454c3e", boots: "#5a4636", accent: "#ffba3b", trim: "#383e32", acc: "visor" },
    { skin: "#e8b08a", hair: "#6a4a2a", top: "#5a6448", topLt: "#737e5c", pants: "#3e4a66", boots: "#6b4a32", accent: "#ff4f6e", trim: "#46503a", acc: "headset" },
    { skin: "#d8a078", hair: "#3a2e22", top: "#8a8273", topLt: "#a39a88", pants: "#5a5544", boots: "#6b4a32", accent: "#ffba3b", trim: "#4a4438", acc: "cap" },
    { skin: "#c89068", hair: "#1e1e26", top: "#2e3240", topLt: "#3d4254", pants: "#262a36", boots: "#1e2028", accent: "#39d7e7", trim: "#15171f", acc: "cloak" }
  ];

  // The live cast — installed by the host before boot. Each entry needs
  // { id, name, role } + the wardrobe fields above.
  HG.CAST = [];
  HG.setCast = function (cast) { HG.CAST = cast || []; };

  // Roof-sign text (the host sets the orchestrator's name).
  HG.SIGN = "CLAUDE";
  HG.setSign = function (text) { HG.SIGN = String(text || "CLAUDE").toUpperCase().slice(0, 10); };
})(window.HG);
