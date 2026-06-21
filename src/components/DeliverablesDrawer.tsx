// Deliverables drawer — a reachable home for dispatched-agent output.
//
// Dispatched agents are told to write any substantive deliverable to
// deliverables/ or research/ at the repo root, but that output had no UI surface
// (the per-task workspace browser only sees a task's own workspace_path, which
// dispatch does not populate). This modal lists every produced artifact
// newest-first and opens any text file inline, read-only. Honest empty state when
// nothing has been produced yet. All reads are confined by the bridge to the two
// known roots.
//
// Run #62: a FILTER bar. The deliverables drawer is the single reachable home for ALL
// autonomous-agent output, and that output now accumulates faster than a flat scroll can
// serve — 24 files across 14 producing tasks and two roots (deliverables/ + research/) at
// the time of writing, growing every dispatch. Answering "what did task X produce" or
// "show me only research, not the content deliverables" meant eyeballing the whole list.
// This adds two client-side filters over the already-fetched list (zero new endpoint, no
// new poll): root chips (All / deliverables / research, each with a live count) and a
// producing-task selector (every task_id that produced output, with counts, plus an
// "unattributed" bucket for files dispatch wrote without a task_id). Purely a view over the
// same `items` — the newest-first order, the artifact→task jump, and every honest empty
// state are unchanged; a filter that matches nothing shows its own honest "no match" note.
//
// Run #63: a free-text SEARCH box at the top of the filter bar. The root chips answer
// "which root" and the task selector answers "which producing task", but neither finds a
// file by name or extension — at 24+ files (md/json/csv/png, growing every dispatch) you
// still had to eyeball the column to locate "the carousel md" or "all the json". The search
// box is a single case-insensitive substring match over each file's name, its path within
// the root, and its task_id, so typing "carousel", ".json", "csv", or a partial task id all
// narrow the list. It composes with (AND) the root + task filters, shares the same header
// count / "no match" / CLEAR affordances, and — like them — is pure view state over the
// already-fetched `items`: no new endpoint, no new poll, no new dependency.
import { useEffect, useMemo, useState } from 'react';
import { listDeliverables, readDeliverable, deliverableRawUrl, errMessage, type DeliverableEntry, type DeliverableFile } from '../lib/api';

// Media the JSON `/file` endpoint flags as "binary, not shown" but the browser
// can render directly from the raw-bytes endpoint.
const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif']);
const isImage = (ext: string) => IMAGE_EXTS.has((ext || '').toLowerCase());
// PDFs can embed inline straight from the raw-bytes endpoint; other non-image
// binaries (zip, audio, video, …) get open/download links instead.
const isPdf = (ext: string) => (ext || '').toLowerCase() === 'pdf';

