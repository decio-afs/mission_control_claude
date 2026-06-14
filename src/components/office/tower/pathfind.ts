// @ts-nocheck
/* CLAUDE Agent Floor — A* pathfinding on a floor's obstacle grid */
window.HG = window.HG || {};

(function (HG) {
  "use strict";

  var CELL = HG.CELL;

  function key(x, y) { return y * 1024 + x; }

  // A* with diagonal moves; returns array of pixel waypoints or null
  function findPath(floorIdx, px0, py0, px1, py1) {
    var blocked = function (cx, cy) { return HG.Floors.isBlocked(floorIdx, cx, cy); };
    var sx = Math.floor(px0 / CELL), sy = Math.floor(py0 / CELL);
    var tx = Math.floor(px1 / CELL), ty = Math.floor(py1 / CELL);

    var s = nearestOpen(blocked, sx, sy), t = nearestOpen(blocked, tx, ty);
    if (!s || !t) return null;
    sx = s[0]; sy = s[1]; tx = t[0]; ty = t[1];

    var open = [{ x: sx, y: sy, g: 0, f: 0 }];
    var came = {}, gScore = {};
    gScore[key(sx, sy)] = 0;
    var closed = {};
    var iter = 0;

    while (open.length && iter++ < 6000) {
      var bi = 0;
      for (var i = 1; i < open.length; i++) if (open[i].f < open[bi].f) bi = i;
      var cur = open.splice(bi, 1)[0];
      var ck = key(cur.x, cur.y);
      if (closed[ck]) continue;
      closed[ck] = true;

      if (cur.x === tx && cur.y === ty) {
        var path = [];
        var k = ck;
        var node = [cur.x, cur.y];
        while (node) {
          path.push([node[0] * CELL + CELL / 2, node[1] * CELL + CELL / 2]);
          node = came[k];
          if (node) k = key(node[0], node[1]);
        }
        path.reverse();
        return smooth(blocked, path);
      }

      var dirs = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
      for (var d = 0; d < dirs.length; d++) {
        var nx = cur.x + dirs[d][0], ny = cur.y + dirs[d][1];
        if (blocked(nx, ny)) continue;
        if (dirs[d][0] !== 0 && dirs[d][1] !== 0) {
          if (blocked(cur.x + dirs[d][0], cur.y) || blocked(cur.x, cur.y + dirs[d][1])) continue;
        }
        var nk = key(nx, ny);
        if (closed[nk]) continue;
        var cost = (dirs[d][0] !== 0 && dirs[d][1] !== 0) ? 1.41 : 1;
        var g = cur.g + cost;
        if (gScore[nk] === undefined || g < gScore[nk]) {
          gScore[nk] = g;
          came[nk] = [cur.x, cur.y];
          open.push({ x: nx, y: ny, g: g, f: g + Math.abs(nx - tx) + Math.abs(ny - ty) });
        }
      }
    }
    return null;
  }

  function nearestOpen(blocked, cx, cy) {
    if (!blocked(cx, cy)) return [cx, cy];
    for (var r = 1; r < 14; r++) {
      for (var dy = -r; dy <= r; dy++) {
        for (var dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          if (!blocked(cx + dx, cy + dy)) return [cx + dx, cy + dy];
        }
      }
    }
    return null;
  }

  function smooth(blocked, path) {
    if (path.length <= 2) return path;
    var out = [path[0]];
    var anchor = 0;
    for (var i = 2; i < path.length; i++) {
      if (!clearLine(blocked, path[anchor][0], path[anchor][1], path[i][0], path[i][1])) {
        out.push(path[i - 1]);
        anchor = i - 1;
      }
    }
    out.push(path[path.length - 1]);
    return out;
  }

  function clearLine(blocked, x0, y0, x1, y1) {
    var dist = Math.hypot(x1 - x0, y1 - y0);
    var steps = Math.ceil(dist / (CELL / 2));
    for (var i = 0; i <= steps; i++) {
      var t = i / steps;
      if (blocked(Math.floor((x0 + (x1 - x0) * t) / CELL), Math.floor((y0 + (y1 - y0) * t) / CELL))) return false;
    }
    return true;
  }

  HG.Path = { find: findPath };
})(window.HG);
