// @ts-nocheck
/* CLAUDE Agent Tower — HUD: connection badge, inspector, view bar, skin gallery.
 *
 * Adapted from Agents_GUI/js/ui.js for Mission Control: all element lookups
 * are scoped to the mount root (the React wrapper owns the DOM), init/destroy
 * are symmetrical so the office tab can mount and unmount freely, and agent
 * selection is bridged to the host via HG.UI.onSelect / selectById so the
 * Nexus detail panel stays in sync with tower clicks.
 */
window.HG = window.HG || {};

(function (HG) {
  "use strict";

  var root = null;
  var hoverAgent = null;
  var selectedAgent = null;
  var galleryTimer = null;
  var keyHandler = null;

  function $(id) { return root ? root.querySelector("#" + id) : null; }

  HG.UI = {
    get hoverAgent() { return hoverAgent; },
    get selectedAgent() { return selectedAgent; },

    // Host callback — fired when the user picks (or clears) an agent in the
    // tower, so the host can mirror selection in its own detail panel.
    onSelect: null,

    setConn: function (state) {
      var el = $("hud-conn");
      if (!el) return;
      el.className = "conn-" + (state === "live" ? "live" : state === "error" ? "err" : "mock");
      el.textContent = state === "live" ? "LIVE" : state === "error" ? "BRIDGE DOWN" : "MOCK";
    },

    setHover: function (a) { hoverAgent = a; },

    select: function (a, silent) {
      selectedAgent = a;
      var panel = $("hud-panel");
      if (panel) {
        if (!a) panel.classList.add("hidden");
        else {
          panel.classList.remove("hidden");
          var nm = $("panel-name"), rl = $("panel-role");
          if (nm) nm.textContent = a.cast.name;
          if (rl) rl.textContent = "ROLE: " + a.cast.role;
        }
      }
      if (!silent && HG.UI.onSelect) HG.UI.onSelect(a ? a.cast.id : null);
    },

    // Host → engine selection sync (does not echo back through onSelect).
    selectById: function (id) {
      if (!id) { if (selectedAgent) this.select(null, true); return; }
      if (selectedAgent && selectedAgent.cast.id === id) return;
      var list = HG.Agents.list;
      for (var i = 0; i < list.length; i++) {
        if (list[i].cast.id === id) { this.select(list[i], true); return; }
      }
    },

    refresh: function () {
      var lbl = $("view-floor-label");
      if (lbl) {
        if (HG.View.mode === "building") {
          lbl.textContent = "TOWER VIEW";
          lbl.style.color = "#9ef0a0";
        } else {
          lbl.textContent = "F" + HG.View.floor + " · " + HG.Floors.NAMES[HG.View.floor];
          lbl.style.color = HG.Floors.ACCENTS[HG.View.floor];
        }
      }
      if (!selectedAgent) return;
      var a = selectedAgent;
      var st = $("panel-status");
      if (!st) return;
      var statusText =
        a.mode === "working" ? "WORKING" :
        a.mode === "error" ? "ERROR" :
        (a.mode === "move" && a.nextMode === "sitDesk") ? "DISPATCHED" :
        a.riding ? "IN ELEVATOR" :
        a.mode === "waitElevator" ? "WAITING FOR LIFT" :
        a.mode === "chatting" ? "IDLE — chatting" :
        a.mode === "atPoi" && a.poi ? "IDLE — " + a.poi.type : "IDLE";
      st.textContent = "STATUS: " + statusText + "  ·  F" + a.floor;
      st.className = a.mode === "working" ? "st-working" : a.mode === "error" ? "st-error" : "";
      var tk = $("panel-task"), sk = $("panel-skin");
      if (tk) tk.textContent = a.task ? "» " + a.task : "";
      if (sk) sk.textContent = "SKIN: " + a.skin.name;
    },

    /* ---------------- skin gallery ---------------- */

    openGallery: function () {
      if (!selectedAgent) return;
      var overlay = $("gallery");
      var grid = $("gallery-grid");
      if (!overlay || !grid) return;
      var title = $("gallery-title");
      if (title) title.textContent = "SKIN LOCKER — " + selectedAgent.cast.name;
      grid.innerHTML = "";
      var frame = 0;
      var cells = [];

      HG.SKINS.forEach(function (skin) {
        var cell = document.createElement("div");
        cell.className = "skin-cell" + (selectedAgent.skin.id === skin.id ? " current" : "");
        var cv = document.createElement("canvas");
        cv.width = HG.Sprites.W * 3;
        cv.height = HG.Sprites.H * 3;
        var label = document.createElement("div");
        label.className = "skin-name";
        label.textContent = skin.name;
        cell.appendChild(cv);
        cell.appendChild(label);
        cell.addEventListener("click", function () {
          HG.Agents.setSkin(selectedAgent, skin.id);
          HG.UI.closeGallery();
          HG.UI.refresh();
        });
        grid.appendChild(cell);
        cells.push({ cv: cv, skin: skin });
      });

      function paint() {
        cells.forEach(function (c) {
          var ctx = c.cv.getContext("2d");
          ctx.imageSmoothingEnabled = false;
          ctx.clearRect(0, 0, c.cv.width, c.cv.height);
          var pose = (frame % 6 < 3) ? "idle" : "walk";
          var fr = pose === "walk" ? (frame % 4) : (frame % 2);
          var src = HG.Sprites.get(c.skin, pose, "down", fr);
          ctx.drawImage(src, 0, 0, c.cv.width, c.cv.height);
        });
        frame++;
      }
      paint();
      galleryTimer = setInterval(paint, 280);
      overlay.classList.remove("hidden");
    },

    closeGallery: function () {
      var overlay = $("gallery");
      if (overlay) overlay.classList.add("hidden");
      if (galleryTimer) { clearInterval(galleryTimer); galleryTimer = null; }
    },

    init: function (rootEl) {
      root = rootEl;
      hoverAgent = null;
      selectedAgent = null;

      var on = function (id, fn) { var el = $(id); if (el) el.addEventListener("click", fn); };
      on("panel-close", function () { HG.UI.select(null); });
      on("panel-skin-btn", function () { HG.UI.openGallery(); });
      on("gallery-close", function () { HG.UI.closeGallery(); });
      on("btn-building", function () { HG.View.setBuilding(); });
      on("btn-prev", function () { HG.View.setFloor((HG.View.mode === "floor" ? HG.View.floor + 4 : 0) % 5); });
      on("btn-next", function () { HG.View.setFloor((HG.View.mode === "floor" ? HG.View.floor + 1 : 4) % 5); });

      keyHandler = function (e) {
        if (e.key === "Escape") {
          var g = $("gallery");
          if (g && !g.classList.contains("hidden")) HG.UI.closeGallery();
          else if (HG.View.mode === "floor") HG.View.setBuilding();
        }
      };
      window.addEventListener("keydown", keyHandler);
    },

    destroy: function () {
      if (galleryTimer) { clearInterval(galleryTimer); galleryTimer = null; }
      if (keyHandler) { window.removeEventListener("keydown", keyHandler); keyHandler = null; }
      hoverAgent = null;
      selectedAgent = null;
      root = null;
    }
  };
})(window.HG);
