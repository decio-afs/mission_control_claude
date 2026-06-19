// Deliverables drawer — a reachable home for dispatched-agent output.
//
// Dispatched agents are told to write any substantive deliverable to
// deliverables/ or research/ at the repo root, but that output had no UI surface
// (the per-task workspace browser only sees a task's own workspace_path, which
// dispatch does not populate). This modal lists every produced artifact
// newest-first and opens any text file inline, read-only. Honest empty state when
// nothing has been produced yet. All reads are confined by the bridge to the two
// known roots.
import { useEffect, useState } from 'react';
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

  function openFile(d: DeliverableEntry) {
    setSelected(d);
    setFile(null);
    setImgFailed(false);
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
            <span>{items.length} file{items.length === 1 ? '' : 's'}</span>
            {roots.length > 0 && <span className="text-[#545454]">· {roots.join(' · ')}/</span>}
            <button onClick={onClose} className="ml-2 border border-white/10 px-2 py-0.5 text-[#b8b8b8] hover:border-white/30">✕ CLOSE</button>
          </div>
        </div>

        <div className="flex-1 min-h-0 flex">
          {/* list */}
          <div className="w-[320px] shrink-0 border-r border-white/10 overflow-y-auto">
            {loading && <div className="p-3 text-[#777]">loading…</div>}
            {error && <div className="p-3 text-red-400">⚠ {error}</div>}
            {!loading && !error && items.length === 0 && (
              <div className="p-3 text-[#777] leading-relaxed">
                No deliverables yet. Dispatched agents write output to{' '}
                <span className="text-[#b8b8b8]">deliverables/</span> and{' '}
                <span className="text-[#b8b8b8]">research/</span> — files appear here once produced.
              </div>
            )}
            {items.map((d) => (
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

          {/* viewer */}
          <div className="flex-1 min-w-0 flex flex-col">
            {!selected && (
              <div className="flex-1 flex items-center justify-center text-[#545454]">
                {items.length > 0 ? 'select a file to view' : '—'}
              </div>
            )}
            {selected && (
              <>
                <div className="shrink-0 px-3 py-1.5 border-b border-white/10 text-[10px] text-[#b8b8b8] truncate">{selected.path}</div>
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
