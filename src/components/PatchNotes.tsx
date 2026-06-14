import { useEffect, useState } from 'react';
import { getPatchNotes, errMessage, type PatchNote } from '../lib/api';

// Category → label + accent. Mirrors the bug classes the bug-hunt routine works
// (deliverable / bug / lifecycle / ui / perf / misconfig), plus a neutral fallback.
const CAT_TONE: Record<string, { label: string; color: string }> = {
  deliverable: { label: 'DELIVERABLE', color: '#38bdf8' },
  bug:         { label: 'BUG FIX',     color: '#f64e6e' },
  lifecycle:   { label: 'LIFECYCLE',   color: '#f59e0b' },
  ui:          { label: 'UI',          color: '#a78bfa' },
  perf:        { label: 'PERF',        color: '#10b981' },
  misconfig:   { label: 'CONFIG',      color: '#fbbf24' },
  audit:       { label: 'AUDIT',       color: '#737373' },
};
function tone(cat?: string) {
  return CAT_TONE[(cat || '').toLowerCase()] || { label: (cat || 'FIX').toUpperCase(), color: '#737373' };
}

// Patch Notes — a read-only changelog of what the autonomous bug-hunt routine
// has shipped. Source of truth is `.mc/patch-notes.json` (written by the
// routine after each run that lands a fix), served by GET /api/mc/patch-notes.
// Opened from the topbar ⚙ UI settings popover. Matches the BridgeDiagnostics
// modal shell (overlay click-to-close, capped height, scrolling body).
export default function PatchNotes({ onClose }: { onClose: () => void }) {
  const [notes, setNotes] = useState<PatchNote[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await getPatchNotes();
        if (alive) setNotes(res.notes || []);
      } catch (e) {
        if (alive) { setError(errMessage(e)); setNotes([]); }
      }
    })();
    return () => { alive = false; };
  }, []);

  return (
    <div
      className="fixed inset-0 z-[5000] flex items-start justify-center bg-black/70 backdrop-blur-sm pt-[8vh] px-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[560px] max-h-[80vh] flex flex-col border border-white/15"
        style={{ background: 'linear-gradient(180deg, #0d0d10, #070709)', boxShadow: '0 16px 40px -12px rgba(0,0,0,0.9)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-white/10 px-4 py-3 shrink-0">
          <div className="min-w-0">
            <div className="text-[11px] tracking-[0.25em] font-bold text-white">PATCH NOTES</div>
            <div className="text-[10px] text-[#737373] mt-0.5 truncate">Autonomous bug-hunt routine — fixes shipped each run</div>
          </div>
          <button onClick={onClose} className="text-[#545454] hover:text-white text-[11px] shrink-0 ml-3" aria-label="Close patch notes">✕</button>
        </div>

        <div className="overflow-y-auto px-4 py-3">
          {notes === null && (
            <div className="text-[11px] text-[#737373] py-8 text-center">Loading patch notes…</div>
          )}
          {notes !== null && notes.length === 0 && (
            <div className="text-[11px] text-[#737373] py-8 text-center leading-relaxed">
              {error
                ? <>Couldn&rsquo;t reach the bridge — <span className="text-amber-400">{error}</span></>
                : 'No patch notes yet. The bug-hunt routine writes one here after each run that ships a fix.'}
            </div>
          )}
          {notes !== null && notes.length > 0 && (
            <ol className="flex flex-col gap-3">
              {notes.map((n, i) => {
                const t = tone(n.category);
                return (
                  <li key={n.id || i} className="border border-white/10 bg-white/[0.02] p-2.5">
                    <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                      <span
                        className="text-[9px] font-bold tracking-[0.15em] px-1.5 py-0.5 border"
                        style={{ color: t.color, borderColor: `${t.color}55`, background: `${t.color}14` }}
                      >{t.label}</span>
                      {n.severity && <span className="text-[9px] tracking-[0.12em] text-[#737373] uppercase">{n.severity}</span>}
                      <span className="ml-auto text-[9px] text-[#545454] tabular-nums">
                        {n.date}{typeof n.iteration === 'number' ? ` · run #${n.iteration}` : ''}
                      </span>
                    </div>
                    <div className="text-[11px] font-bold text-white leading-snug break-words">{n.title}</div>
                    <div className="text-[10px] text-[#a3a3a3] leading-relaxed mt-1 break-words">{n.summary}</div>
                    {n.files && n.files.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {n.files.map((f) => (
                          <span key={f} className="text-[9px] text-[#737373] font-mono bg-white/[0.03] border border-white/5 px-1 py-0.5 truncate max-w-full">{f}</span>
                        ))}
                      </div>
                    )}
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      </div>
    </div>
  );
}
