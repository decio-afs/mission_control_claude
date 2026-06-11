// WorkerLogStream — live tail of a task's worker log.
//
// The Hermes bridge exposes `getHermesTaskLog(taskId, tail)`, which returns the
// last N bytes of the worker's log file. That's a snapshot, not a stream — so we
// turn it into a live tail by re-polling on an interval while a task is running:
// each poll replaces the buffer with the freshest tail (which already contains any
// newly-appended lines) and, if the viewer is pinned to the bottom, auto-scrolls.
//
// Pure client polling — no new bridge endpoint. The ▶ LIVE / ⏸ PAUSE toggle lets
// the operator watch a running task's output advance without re-opening the drawer.
import { useCallback, useEffect, useRef, useState } from 'react';
import { getHermesTaskLog } from '../lib/api';

const TAIL_BYTES = 8000;
const POLL_MS = 2000;

export default function WorkerLogStream({ taskId, isRunning }: { taskId: string; isRunning: boolean }) {
  const [log, setLog] = useState<string | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [busy, setBusy] = useState(false);
  const preRef = useRef<HTMLPreElement>(null);
  // Whether the user is scrolled to (near) the bottom — controls auto-follow.
  const pinned = useRef(true);

  const fetchTail = useCallback(async () => {
    const r = await getHermesTaskLog(taskId, TAIL_BYTES).catch(() => ({ log: '(no log file for this task)' }));
    setLog(r.log || '(empty)');
  }, [taskId]);

  // One-shot manual load (also used as the entry point before streaming).
  const loadOnce = useCallback(async () => { setBusy(true); await fetchTail(); setBusy(false); }, [fetchTail]);

  // Polling loop: active only while `streaming`. Fires immediately, then every
  // POLL_MS; the cancelled flag guards a late response after unmount/toggle-off.
  useEffect(() => {
    if (!streaming) return;
    let cancelled = false;
    const tick = async () => { if (!cancelled) await fetchTail(); };
    void tick();
    const iv = setInterval(() => { void tick(); }, POLL_MS);
    return () => { cancelled = true; clearInterval(iv); };
  }, [streaming, fetchTail]);

  // Auto-follow: when the buffer updates and the viewer is pinned to the bottom,
  // keep it pinned (so new lines stay visible). If the operator scrolls up to
  // read earlier output, `pinned` goes false and we leave their position alone.
  useEffect(() => {
    const el = preRef.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [log]);

  const onScroll = () => {
    const el = preRef.current;
    if (el) pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
  };

  const toggleStream = () => {
    pinned.current = true; // re-pin to bottom whenever streaming (re)starts
    setStreaming((s) => !s);
  };

  if (log === null) {
    return (
      <div className="flex gap-1.5">
        <button onClick={loadOnce} disabled={busy}
          className="flex-1 text-[10px] font-mono border border-white/15 text-[#b8b8b8] hover:border-[#f64e6e] hover:text-[#f64e6e] py-1.5 px-2 disabled:opacity-30">
          {busy ? '…' : 'LOAD WORKER LOG'}
        </button>
        <button onClick={() => { pinned.current = true; setStreaming(true); }} disabled={busy}
          title={isRunning ? 'Live-tail this running task' : 'Task is not running — tail will be static'}
          className="text-[10px] font-mono border border-emerald-400/40 text-emerald-400 hover:bg-emerald-400/10 py-1.5 px-2 disabled:opacity-30">
          ▶ LIVE
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5">
        <button onClick={toggleStream}
          className={`text-[10px] font-mono border py-1 px-2 transition-colors ${
            streaming
              ? 'border-emerald-400/50 text-emerald-400 bg-emerald-400/10'
              : 'border-white/15 text-[#b8b8b8] hover:border-emerald-400/40 hover:text-emerald-400'
          }`}>
          {streaming ? '⏸ PAUSE' : '▶ LIVE'}
        </button>
        {streaming && (
          <span className="flex items-center gap-1 text-[10px] font-mono text-emerald-400">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            STREAMING · {POLL_MS / 1000}s
          </span>
        )}
        {!streaming && !isRunning && (
          <span className="text-[10px] font-mono text-[#545454]">task idle — tail is static</span>
        )}
        {!streaming && (
          <button onClick={loadOnce} disabled={busy}
            className="ml-auto text-[10px] font-mono text-[#545454] hover:text-[#f64e6e] disabled:opacity-30">
            {busy ? '…' : '⟳ REFRESH'}
          </button>
        )}
      </div>
      <pre ref={preRef} onScroll={onScroll}
        className="text-[10px] font-mono text-[#9aa3b5] whitespace-pre-wrap max-h-52 overflow-auto bg-[#050505] border border-white/10 p-2">
        {log}
      </pre>
    </div>
  );
}
