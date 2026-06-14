import { useMemo } from 'react';
import type { McCronJob } from '../lib/api';
import { upcomingFires, parseSchedule, fireLabel, formatCountdown } from '../lib/cronSchedule';

// Next-24h cron agenda — one thin lane per job plotting every upcoming fire as a
// tick across a 24h window, so the operator sees *when the next wave of scheduled
// work lands* at a glance (the per-job countdown in the row list answers "when
// next?"; this answers "what's the rhythm of the next day?"). Pure client view
// built on the Run #13 cronSchedule parser — no new bridge endpoint.

const WINDOW_MS = 24 * 3600 * 1000;
const MAX_TICKS = 300; // dense jobs (e.g. every-5m) get a continuous band, not 1000 nodes

export default function CronTimeline({ jobs, nowMs }: { jobs: McCronJob[]; nowMs: number }) {
  // Bucket the live clock to the minute: the tick layout shifts < 0.001% per
  // second across a 24h window, so recomputing every second is wasted work.
  const minuteBucket = Math.floor((nowMs || 0) / 60000);
  const base = minuteBucket * 60000;

  const rows = useMemo(
    () =>
      jobs.map((j) => {
        const raw = j.schedule || j.repeat;
        return {
          job: j,
          label: parseSchedule(raw, base).label,
          fires: upcomingFires(raw, base, WINDOW_MS, MAX_TICKS),
        };
      }),
    [jobs, base],
  );

  if (jobs.length === 0) return null;

  const total = rows.reduce((n, r) => n + r.fires.length, 0);

  return (
    <div className="border border-white/[0.06] bg-[#080808] p-2 flex flex-col gap-1.5">
      <div className="flex items-center justify-between text-[10px] font-mono tracking-[0.2em] uppercase text-[#545454]">
        <span>NEXT 24H AGENDA</span>
        <span className="tabular-nums">{total} {total === 1 ? 'FIRE' : 'FIRES'}</span>
      </div>

      <div className="flex flex-col gap-1">
        {rows.map(({ job, fires }) => {
          const active = job.status === 'active';
          return (
            <div key={job.id} className="flex items-center gap-2">
              <div className="w-[82px] shrink-0 text-[10px] font-mono text-[#b8b8b8] truncate" title={job.name || job.id}>
                {job.name || job.id.slice(0, 10)}
              </div>
              <div className="relative flex-1 h-4 bg-[#0d0d0d] border border-white/[0.04]">
                {[6, 12, 18].map((h) => (
                  <div key={h} className="absolute top-0 bottom-0 w-px bg-white/[0.05]" style={{ left: `${(h / 24) * 100}%` }} />
                ))}
                {fires.length === 0 ? (
                  <span className="absolute inset-0 flex items-center justify-center text-[10px] font-mono text-[#3a3a3a]">no fires in 24h</span>
                ) : (
                  fires.map((ms, i) => (
                    <div
                      key={i}
                      title={`${job.name || job.id} · ${fireLabel(ms)} (in ${formatCountdown(ms - (nowMs || 0))})`}
                      className="absolute top-0.5 bottom-0.5 w-[2px] -ml-px"
                      style={{ left: `${((ms - base) / WINDOW_MS) * 100}%`, background: active ? '#f64e6e' : '#545454' }}
                    />
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* hour axis aligned under the lanes (label gutter matches the 82px name column) */}
      <div className="flex items-center gap-2">
        <div className="w-[82px] shrink-0" />
        <div className="relative flex-1 h-2.5 text-[10px] font-mono text-[#545454]">
          <span className="absolute left-0">now</span>
          <span className="absolute left-1/4 -translate-x-1/2">+6h</span>
          <span className="absolute left-1/2 -translate-x-1/2">+12h</span>
          <span className="absolute left-3/4 -translate-x-1/2">+18h</span>
          <span className="absolute right-0">+24h</span>
        </div>
      </div>
    </div>
  );
}
