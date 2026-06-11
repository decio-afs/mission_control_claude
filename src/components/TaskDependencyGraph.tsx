// Task Dependency Map — a visual, navigable graph of the parent→child dependency
// DAG around a task. The TaskDetailDrawer already lists a task's *immediate*
// parents/children as a flat link list; this surfaces the wider chain: it BFS-
// expands the connected dependency neighborhood (bounded depth + node budget),
// lays the tasks out in topological columns (ancestors left → descendants right),
// draws status-coloured nodes with bezier dependency edges, and lets you walk the
// graph by re-centering on any node. Pure client aggregation of getHermesTaskDetail
// (which already returns parents + children) — no new bridge endpoint.
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useTaskStore } from '../stores/useTaskStore';
import type { HermesTask, TaskDetail } from '../lib/api';
import { getHermesTaskDetail } from '../lib/api';

// expansion bounds — keeps live-bridge fetches (each shells out to the CLI) sane
const MAX_DEPTH = 2; // levels traversed each direction (up = parents, down = children)
const MAX_NODES = 28;

// layout geometry (px)
const NODE_W = 168;
const NODE_H = 60;
const COL_GAP = 52;
const ROW_GAP = 16;

const STATUS_COLOR: Record<string, string> = {
  done: '#34d399', running: '#fbbf24', review: '#38bdf8', ready: '#38bdf8',
  blocked: '#f87171', failed: '#f87171', scheduled: '#9aa3b5',
  todo: '#9aa3b5', triage: '#a78bfa',
};
const colorOf = (s?: string) => STATUS_COLOR[s ?? ''] ?? '#545454';

interface GraphNode { id: string; depth: number; task: HermesTask | null }

