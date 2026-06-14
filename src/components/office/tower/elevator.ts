// @ts-nocheck
/* CLAUDE Agent Floor — the elevator: one car, five floors, FCFS-ish sweep.
 * Agents call requestStop() while waiting; board/exit when isOpenAt(floor). */
window.HG = window.HG || {};

(function (HG) {
  "use strict";

  var SPEED = 1.1;          // floors per second
  var OPEN_T = 0.5;         // door open/close duration
  var HOLD_T = 1.6;         // time doors stay open

  var car = 0;              // float floor position
  var stops = {};           // floor -> true
  var state = "idle";       // idle | moving | opening | open | closing
  var doorAmt = 0;          // 0 closed .. 1 open
  var holdUntil = 0;
  var target = null;
  var clock = 0;

  function nearestStop() {
    var best = null, bestD = 1e9;
    for (var k in stops) {
      var d = Math.abs(car - k);
      if (d < bestD) { bestD = d; best = parseInt(k, 10); }
    }
    return best;
  }

  HG.Elevator = {
    reset: function () { car = 0; stops = {}; state = "idle"; doorAmt = 0; target = null; },

    carPos: function () { return car; },
    state: function () { return state; },

    requestStop: function (floor) { stops[floor] = true; },

    isOpenAt: function (floor) {
      return state === "open" && Math.round(car) === floor;
    },

    doorAmount: function (floor) {
      return (Math.round(car) === floor && Math.abs(car - Math.round(car)) < 0.02) ? doorAmt : 0;
    },

    riders: function () {
      var out = [];
      var list = HG.Agents ? HG.Agents.list : [];
      for (var i = 0; i < list.length; i++) if (list[i].riding) out.push(list[i]);
      return out;
    },

    update: function (dt, t) {
      clock = t;
      switch (state) {
        case "idle":
          target = nearestStop();
          if (target !== null) {
            state = (Math.abs(car - target) < 0.01) ? "opening" : "moving";
          }
          break;
        case "moving":
          target = nearestStop();
          if (target === null) { state = "idle"; break; }
          var dir = target > car ? 1 : -1;
          car += dir * SPEED * dt;
          if ((dir > 0 && car >= target) || (dir < 0 && car <= target)) {
            car = target;
            state = "opening";
          }
          break;
        case "opening":
          doorAmt = Math.min(1, doorAmt + dt / OPEN_T);
          if (doorAmt >= 1) { state = "open"; holdUntil = t + HOLD_T; }
          break;
        case "open":
          if (t > holdUntil) {
            delete stops[Math.round(car)];
            state = "closing";
          }
          break;
        case "closing":
          doorAmt = Math.max(0, doorAmt - dt / OPEN_T);
          if (doorAmt <= 0) state = "idle";
          break;
      }
      // riders track the car
      var rs = this.riders();
      for (var i = 0; i < rs.length; i++) {
        rs[i].floor = Math.round(car);
      }
    }
  };
})(window.HG);