function human(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function ago(unixSeconds: number): string {
  const s = Math.max(0, Math.floor(Date.now() / 1000 - unixSeconds));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export default function DeliverablesDrawer({ open, onClose, onOpenTask }: { open: boolean; onClose: () => void; onOpenTask?: (taskId: string) => void }) {
  const [items, setItems] = useState<DeliverableEntry[]>([]);
  const [roots, setRoots] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<DeliverableEntry | null>(null);
  const [file, setFile] = useState<DeliverableFile | null>(null);
  const [fileLoading, setFileLoading] = useState(false);
  const [imgFailed, setImgFailed] = useState(false);
  // Run #64: transient "copied" feedback for the ⎘ COPY PATH toolbar action. Reset on every
  // file open so a stale ✓ never lingers on the next selection.
  const [copied, setCopied] = useState(false);
  // Run #62: active filters over the fetched list. null = no filter (show all). The task
  // filter's special sentinel '__none__' selects the unattributed bucket (files dispatch
  // wrote without a task_id). Both are pure view state — they never refetch.
  const [rootFilter, setRootFilter] = useState<string | null>(null);
  const [taskFilter, setTaskFilter] = useState<string | null>(null);
  // Run #63: free-text search over name / path / task_id (case-insensitive substring).
  const [query, setQuery] = useState('');

  // Run #62: derive the filter facets + the filtered list from the fetched items. Recomputed
  // only when items or a filter changes. Root facets come from the `roots` the bridge reports
  // (so an empty root still shows a 0-count chip); task facets are every distinct producing
  // task_id with its count, ordered by count desc then id for a stable, useful list.
  const NONE = '__none__';
  const rootCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of roots) m.set(r, 0);
    for (const d of items) m.set(d.root, (m.get(d.root) ?? 0) + 1);
    return m;
  }, [items, roots]);
  const taskFacets = useMemo(() => {
    const m = new Map<string, number>();
    let none = 0;
    for (const d of items) {
      if (d.task_id) m.set(d.task_id, (m.get(d.task_id) ?? 0) + 1);
      else none += 1;
    }
    const tasks = [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    return { tasks, none };
  }, [items]);
  // Run #63: the search needle — trimmed + lowercased once, so an all-whitespace query is
  // treated as no filter and the per-item match is a cheap substring test.
  const needle = query.trim().toLowerCase();
  const filtered = useMemo(() => items.filter((d) => {
    if (rootFilter && d.root !== rootFilter) return false;
    if (taskFilter === NONE) return !d.task_id;
    if (taskFilter && d.task_id !== taskFilter) return false;
    if (needle && !(`${d.name} ${d.rel_to_root} ${d.task_id ?? ''}`.toLowerCase().includes(needle))) return false;
    return true;
  }), [items, rootFilter, taskFilter, needle]);
  const filterActive = rootFilter != null || taskFilter != null || needle.length > 0;

  // Mounted fresh each time the drawer opens (parent keys on `open`), so the
  // effect only needs to fetch + set results inside async callbacks — no
  // synchronous reset of state in the effect body.
  useEffect(() => {
    if (!open) return;
    let live = true;
    listDeliverables()
      .then((r) => { if (live) { setItems(r.deliverables); setRoots(r.roots); } })
      .catch((e) => { if (live) setError(errMessage(e)); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [open]);

  // Run #64: copy a deliverable's on-disk path to the clipboard so the operator can reference
  // it elsewhere (feed a script, cite in a handoff) without re-typing it. Falls back silently
  // if the clipboard API is unavailable (older/insecure context) — the path is still visible.
  function copyPath(path: string) {
    const done = () => { setCopied(true); window.setTimeout(() => setCopied(false), 1500); };
    try { navigator.clipboard?.writeText(path).then(done, () => {}); } catch { /* no clipboard */ }
  }

  function openFile(d: DeliverableEntry) {
    setSelected(d);
    setFile(null);
    setImgFailed(false);
    setCopied(false);
    // Images render straight from the raw-bytes endpoint via <img>; no need to
    // fetch the JSON `/file` (which would only return the "binary, not shown"
    // note and force the bridge to read the whole image into memory).
    if (isImage(d.ext)) { setFileLoading(false); return; }
    setFileLoading(true);
    readDeliverable(d.path)
      .then(setFile)
      .catch((e) => setFile({ path: d.path, binary: false, truncated: false, content: '', note: errMessage(e) }))
      .finally(() => setFileLoading(false));
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}
        className="w-full max-w-5xl h-[80vh] flex flex-col border border-white/15 bg-[#070707] font-mono text-[11px]">
        {/* header */}
        <div className="shrink-0 flex items-center justify-between px-3 py-2 border-b border-white/10">
          <span className="tracking-[0.2em] text-white font-bold">📄 DELIVERABLES</span>
          <div className="flex items-center gap-2 text-[10px] text-[#777]">
            <span>{filterActive ? `${filtered.length} of ${items.length}` : items.length} file{(filterActive ? filtered.length : items.length) === 1 ? '' : 's'}</span>
            {roots.length > 0 && <span className="text-[#545454]">· {roots.join(' · ')}/</span>}
            <button onClick={onClose} className="ml-2 border border-white/10 px-2 py-0.5 text-[#b8b8b8] hover:border-white/30">✕ CLOSE</button>
          </div>
        </div>

        <div className="flex-1 min-h-0 flex">
          {/* list */}
          <div className="w-[320px] shrink-0 border-r border-white/10 flex flex-col">
            {/* run #62: filter bar — root chips + producing-task selector, both pure views
                over the fetched list. Only shown once there's something to filter. */}
            {!loading && !error && items.length > 0 && (
              <div className="shrink-0 border-b border-white/10 px-2 py-1.5 space-y-1.5 bg-white/[0.015]">
                {/* run #63: free-text search over name / path / task_id. Composes (AND) with
                    the chips + selector below; the trailing ✕ clears just the query. */}
                <div className="relative">
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="search name · path · task…"
                    title="filter by file name, path, or producing task id (substring)"
                    className="w-full bg-[#0c0c0c] border border-white/10 text-[#cfcfcf] text-[9px] tracking-[0.04em] pl-5 pr-5 py-0.5 rounded-sm placeholder:text-[#555] focus:border-amber-400/40 focus:outline-none"
                  />
                  <span className="absolute left-1.5 top-1/2 -translate-y-1/2 text-[#666] text-[9px] pointer-events-none">⌕</span>
                  {query && (
                    <button onClick={() => setQuery('')} title="clear search"
                      className="absolute right-1 top-1/2 -translate-y-1/2 text-[#888] hover:text-white text-[10px] leading-none">✕</button>
                  )}
                </div>
                <div className="flex items-center gap-1 flex-wrap">
                  <button onClick={() => setRootFilter(null)}
                    className={`px-1.5 py-0.5 rounded-sm border text-[9px] tracking-[0.08em] ${rootFilter == null ? 'border-white/40 text-white bg-white/[0.06]' : 'border-white/10 text-[#888] hover:border-white/30'}`}>
                    ALL <span className="tabular-nums">{items.length}</span>
                  </button>
                  {roots.map((r) => (
                    <button key={r} onClick={() => setRootFilter((cur) => (cur === r ? null : r))}
                      title={`show only ${r}/ deliverables`}
                      className={`px-1.5 py-0.5 rounded-sm border text-[9px] tracking-[0.08em] ${rootFilter === r ? 'border-cyan-400/50 text-cyan-300 bg-cyan-400/10' : 'border-white/10 text-[#888] hover:border-white/30'}`}>
                      {r}/ <span className="tabular-nums">{rootCounts.get(r) ?? 0}</span>
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-1">
                  <select value={taskFilter ?? ''} onChange={(e) => setTaskFilter(e.target.value || null)}
                    title="filter by producing task"
                    className="flex-1 min-w-0 bg-[#0c0c0c] border border-white/10 text-[#bbb] text-[9px] tracking-[0.04em] px-1 py-0.5 rounded-sm focus:border-emerald-400/40 focus:outline-none">
                    <option value="">all tasks ({taskFacets.tasks.length})</option>
                    {taskFacets.tasks.map(([id, n]) => (
                      <option key={id} value={id}>⬡ {id} ({n})</option>
                    ))}
                    {taskFacets.none > 0 && <option value={NONE}>unattributed ({taskFacets.none})</option>}
                  </select>
                  {filterActive && (
                    <button onClick={() => { setRootFilter(null); setTaskFilter(null); setQuery(''); }}
                      title="clear all filters"
                      className="shrink-0 border border-white/10 px-1.5 py-0.5 text-[9px] text-[#999] hover:border-white/30 hover:text-white rounded-sm">✕ CLEAR</button>
                  )}
                </div>
              </div>
            )}
            <div className="flex-1 min-h-0 overflow-y-auto">
            {loading && <div className="p-3 text-[#777]">loading…</div>}
            {error && <div className="p-3 text-red-400">⚠ {error}</div>}
            {!loading && !error && items.length > 0 && filtered.length === 0 && (
              <div className="p-3 text-[#777] leading-relaxed">
                No deliverables match this filter.{' '}
                <button onClick={() => { setRootFilter(null); setTaskFilter(null); setQuery(''); }}
                  className="text-emerald-400/80 hover:text-emerald-300 underline underline-offset-2">clear it</button>
                {' '}to see all {items.length}.
              </div>
            )}
            {!loading && !error && items.length === 0 && (
              <div className="p-3 text-[#777] leading-relaxed">
                No deliverables yet. Dispatched agents write output to{' '}
                <span className="text-[#b8b8b8]">deliverables/</span> and{' '}
                <span className="text-[#b8b8b8]">research/</span> — files appear here once produced.
              </div>
            )}
            {filtered.map((d) => (
              <button key={d.path} onClick={() => openFile(d)}
                className={`w-full text-left px-3 py-2 border-b border-white/[0.05] hover:bg-white/[0.03] ${selected?.path === d.path ? 'bg-white/[0.06] border-l-2 border-l-[#f64e6e]' : ''}`}>
                <div className="text-white truncate">{d.name}</div>
                <div className="flex items-center gap-2 text-[9px] text-[#777] mt-0.5">
                  <span className="text-cyan-400/80">{d.root}/</span>
                  {d.task_id && (
                    // The row itself is a <button> (opens the file), so the chip
                    // can't be a nested <button>; a span with stopPropagation is
                    // the valid-markup way to make it independently clickable.
                    // When onOpenTask is wired, clicking jumps to the producing
                    // task's detail drawer (artifact → task navigation loop).
                    <span
                      role={onOpenTask ? 'button' : undefined}
                      onClick={onOpenTask ? (e) => { e.stopPropagation(); onClose(); onOpenTask(d.task_id!); } : undefined}
                      className={`text-emerald-400/80 border border-emerald-400/25 px-1 rounded-sm ${onOpenTask ? 'cursor-pointer hover:bg-emerald-400/15 hover:text-emerald-300' : ''}`}
                      title={onOpenTask ? `open producing task ${d.task_id}` : `produced by task ${d.task_id}`}>⬡ {d.task_id}</span>
                  )}
                  <span>{human(d.size)}</span>
                  <span>· {ago(d.modified)}</span>
                </div>
              </button>
            ))}
            </div>
          </div>

          {/* viewer */}
          <div className="flex-1 min-w-0 flex flex-col">
            {!selected && (
              <div className="flex-1 flex items-center justify-center text-[#545454]">
                {items.length > 0 ? 'select a file to view' : '—'}
              </div>
            )}
            {selected && (
              <>
                {/* run #64: viewer toolbar — every selected deliverable is now retrievable, not
                    just binaries. ⎘ COPY PATH works for all files; text files (the bulk of output:
                    md/json/csv) gain the ↗ OPEN / ⬇ DOWNLOAD links that previously only binaries
                    and failed-image loads had. Pure links over the existing /raw bytes endpoint —
                    no new endpoint, no new fetch. */}
                <div className="shrink-0 flex items-center gap-2 px-3 py-1.5 border-b border-white/10">
                  <span className="flex-1 min-w-0 text-[10px] text-[#b8b8b8] truncate" title={selected.path}>{selected.path}</span>
                  <button onClick={() => copyPath(selected.path)} title="copy this deliverable's on-disk path"
                    className={`shrink-0 border px-1.5 py-0.5 text-[9px] rounded-sm ${copied ? 'border-emerald-400/40 text-emerald-300' : 'border-white/10 text-[#999] hover:border-white/30 hover:text-white'}`}>
                    {copied ? '✓ COPIED' : '⎘ COPY PATH'}
                  </button>
                  {!isImage(selected.ext) && !isPdf(selected.ext) && !file?.binary && (
                    <>
                      <a href={deliverableRawUrl(selected.path)} target="_blank" rel="noreferrer" title="open the raw file in a new tab"
                        className="shrink-0 border border-white/10 px-1.5 py-0.5 text-[9px] text-[#999] hover:border-white/30 hover:text-white rounded-sm">↗ OPEN</a>
                      <a href={deliverableRawUrl(selected.path)} download={selected.name} title={`download ${selected.name} (${human(selected.size)})`}
                        className="shrink-0 border border-emerald-400/25 px-1.5 py-0.5 text-[9px] text-emerald-300/90 hover:bg-emerald-400/10 rounded-sm">⬇ DOWNLOAD</a>
                    </>
                  )}
                </div>
                <div className="flex-1 min-h-0 overflow-auto p-3">
                  {isImage(selected.ext) ? (
                    imgFailed ? (
                      // The <img> couldn't load (oversized image, transient bridge
                      // error, or a bridge that predates /raw) — degrade to the same
                      // retrieval path a non-image binary gets instead of leaving a
                      // dead broken-image icon with no way to reach the deliverable.
                      <div className="space-y-3">
                        <div className="text-amber-400">image couldn't be displayed — open or download it instead</div>
                        <div className="flex items-center gap-3 text-[10px]">
                          <a href={deliverableRawUrl(selected.path)} target="_blank" rel="noreferrer"
                            className="border border-white/15 px-2 py-1 text-[#b8b8b8] hover:border-white/40 hover:text-white">↗ OPEN IN NEW TAB</a>
                          <a href={deliverableRawUrl(selected.path)} download={selected.name}
                            className="border border-emerald-400/30 px-2 py-1 text-emerald-300 hover:bg-emerald-400/10">⬇ DOWNLOAD ({human(selected.size)})</a>
                        </div>
                      </div>
                    ) : (
                      <img
                        src={deliverableRawUrl(selected.path)}
                        alt={selected.name}
                        onError={() => setImgFailed(true)}
                        className="max-w-full h-auto border border-white/10 bg-black/40"
                      />
                    )
                  ) : (
                    <>
                      {fileLoading && <div className="text-[#777]">loading…</div>}
                      {/* Non-image binary (PDF, zip, audio, video, …): the JSON
                          `/file` endpoint can only flag it "binary — not shown",
                          but `/raw` streams the real bytes — so surface an actual
                          retrieval path. PDFs embed inline; everything else gets
                          open/download links (the dead amber note alone left a
                          produced deliverable unreachable). */}
                      {!fileLoading && file?.binary && (
                        <div className="space-y-3">
                          {file.note && <div className="text-amber-400">{file.note}</div>}
                          {isPdf(selected.ext) && (
                            <iframe
                              src={deliverableRawUrl(selected.path)}
                              title={selected.name}
                              className="w-full h-[60vh] border border-white/10 bg-black/40"
                            />
                          )}
                          <div className="flex items-center gap-3 text-[10px]">
                            <a href={deliverableRawUrl(selected.path)} target="_blank" rel="noreferrer"
                              className="border border-white/15 px-2 py-1 text-[#b8b8b8] hover:border-white/40 hover:text-white">↗ OPEN IN NEW TAB</a>
                            <a href={deliverableRawUrl(selected.path)} download={selected.name}
                              className="border border-emerald-400/30 px-2 py-1 text-emerald-300 hover:bg-emerald-400/10">⬇ DOWNLOAD ({human(selected.size)})</a>
                          </div>
                        </div>
                      )}
                      {!fileLoading && file && !file.binary && (
                        <>
                          {file.note && <div className="text-amber-400">{file.note}</div>}
                          <pre className="whitespace-pre-wrap break-words text-[#cfcfcf] leading-relaxed">{file.content}</pre>
                          {file.truncated && (
                            <div className="mt-2 text-amber-400/80 text-[10px]">… truncated (file exceeds preview cap)</div>
                          )}
                        </>
                      )}
                    </>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