export default function TaskDependencyGraph({ rootId, onClose, onOpenTask }: {
  rootId: string | null;
  onClose: () => void;
  onOpenTask: (id: string) => void;
}) {
  const hermesTasks = useTaskStore((s) => s.hermesTasks);
  const [centerId, setCenterId] = useState<string | null>(rootId);
  const [details, setDetails] = useState<Map<string, TaskDetail>>(new Map());
  const [depth, setDepth] = useState<Map<string, number>>(new Map());
  const [loading, setLoading] = useState(false);
  const [truncated, setTruncated] = useState(false);

  // Re-seed the center whenever the drawer hands us a fresh root.
  useEffect(() => { setCenterId(rootId); }, [rootId]);

  const metaOf = useCallback(
    (id: string): HermesTask | null => details.get(id)?.task ?? hermesTasks.find((t) => t.id === id) ?? null,
    [details, hermesTasks],
  );

  // Bounded bidirectional BFS from the center. Parents push depth-1, children
  // depth+1; first assignment wins (stable in a DAG). Each ring fetches in
  // parallel and caches, so re-centering on an already-seen node is cheap.
  // `cancelled` guards a stale center's writes when the user re-centers fast.
  useEffect(() => {
    if (!centerId) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      const cache = new Map(details);
      const depths = new Map<string, number>([[centerId, 0]]);
      let frontier = [centerId];
      let truncatedHit = false;
      const fetchDetail = async (id: string) => {
        if (cache.has(id)) return cache.get(id)!;
        const d = await getHermesTaskDetail(id).catch(() => null);
        if (d) cache.set(id, d);
        return d;
      };
      for (let ring = 0; ring <= MAX_DEPTH && frontier.length; ring++) {
        const fetched = await Promise.all(frontier.map(fetchDetail));
        if (cancelled) return;
        const next: string[] = [];
        fetched.forEach((d, i) => {
          if (!d) return;
          const here = depths.get(frontier[i])!;
          const consider = (nid: string, nd: number) => {
            if (Math.abs(nd) > MAX_DEPTH || depths.has(nid)) return;
            if (depths.size >= MAX_NODES) { truncatedHit = true; return; }
            depths.set(nid, nd);
            next.push(nid);
          };
          d.parents.forEach((p) => consider(p, here - 1));
          d.children.forEach((c) => consider(c, here + 1));
        });
        frontier = next;
      }
      if (cancelled) return;
      setDetails(cache);
      setDepth(depths);
      setTruncated(truncatedHit);
      setLoading(false);
    })();
    return () => { cancelled = true; };
    // `details` intentionally omitted — this effect owns the BFS for `centerId`
    // and seeds from the latest cache at run time; re-running on cache writes
    // would loop. Re-centering changes `centerId` and re-fetches as needed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [centerId]);

  // Esc closes
  useEffect(() => {
    if (!rootId) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [rootId, onClose]);

  // Column/row layout from the depth map.
  const layout = useMemo(() => {
    const nodes: GraphNode[] = [...depth.entries()].map(([id, d]) => ({ id, depth: d, task: metaOf(id) }));
    const depthsSorted = [...new Set(nodes.map((n) => n.depth))].sort((a, b) => a - b);
    const colIndex = new Map(depthsSorted.map((d, i) => [d, i]));
    const byCol = new Map<number, GraphNode[]>();
    nodes.forEach((n) => {
      const ci = colIndex.get(n.depth)!;
      if (!byCol.has(ci)) byCol.set(ci, []);
      byCol.get(ci)!.push(n);
    });
    // stable in-column order: id sort
    byCol.forEach((arr) => arr.sort((a, b) => a.id.localeCompare(b.id)));
    const pos = new Map<string, { x: number; y: number; col: number; row: number }>();
    let maxRows = 0;
    byCol.forEach((arr, ci) => {
      maxRows = Math.max(maxRows, arr.length);
      arr.forEach((n, ri) => pos.set(n.id, { x: ci * (NODE_W + COL_GAP), y: ri * (NODE_H + ROW_GAP), col: ci, row: ri }));
    });
    // vertically center each column relative to the tallest
    byCol.forEach((arr, ci) => {
      const offset = ((maxRows - arr.length) * (NODE_H + ROW_GAP)) / 2;
      arr.forEach((n) => { const p = pos.get(n.id)!; p.y += offset; void ci; });
    });
    // edges: parent → child where both are in the node set
    const edges: { from: string; to: string }[] = [];
    nodes.forEach((n) => {
      const d = details.get(n.id);
      if (!d) return;
      d.children.forEach((c) => { if (pos.has(c)) edges.push({ from: n.id, to: c }); });
    });
    const width = Math.max(1, depthsSorted.length) * (NODE_W + COL_GAP) - COL_GAP;
    const height = Math.max(1, maxRows) * (NODE_H + ROW_GAP) - ROW_GAP;
    return { nodes, pos, edges, width, height, depthsSorted };
  }, [depth, details, metaOf]);

  if (!rootId) return null;

  const center = centerId ? metaOf(centerId) : null;
  const noDeps = !loading && layout.nodes.length <= 1;
  const counts = layout.nodes.reduce<Record<string, number>>((acc, n) => {
    const k = (n.task?.status ?? 'unknown');
    acc[k] = (acc[k] || 0) + 1;
    return acc;
  }, {});

  return (
    <>
      <div className="fixed inset-0 z-[7000] bg-black/75 backdrop-blur-[3px]" onClick={onClose} />
      <div className="fixed inset-0 z-[7001] flex items-center justify-center p-4 pointer-events-none">
        <div className="pointer-events-auto w-full max-w-[1100px] h-[82vh] bg-[#0A0A0A] border border-white/12 shadow-2xl flex flex-col">
          {/* header */}
          <div className="shrink-0 h-[44px] px-4 flex items-center justify-between border-b border-white/10 bg-[#080808]">
            <div className="flex items-center gap-3 min-w-0">
              <span className="font-mono text-[11px] tracking-[0.2em] uppercase text-[#f64e6e] font-bold">⊞ Dependency Map</span>
              <span className="font-mono text-[10px] text-[#545454] truncate hidden sm:inline">{center?.title ?? rootId}</span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {centerId !== rootId && (
                <button onClick={() => setCenterId(rootId)}
                  className="font-mono text-[10px] tracking-[0.1em] px-2 py-1 border border-white/15 text-[#b8b8b8] hover:border-[#f64e6e] hover:text-[#f64e6e]">↺ RECENTER</button>
              )}
              <button onClick={onClose} className="text-[#545454] hover:text-white text-[11px] font-mono">✕ ESC</button>
            </div>
          </div>

          {/* legend */}
          <div className="shrink-0 px-4 py-2 flex items-center gap-x-4 gap-y-1 flex-wrap border-b border-white/[0.06] text-[10px] font-mono text-[#545454]">
            <span className="tracking-[0.16em] uppercase">{layout.nodes.length} TASKS · {layout.edges.length} LINKS · {layout.depthsSorted.length} LEVELS</span>
            {Object.entries(counts).map(([s, n]) => (
              <span key={s} className="inline-flex items-center gap-1">
                <i className="inline-block w-2 h-2 rounded-full" style={{ background: colorOf(s) }} />
                {s.toUpperCase()} {n}
              </span>
            ))}
            {truncated && <span className="text-amber-400">⚠ truncated at {MAX_NODES} nodes</span>}
            <span className="ml-auto text-[#363636]">click a node to re-center · ↗ opens it in the drawer</span>
          </div>

          {/* canvas */}
          <div className="flex-1 min-h-0 overflow-auto p-8 bg-[#050505]">
            {loading && layout.nodes.length === 0 && (
              <div className="h-full flex items-center justify-center font-mono text-[11px] text-[#545454]">tracing dependency chain…</div>
            )}
            {noDeps && (
              <div className="h-full flex flex-col items-center justify-center gap-2 font-mono text-[11px] text-[#545454]">
                <span className="text-2xl opacity-30">⊘</span>
                <span>This task has no linked dependencies.</span>
                <span className="text-[10px] text-[#363636]">Link parents/children from the drawer's DEPENDENCIES section.</span>
              </div>
            )}
            {!noDeps && layout.nodes.length > 0 && (
              <div className="relative mx-auto" style={{ width: layout.width, height: layout.height }}>
                {/* edge layer */}
                <svg className="absolute inset-0 pointer-events-none" width={layout.width} height={layout.height} style={{ overflow: 'visible' }}>
                  <defs>
                    <marker id="depArrow" markerWidth="7" markerHeight="7" refX="6" refY="3" orient="auto">
                      <path d="M0,0 L6,3 L0,6 Z" fill="#3a3a3a" />
                    </marker>
                  </defs>
                  {layout.edges.map((e, i) => {
                    const a = layout.pos.get(e.from)!;
                    const b = layout.pos.get(e.to)!;
                    const x1 = a.x + NODE_W, y1 = a.y + NODE_H / 2;
                    const x2 = b.x, y2 = b.y + NODE_H / 2;
                    const dx = Math.max(28, (x2 - x1) / 2);
                    const touchesCenter = centerId && (e.from === centerId || e.to === centerId);
                    return (
                      <path key={i} d={`M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`}
                        fill="none" stroke={touchesCenter ? '#f64e6e' : '#2a2a2a'} strokeWidth={touchesCenter ? 1.6 : 1}
                        markerEnd="url(#depArrow)" opacity={touchesCenter ? 0.9 : 0.7} />
                    );
                  })}
                </svg>
                {/* node layer */}
                {layout.nodes.map((n) => {
                  const p = layout.pos.get(n.id)!;
                  const isCenter = n.id === centerId;
                  const c = colorOf(n.task?.status);
                  return (
                    <div key={n.id} className="absolute" style={{ left: p.x, top: p.y, width: NODE_W, height: NODE_H }}>
                      <button
                        onClick={() => setCenterId(n.id)}
                        title={n.task?.title || n.id}
                        className={`group w-full h-full text-left px-2.5 py-1.5 border bg-[#0A0A0A] transition-colors overflow-hidden ${isCenter ? 'border-[#f64e6e] ring-1 ring-[#f64e6e]/40' : 'border-white/12 hover:border-white/30'}`}
                        style={{ boxShadow: isCenter ? '0 0 14px rgba(246,78,110,0.25)' : undefined }}
                      >
                        <div className="flex items-center gap-1.5 mb-0.5">
                          <i className="inline-block w-2 h-2 rounded-full shrink-0" style={{ background: c, boxShadow: `0 0 5px ${c}` }} />
                          <span className="font-mono text-[10px] text-[#545454] truncate">{n.id}</span>
                          {isCenter && <span className="ml-auto font-mono text-[10px] tracking-[0.16em] text-[#f64e6e] shrink-0">ROOT</span>}
                          {!isCenter && (
                            <span
                              role="button"
                              tabIndex={0}
                              onClick={(ev) => { ev.stopPropagation(); onOpenTask(n.id); onClose(); }}
                              onKeyDown={(ev) => { if (ev.key === 'Enter') { ev.stopPropagation(); onOpenTask(n.id); onClose(); } }}
                              title="Open this task in the drawer"
                              className="ml-auto font-mono text-[11px] leading-none text-[#545454] hover:text-[#f64e6e] shrink-0 cursor-pointer"
                            >↗</span>
                          )}
                        </div>
                        <div className="text-[10px] text-[#cdd3df] leading-tight line-clamp-2">{n.task?.title || <span className="text-[#545454] italic">unknown task</span>}</div>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <span className="font-mono text-[10px] uppercase tracking-[0.12em]" style={{ color: c }}>{n.task?.status ?? '—'}</span>
                          {n.task?.assignee && <span className="font-mono text-[10px] text-[#545454] truncate">· {n.task.assignee}</span>}
                        </div>
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
