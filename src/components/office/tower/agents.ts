// @ts-nocheck
/* CLAUDE Agent Floor — agent entities: idle life across 5 floors,
 * elevator travel, dispatch to OPS workstations. */
window.HG = window.HG || {};

(function (HG) {
  "use strict";

  var IDLE_SPEED = 20;
  var RUSH_SPEED = 54;
  var OPS = 4;
  var agents = [];
  var ELE = null;   // HG.Props.ELE bound at init

  function Agent(castDef, index) {
    this.cast = castDef;
    this.index = index;
    this.deskIndex = index % Math.max(1, HG.Floors.desks.length);
    this.skin = HG.skinById(HG.DEFAULT_SKINS[index] || "medic");
    this.floor = 0;                       // everyone starts in the lounge
    // Spawn grid wraps so any roster size stays inside the lounge floor
    // (the original fixed cast of 12 never exceeded two rows).
    this.x = 116 + (index % 6) * 40 + ((Math.floor(index / 18) * 7) % 20);
    this.y = 180 + (Math.floor(index / 6) % 3) * 36;
    this.path = null;
    this.pathI = 0;
    this.speed = IDLE_SPEED;
    this.facing = "down";
    this.pose = "idle";
    this.frame = 0;
    this.frameT = Math.random();
    this.mode = "pause";
    this.modeUntil = 1 + Math.random() * 4;
    this.poi = null;
    this.pending = null;                  // cross-floor travel target
    this.riding = false;
    this.chatPartner = null;
    this.chatSpot = null;
    this.bubble = null;
    this.status = "idle";
    this.task = "";
    this.inPod = -1;
    this.clock = 0;
  }

  Agent.prototype.say = function (glyph, color, dur) {
    this.bubble = { glyph: glyph, color: color || "#e8f0ff", until: this.clock + (dur || 1.6) };
  };

  Agent.prototype.releasePoi = function () {
    if (this.poi) { this.poi.occupiedBy = null; this.poi = null; }
    this.inPod = -1;
  };

  Agent.prototype.endChat = function () {
    if (this.chatSpot && this.chatSpot.occupiedBy === this) this.chatSpot.occupiedBy = null;
    if (this.chatPartner) {
      var p = this.chatPartner;
      this.chatPartner = null;
      if (p.chatPartner === this) { p.chatPartner = null; p.setPause(0.5); }
    }
    this.chatSpot = null;
  };

  Agent.prototype.setPause = function (dur) {
    this.mode = "pause";
    this.pose = "idle";
    this.path = null;
    this.modeUntil = this.clock + (dur || (1 + Math.random() * 2.5));
  };

  // same-floor walk
  Agent.prototype.goTo = function (tx, ty, speed, nextMode) {
    var path = HG.Path.find(this.floor, this.x, this.y, tx, ty);
    this.speed = speed;
    this.nextMode = nextMode;
    if (!path || path.length === 0) { this.setPause(1); return false; }
    path.push([tx, ty]);
    this.path = path;
    this.pathI = 0;
    this.mode = "move";
    this.pose = "walk";
    return true;
  };

  // cross-floor travel via elevator
  Agent.prototype.travel = function (floorIdx, tx, ty, speed, nextMode) {
    if (floorIdx === this.floor) { this.goTo(tx, ty, speed, nextMode); return; }
    this.pending = { floor: floorIdx, x: tx, y: ty, speed: speed, nextMode: nextMode };
    this.goTo(ELE.standX, ELE.standY, speed, "waitElevator");
  };

  /* ------------------------- idle decisions ------------------------- */

  var POI_WEIGHT = { coffee: 3, sofa: 3, pod: 2, fun: 2.4, vending: 1.4, inspect: 2, watch: 2, tinker: 2.2, terminal: 1.8, console: 1.8, patrol: 1.6, chat: 0 };

  Agent.prototype.chooseActivity = function () {
    if (Math.random() < 0.22) {
      var partner = findChatPartner(this);
      if (partner) { startChat(this, partner); return; }
    }

    var pois = HG.Floors.allPois();
    var options = [];
    for (var i = 0; i < pois.length; i++) {
      var p = pois[i];
      var w = POI_WEIGHT[p.type];
      if (p.occupiedBy || !w) continue;
      if (p.floor !== this.floor) w *= 0.45;          // prefer staying, but roam floors
      options.push({ poi: p, w: w });
    }
    options.push({ poi: null, w: 2.2 });               // wander current floor

    var total = 0;
    for (var o = 0; o < options.length; o++) total += options[o].w;
    var roll = Math.random() * total;
    var pick = options[0];
    for (var o2 = 0; o2 < options.length; o2++) {
      roll -= options[o2].w;
      if (roll <= 0) { pick = options[o2]; break; }
    }

    if (!pick.poi) {
      var tx, ty, tries = 0;
      do {
        tx = 30 + Math.random() * (HG.VIEW_W - 80);
        ty = HG.Floors.WALL_Y + 20 + Math.random() * (HG.VIEW_H - HG.Floors.WALL_Y - 40);
        tries++;
      } while (HG.Floors.isBlocked(this.floor, Math.floor(tx / HG.CELL), Math.floor(ty / HG.CELL)) && tries < 20);
      this.goTo(tx, ty, IDLE_SPEED, "pauseShort");
      return;
    }

    pick.poi.occupiedBy = this;
    this.poi = pick.poi;
    this.travel(pick.poi.floor, pick.poi.x, pick.poi.y, IDLE_SPEED, "arrivePoi");
  };

  function findChatPartner(me) {
    var best = null, bestD = 1e9;
    for (var i = 0; i < agents.length; i++) {
      var a = agents[i];
      if (a === me || a.chatPartner || a.floor !== me.floor || a.riding) continue;
      if (a.mode !== "pause" && a.mode !== "move" && a.mode !== "atPoi") continue;
      if (a.status !== "idle") continue;
      if (a.mode === "atPoi" && a.poi && a.poi.type === "pod") continue;
      if (a.mode === "move" && a.nextMode === "waitElevator") continue;
      var d = Math.hypot(a.x - me.x, a.y - me.y);
      if (d < bestD) { bestD = d; best = a; }
    }
    return best;
  }

  function startChat(a, b) {
    var spot = null;
    var pois = HG.Floors.get(a.floor).pois;
    for (var i = 0; i < pois.length; i++) {
      if (pois[i].type === "chat" && !pois[i].occupiedBy) { spot = pois[i]; break; }
    }
    var cx = spot ? spot.x : (a.x + b.x) / 2;
    var cy = spot ? spot.y : (a.y + b.y) / 2;
    if (spot) spot.occupiedBy = a;

    a.releasePoi(); b.releasePoi();
    a.chatPartner = b; b.chatPartner = a;
    a.chatSpot = spot; b.chatSpot = spot;
    a.goTo(cx - 9, cy, IDLE_SPEED, "chatWait");
    b.goTo(cx + 9, cy, IDLE_SPEED, "chatWait");
  }

  /* --------------------------- update ------------------------------- */

  var CHAT_GLYPHS = ["!", "?", "..", "<>", "#", "♪"];

  Agent.prototype.update = function (dt, t) {
    this.clock = t;
    this.frameT += dt;

    var rate = (this.pose === "walk") ? 0.12 : 0.45;
    if (this.frameT > rate) {
      this.frameT = 0;
      this.frame = (this.frame + 1) % ((this.pose === "walk") ? 4 : 2);
    }
    if (this.bubble && t > this.bubble.until) this.bubble = null;

    switch (this.mode) {
      case "move": this.stepPath(dt); break;

      case "pause":
        this.pose = "idle";
        if (t > this.modeUntil && this.status === "idle") this.chooseActivity();
        break;

      case "waitElevator":
        this.pose = "idle";
        this.facing = "up";
        HG.Elevator.requestStop(this.floor);
        if (HG.Elevator.isOpenAt(this.floor)) {
          this.riding = true;
          this.mode = "riding";
          if (this.pending) HG.Elevator.requestStop(this.pending.floor);
        }
        break;

      case "riding":
        if (!this.pending) { // shouldn't happen; bail out at next stop
          if (HG.Elevator.doorAmount(this.floor) > 0.9) { this.riding = false; this.exitElevator(); this.setPause(0.5); }
          break;
        }
        if (HG.Elevator.isOpenAt(this.pending.floor)) {
          this.riding = false;
          this.floor = this.pending.floor;
          this.exitElevator();
          var pd = this.pending;
          this.pending = null;
          this.goTo(pd.x, pd.y, pd.speed, pd.nextMode);
        }
        break;

      case "atPoi":
        this.runPoiActivity(t);
        if (t > this.modeUntil) {
          this.releasePoi();
          this.setPause();
        }
        break;

      case "chatWait":
        this.pose = "idle";
        this.faceToward(this.chatPartner);
        if (!this.chatPartner) { this.setPause(0.5); break; }
        if (this.chatPartner.mode === "chatWait") {
          this.mode = "chatting";
          this.modeUntil = t + 4 + Math.random() * 5;
          this.nextLine = t + Math.random();
        }
        break;

      case "chatting":
        if (!this.chatPartner) { this.setPause(0.5); break; }
        this.faceToward(this.chatPartner);
        this.pose = (this.bubble && (this.facing === "left" || this.facing === "right")) ? "point" : "idle";
        if (t > this.nextLine) {
          this.say(CHAT_GLYPHS[Math.floor(Math.random() * CHAT_GLYPHS.length)], "#cfe2ff", 1.4);
          this.nextLine = t + 1.6 + Math.random() * 1.6;
        }
        if (t > this.modeUntil) {
          this.endChat();
          this.setPause(0.5);
        }
        break;

      case "working": {
        var desk = HG.Floors.desks[this.deskIndex];
        this.x = desk.seat.x; this.y = desk.seat.y;
        this.facing = "up";
        this.pose = "type";
        if (Math.random() < dt * 0.12) this.say("#", "#9ef0a0", 1.2);
        break;
      }

      case "error":
        this.pose = "idle";
        this.facing = "down";
        if (Math.random() < dt * 0.8) this.say("✗", "#ff5c7a", 1.0);
        break;

      case "celebrate":
        this.pose = "celebrate";
        if (t > this.modeUntil) {
          HG.Floors.desks[this.deskIndex].active = false;
          this.setPause(0.8);
        }
        break;
    }
  };

  Agent.prototype.exitElevator = function () {
    this.x = ELE.standX + (Math.random() * 8 - 4);
    this.y = ELE.standY + 2;
    this.facing = "down";
  };

  Agent.prototype.faceToward = function (other) {
    if (!other) return;
    var dx = other.x - this.x, dy = other.y - this.y;
    if (Math.abs(dx) > Math.abs(dy)) this.facing = dx > 0 ? "right" : "left";
    else this.facing = dy > 0 ? "down" : "up";
  };

  Agent.prototype.stepPath = function (dt) {
    if (!this.path || this.pathI >= this.path.length) { this.arrive(); return; }
    var wp = this.path[this.pathI];
    var dx = wp[0] - this.x, dy = wp[1] - this.y;
    var d = Math.hypot(dx, dy);
    var step = this.speed * dt;
    if (d <= step) {
      this.x = wp[0]; this.y = wp[1];
      this.pathI++;
      if (this.pathI >= this.path.length) this.arrive();
      return;
    }
    this.x += (dx / d) * step;
    this.y += (dy / d) * step;
    this.pose = "walk";
    if (Math.abs(dx) > Math.abs(dy)) this.facing = dx > 0 ? "right" : "left";
    else this.facing = dy > 0 ? "down" : "up";
  };

  Agent.prototype.arrive = function () {
    this.path = null;
    var nm = this.nextMode;
    this.nextMode = null;

    if (nm === "waitElevator") {
      this.mode = "waitElevator";
    } else if (nm === "arrivePoi" && this.poi) {
      this.mode = "atPoi";
      this.facing = this.poi.facing;
      this.modeUntil = this.clock + 5 + Math.random() * 8;
      if (this.poi.type === "pod") {
        var pods = HG.Floors.pods;
        for (var i = 0; i < pods.length; i++) {
          if (Math.abs(pods[i].x + pods[i].w / 2 - this.poi.x) < 4) {
            this.inPod = i;
            this.x = pods[i].x + pods[i].w / 2;
            this.y = pods[i].y + pods[i].h - 2;
            this.modeUntil = this.clock + 8 + Math.random() * 8;
          }
        }
      }
    } else if (nm === "chatWait") {
      this.mode = "chatWait";
    } else if (nm === "sitDesk") {
      var desk = HG.Floors.desks[this.deskIndex];
      this.x = desk.seat.x; this.y = desk.seat.y;
      this.mode = (this.status === "error") ? "error" : "working";
      if (this.mode === "working") {
        desk.active = true;
        HG.Orchestrator.dispatchTo(this);
      }
      this.say("⚙", "#ffd75c", 1.4);
    } else {
      this.setPause();
    }
  };

  Agent.prototype.runPoiActivity = function (t) {
    var type = this.poi ? this.poi.type : "";
    switch (type) {
      case "coffee":
        if (Math.floor(t / 3) % 2 === 0) { this.pose = "sit"; this.facing = "up"; }
        else { this.pose = "drink"; this.facing = "down"; }
        break;
      case "sofa":
        this.pose = "sitFront"; this.facing = "down";
        if (Math.random() < 0.004) this.say("♪", "#9ad7ff", 1.6);
        break;
      case "pod":
        this.pose = "recharge"; this.facing = "down";
        if (Math.random() < 0.005) this.say("z", "#7ae0c0", 1.6);
        break;
      case "fun":
        this.pose = "idle"; this.facing = this.poi.facing;
        if (Math.random() < 0.008) this.say(Math.random() < 0.5 ? "!" : "♪", "#ff9ad0", 1.2);
        break;
      case "vending":
        this.pose = (Math.floor(t / 2.5) % 2 === 0) ? "idle" : "drink";
        this.facing = (this.pose === "drink") ? "down" : "up";
        break;
      case "tinker":
        this.pose = (Math.floor(t / 1.6) % 2 === 0) ? "point" : "idle";
        this.facing = (this.pose === "point") ? (Math.random() < 0.5 ? "right" : "left") : this.poi.facing;
        if (Math.random() < 0.007) this.say("⚙", "#9ef0a0", 1.4);
        break;
      case "terminal":
      case "console":
        this.pose = "sit"; this.facing = "up";
        if (Math.random() < 0.005) this.say("#", "#9ef0a0", 1.2);
        break;
      case "watch":
      case "inspect":
      case "patrol":
        this.pose = (Math.floor(t / 2) % 3 === 0) ? "point" : "idle";
        this.facing = this.poi.facing;
        if (Math.random() < 0.006) this.say(Math.random() < 0.5 ? "?" : "⚙", "#9ec8f0", 1.4);
        break;
      default:
        this.pose = "idle";
        if (this.poi) this.facing = this.poi.facing;
    }
  };

  /* ------------------- external status transitions ------------------- */

  Agent.prototype.applyStatus = function (status, task) {
    var prev = this.status;
    this.status = status;
    this.task = task || "";
    if (status === prev) return;

    if (status === "working" || status === "error") {
      if (this.mode === "working" || this.mode === "error") {
        this.mode = (status === "error") ? "error" : "working";
        HG.Floors.desks[this.deskIndex].active = status === "working";
        return;
      }
      this.releasePoi();
      this.endChat();
      this.say("!", "#ffd75c", 1.2);
      HG.Orchestrator.flare();
      var desk = HG.Floors.desks[this.deskIndex];
      this.travel(OPS, desk.seat.x, desk.seat.y + 6, RUSH_SPEED, "sitDesk");
    } else {
      if (prev === "working" || prev === "error" || this.mode === "working" || this.mode === "error") {
        this.mode = "celebrate";
        this.pose = "celebrate";
        this.facing = "down";
        this.modeUntil = this.clock + 1.6;
        this.say("✓", "#7af79a", 1.6);
      }
    }
  };

  /* ----------------------------- render ------------------------------ */

  function drawBubble(ctx, a) {
    if (!a.bubble) return;
    var bx = Math.round(a.x), by = Math.round(a.y - HG.Sprites.H - 7);
    ctx.font = "7px monospace";
    var tw = Math.max(7, ctx.measureText(a.bubble.glyph).width + 4);
    ctx.fillStyle = "rgba(10,14,24,0.85)";
    ctx.fillRect(bx - tw / 2, by - 4, tw, 9);
    ctx.fillStyle = "#3a4a6a";
    ctx.fillRect(bx - tw / 2, by - 4, tw, 1);
    ctx.fillRect(bx - tw / 2, by + 4, tw, 1);
    ctx.fillRect(bx - tw / 2 - 1, by - 3, 1, 7);
    ctx.fillRect(bx + tw / 2, by - 3, 1, 7);
    ctx.fillRect(bx - 1, by + 5, 2, 2);
    ctx.fillStyle = a.bubble.color;
    ctx.textBaseline = "top";
    ctx.fillText(a.bubble.glyph, bx - (tw - 4) / 2, by - 2);
  }

  HG.Agents = {
    list: agents,

    init: function () {
      agents.length = 0;
      ELE = HG.Props.ELE;
      for (var i = 0; i < HG.CAST.length; i++) {
        agents.push(new Agent(HG.CAST[i], i));
      }
      // restore saved skins
      try {
        var saved = JSON.parse(localStorage.getItem("mc_skins") || "{}");
        for (var j = 0; j < agents.length; j++) {
          if (saved[agents[j].cast.id]) agents[j].skin = HG.skinById(saved[agents[j].cast.id]);
        }
      } catch (e) { /* ignore */ }
    },

    setSkin: function (agent, skinId) {
      agent.skin = HG.skinById(skinId);
      try {
        var saved = JSON.parse(localStorage.getItem("mc_skins") || "{}");
        saved[agent.cast.id] = skinId;
        localStorage.setItem("mc_skins", JSON.stringify(saved));
      } catch (e) { /* ignore */ }
    },

    update: function (dt, t) {
      for (var i = 0; i < agents.length; i++) agents[i].update(dt, t);
    },

    applyStatus: function (list) {
      for (var i = 0; i < list.length; i++) {
        var row = list[i];
        for (var j = 0; j < agents.length; j++) {
          if (agents[j].cast.id === row.id) {
            var st = row.status === "done" ? "idle" : row.status;
            if (agents[j].status !== st) agents[j].applyStatus(st, row.task);
            else agents[j].task = row.task || agents[j].task;
            break;
          }
        }
      }
    },

    podOccupancy: function () {
      var occ = [false, false, false];
      for (var i = 0; i < agents.length; i++) {
        if (agents[i].inPod >= 0 && agents[i].mode === "atPoi") occ[agents[i].inPod] = true;
      }
      return occ;
    },

    onFloor: function (floorIdx) {
      var out = [];
      for (var i = 0; i < agents.length; i++) {
        if (agents[i].floor === floorIdx && !agents[i].riding) out.push(agents[i]);
      }
      return out;
    },

    agentAt: function (floorIdx, x, y) {
      var best = null, bestD = 14;
      var list = this.onFloor(floorIdx);
      for (var i = 0; i < list.length; i++) {
        var a = list[i];
        var d = Math.hypot(a.x - x, a.y - (y + HG.Sprites.H / 2));
        if (d < bestD) { bestD = d; best = a; }
      }
      return best;
    },

    draw: function (ctx, t, floorIdx, hoverAgent, selectedAgent) {
      var sorted = this.onFloor(floorIdx).sort(function (a, b) { return a.y - b.y; });
      for (var i = 0; i < sorted.length; i++) {
        var a = sorted[i];
        if (a.inPod < 0) {
          ctx.fillStyle = "rgba(0,0,0,0.30)";
          ctx.fillRect(Math.round(a.x - 5), Math.round(a.y - 1), 10, 2);
        }
        HG.Sprites.draw(ctx, a.skin, a.pose, a.facing, a.frame, a.x, a.y);
        if (a.mode === "working") {
          ctx.fillStyle = "rgba(57,231,95," + (0.18 + 0.1 * Math.sin(t * 6 + i)) + ")";
          ctx.fillRect(Math.round(a.x - 8), Math.round(a.y - HG.Sprites.H - 1), 16, 2);
        }
      }
      for (var k = 0; k < sorted.length; k++) {
        var ag = sorted[k];
        drawBubble(ctx, ag);
        var labeled = ag === hoverAgent || ag === selectedAgent || ag.mode === "working" || ag.mode === "error";
        if (labeled) {
          ctx.font = "6px monospace";
          ctx.textBaseline = "top";
          var name = ag.cast.name;
          var nw = ctx.measureText(name).width;
          var nx = Math.round(ag.x - nw / 2), ny = Math.round(ag.y - HG.Sprites.H - (ag.bubble ? 14 : 8));
          ctx.fillStyle = "rgba(8,10,20,0.7)";
          ctx.fillRect(nx - 2, ny - 1, nw + 4, 7);
          ctx.fillStyle = ag.mode === "error" ? "#ff7a92" : (ag.mode === "working" ? "#ffd75c" : "#7ad7ff");
          ctx.fillText(name, nx, ny);
        }
      }
    }
  };
})(window.HG);
