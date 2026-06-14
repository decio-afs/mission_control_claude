// @ts-nocheck
/* CLAUDE Agent Floor — skin catalog (20 selectable looks).
 * Each skin is a palette + feature list consumed by the sprites v2 renderer.
 *
 * hairStyle: short | long | mohawk | bald | bun | spiky | buzz
 * gear:      visor goggles monoEye mask halfChrome headset cap hood helmet
 *            hardhat headphones thirdEye apron cloak cape armorVest circuit
 *            chestCore shoulderPads harness ledJacket coat backRig jetpack
 *            tankPack katana antenna medpack roboArmR roboArmL roboArms
 *            exoArms exoLegs
 * prop:      wrench | tablet | mic | null  (signature held item)
 */
window.HG = window.HG || {};

(function (HG) {
  "use strict";

  HG.SKINS = [
    { id: "medic",    name: "MEDIC",       skin: "#e8b08a", hair: "#5a4632", hairStyle: "short",
      top: "#dcd8cc", topLt: "#f2efe6", pants: "#4a5568", boots: "#6b4a32", accent: "#52f779", trim: "#c0392b",
      gear: ["mask", "coat", "medpack", "headset"], prop: "tablet" },

    { id: "chrome",   name: "CHROME DIVA", skin: "#e8b08a", hair: "#8a5a3a", hairStyle: "long",
      top: "#bcd4e8", topLt: "#eef7ff", pants: "#bcd4e8", boots: "#9ab8d8", accent: "#4fd8ff", trim: "#7aa8cc",
      gear: ["circuit", "shoulderPads"], prop: "mic" },

    { id: "rigrunner",name: "RIGRUNNER",   skin: "#c89068", hair: "#3a3228", hairStyle: "buzz",
      top: "#5a614a", topLt: "#737a5e", pants: "#4a5040", boots: "#6b4a32", accent: "#52f779", trim: "#8a8a6a",
      gear: ["visor", "backRig", "armorVest", "roboArmL"], prop: "tablet" },

    { id: "officer",  name: "OFFICER",     skin: "#d8a078", hair: "#2a2a32", hairStyle: "short",
      top: "#3a4248", topLt: "#4d565e", pants: "#46505a", boots: "#5a4636", accent: "#4fd8ff", trim: "#2e343a",
      gear: ["coat", "chestCore", "headset"], prop: null },

    { id: "barista",  name: "BARISTA",     skin: "#e8b08a", hair: "#3a2a1e", hairStyle: "short",
      top: "#3a4a66", topLt: "#4c5e80", pants: "#38415e", boots: "#4a3327", accent: "#ffba3b", trim: "#6b4a32",
      gear: ["apron", "roboArmR"], prop: null },

    { id: "scout",    name: "DUST SCOUT",  skin: "#d8a078", hair: "#4a3a2a", hairStyle: "short",
      top: "#6b6248", topLt: "#857a5c", pants: "#55503e", boots: "#6b4a32", accent: "#39d7e7", trim: "#4a4435",
      gear: ["goggles", "coat", "harness"], prop: "tablet" },

    { id: "wrench",   name: "WRENCH",      skin: "#b88058", hair: "#9a9a9a", hairStyle: "buzz",
      top: "#5a6478", topLt: "#71809a", pants: "#4d5668", boots: "#6b4a32", accent: "#52f779", trim: "#c8b878",
      gear: ["roboArms", "harness", "tankPack"], prop: "wrench" },

    { id: "fieldmed", name: "FIELD MEDIC", skin: "#e8b08a", hair: "#4a3a2a", hairStyle: "short",
      top: "#cac6ba", topLt: "#e5e2d8", pants: "#4a5568", boots: "#5a4636", accent: "#ff5c7a", trim: "#c0392b",
      gear: ["mask", "coat", "medpack", "goggles"], prop: null },

    { id: "trooper",  name: "TROOPER",     skin: "#c89068", hair: "#2e2a22", hairStyle: "buzz",
      top: "#4d5444", topLt: "#636c58", pants: "#454c3e", boots: "#5a4636", accent: "#ffba3b", trim: "#383e32",
      gear: ["helmet", "visor", "armorVest", "shoulderPads"], prop: null },

    { id: "acepilot", name: "ACE PILOT",   skin: "#e8b08a", hair: "#6a4a2a", hairStyle: "short",
      top: "#5a6448", topLt: "#737e5c", pants: "#3e4a66", boots: "#6b4a32", accent: "#ff4f6e", trim: "#46503a",
      gear: ["visor", "headset", "harness", "jetpack"], prop: null },

    { id: "scavenger",name: "SCAVENGER",   skin: "#d8a078", hair: "#3a2e22", hairStyle: "short",
      top: "#8a8273", topLt: "#a39a88", pants: "#5a5544", boots: "#6b4a32", accent: "#ffba3b", trim: "#4a4438",
      gear: ["cap", "harness", "gauntlet"], prop: "wrench" },

    { id: "nightblade",name:"NIGHTBLADE",  skin: "#c89068", hair: "#1e1e26", hairStyle: "short",
      top: "#2e3240", topLt: "#3d4254", pants: "#262a36", boots: "#1e2028", accent: "#ff2d4e", trim: "#15171f",
      gear: ["hood", "cape", "monoEye", "armorVest", "katana"], prop: null },

    { id: "ronin",    name: "NEON RONIN",  skin: "#d8a078", hair: "#16161e", hairStyle: "bun",
      top: "#43314e", topLt: "#5a4368", pants: "#2e2a36", boots: "#241f2a", accent: "#ff4fd8", trim: "#ff4fd8",
      gear: ["katana", "circuit", "shoulderPads"], prop: null },

    { id: "holohack", name: "HOLO HACKER", skin: "#e8b08a", hair: "#3a8a5a", hairStyle: "spiky",
      top: "#2a3a4a", topLt: "#3a5266", pants: "#26303e", boots: "#2e3844", accent: "#52f779", trim: "#1e2a36",
      gear: ["hood", "goggles", "circuit", "gauntlet"], prop: "tablet" },

    { id: "synthdj",  name: "SYNTH DJ",    skin: "#c89068", hair: "#b84fd8", hairStyle: "mohawk",
      top: "#2e2638", topLt: "#40344e", pants: "#332a40", boots: "#241f2e", accent: "#ff4fd8", trim: "#4fd8ff",
      gear: ["headphones", "ledJacket"], prop: "mic" },

    { id: "cybermonk",name: "CYBER MONK",  skin: "#d8a078", hair: "#000000", hairStyle: "bald",
      top: "#7a4a2e", topLt: "#96603e", pants: "#5e3a26", boots: "#43291a", accent: "#ffd75c", trim: "#a8742e",
      gear: ["cloak", "thirdEye", "antenna", "circuit"], prop: null },

    { id: "exohauler",name: "EXO HAULER",  skin: "#b88058", hair: "#3a3228", hairStyle: "buzz",
      top: "#8a6a2e", topLt: "#a8843c", pants: "#4d5668", boots: "#3a4250", accent: "#ffba3b", trim: "#6b5424",
      gear: ["hardhat", "exoArms", "exoLegs", "harness"], prop: null },

    { id: "netdiver", name: "NETDIVER",    skin: "#d8a078", hair: "#2a6a8a", hairStyle: "long",
      top: "#1e3640", topLt: "#2a4a58", pants: "#1e3640", boots: "#16282f", accent: "#39d7e7", trim: "#2a4a58",
      gear: ["circuit", "chestCore", "monoEye", "antenna"], prop: null },

    { id: "warden",   name: "WARDEN",      skin: "#c89068", hair: "#2a2a32", hairStyle: "buzz",
      top: "#36404e", topLt: "#475464", pants: "#2e3844", boots: "#222a34", accent: "#ff9c4f", trim: "#ffba3b",
      gear: ["helmet", "visor", "armorVest", "shoulderPads", "harness"], prop: null },

    { id: "oracle",   name: "ORACLE UNIT", skin: "#aab4c4", hair: "#aab4c4", hairStyle: "bald",
      top: "#cfd6e2", topLt: "#e8edf5", pants: "#9aa5b8", boots: "#7e8a9e", accent: "#4fd8ff", trim: "#6b7689",
      gear: ["chromeSkull", "monoEye", "chestCore", "circuit", "antenna"], prop: null }
  ];

  HG.skinById = function (id) {
    for (var i = 0; i < HG.SKINS.length; i++) if (HG.SKINS[i].id === id) return HG.SKINS[i];
    return HG.SKINS[0];
  };

  // default skin assignment for the 12 cast members (index-aligned)
  HG.DEFAULT_SKINS = ["medic", "chrome", "rigrunner", "officer", "barista", "scout",
                      "wrench", "fieldmed", "trooper", "acepilot", "scavenger", "nightblade"];
})(window.HG);
