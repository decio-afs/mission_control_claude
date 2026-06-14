// @ts-nocheck
/* CLAUDE Agent Floor — the orchestrator orb (lives on the OPS floor),
 * pulses with workload, fires dispatch beams at arriving agents. */
window.HG = window.HG || {};

(function (HG) {
  "use strict";

  var POS = { x: 95, y: 195 };   // open lower-left of the OPS floor
  var SCALE = 1.85;              // drawn larger than the desk-side props
  var beams = [];
  var flareUntil = 0;
  var clock = 0;
  // Smoothed activity level (0..1) the orb renders with. Driven by whether
  // the operator is talking to the orchestrator (hostActive) and how many
  // agents are working — eased so the orb glides between idle and active.
  var actLevel = 0;
  var hostActive = false;

  HG.Orchestrator = {
    pos: POS,
    FLOOR: 4,

    reset: function () { beams.length = 0; flareUntil = 0; actLevel = 0; hostActive = false; },

    // Host signal: true while a directive is in flight / voice link is open /
    // the orchestrator is otherwise engaged. Makes the orb read as ACTIVE
    // even when no agents happen to be working.
    setActive: function (on) { hostActive = !!on; },

    flare: function () { flareUntil = clock + 1.0; },

    dispatchTo: function (agent) {
      beams.push({
        x0: POS.x, y0: POS.y,
        x1: agent.x, y1: agent.y - HG.Sprites.H / 2,
        t0: clock, dur: 0.55
      });
      flareUntil = clock + 0.9;
    },

    update: function (dt, t) {
      clock = t;
      for (var i = beams.length - 1; i >= 0; i--) {
        if (t - beams[i].t0 > beams[i].dur) beams.splice(i, 1);
      }
      // Ease the activity level toward its target each frame: rise quickly so
      // the orb lights up the instant you engage it, settle more gently back
      // to idle so it doesn't snap dark mid-sentence.
      var working = 0, list = HG.Agents.list;
      for (var w = 0; w < list.length; w++) {
        if (list[w].mode === "working" || (list[w].status === "working" && list[w].mode !== "working")) working++;
      }
      var target = Math.min(1, working / 5);
      if (hostActive || t < flareUntil) target = 1;
      var rate = target > actLevel ? 7 : 2.2;
      actLevel += (target - actLevel) * Math.min(1, dt * rate);
    },

    intensity: function () { return actLevel; },

    // draw on the OPS floor only
    draw: function (ctx, t) {
      for (var b = 0; b < beams.length; b++) {
        var bm = beams[b];
        var p = (t - bm.t0) / bm.dur;
        for (var seg = 0; seg < 5; seg++) {
          var sp = Math.max(0, Math.min(1, p - seg * 0.06));
          var bx = bm.x0 + (bm.x1 - bm.x0) * sp;
          var by = bm.y0 + (bm.y1 - bm.y0) * sp;
          ctx.fillStyle = seg === 0 ? "#ffffff" : "rgba(255,141,160," + (0.8 - seg * 0.15) + ")";
          ctx.fillRect(Math.round(bx), Math.round(by), 2, 2);
        }
      }
      HG.Orb.draw(ctx, POS.x, POS.y, t, this.intensity(t), SCALE);
    }
  };
})(window.HG);
