// cronSchedule — pure, client-side parsing of Mc cron schedules.
//
// Mc cron jobs carry a free-form `schedule` (or `repeat`) string that is
// either a standard 5-field Vixie cron expression (`0 9 * * *`), a named macro
// (`@daily`), or an interval shorthand (`30m`, `every 2h`). The bridge exposes
// no `next_run` field, so Mission Control computes the next fire time itself:
// a smart minute/hour/day stepper resolves the next match of a cron expression
// from a supplied `nowMs`. Interval jobs ARE anchorable — the daemon
// (mc_scheduler.is_due) fires them one period after `last_run` (else
// `created_at`), so when that anchor is supplied we compute a real next-fire
// countdown for them too rather than just showing the period. Field matching
// uses LOCAL time — the mc daemon runs on this
// machine and fires on its local clock (the topbar ZULU clock is UTC, but a
// relative "in 3h 12m" countdown is timezone-independent). No new bridge call:
// this is a pure parse of the already-polled cron list.

export type ScheduleKind = 'cron' | 'interval' | 'unknown';

export interface ParsedSchedule {
  kind: ScheduleKind;
  /** Human label, e.g. "09:00 daily", "every 30m", or the raw expression. */
  label: string;
  /** Next fire epoch-ms from `nowMs`, or null when not anchorable (intervals) / unparseable. */
  nextMs: number | null;
  /** Interval period in ms (interval kind only). */
  intervalMs?: number;
}

interface CronFields {
  minute: Set<number>;
  hour: Set<number>;
  dom: Set<number>;
  month: Set<number>;
  dow: Set<number>;
  domRestricted: boolean;
  dowRestricted: boolean;
  label: string;
}

const NAMED: Record<string, string> = {
  '@yearly': '0 0 1 1 *',
  '@annually': '0 0 1 1 *',
  '@monthly': '0 0 1 * *',
  '@weekly': '0 0 * * 0',
  '@daily': '0 0 * * *',
  '@midnight': '0 0 * * *',
  '@hourly': '0 * * * *',
};

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const pad = (n: number) => String(n).padStart(2, '0');

// Strict integer parse mirroring the daemon's Python `int()`: an optional sign
// plus digits and NOTHING else. `parseInt` silently truncates a trailing
// non-digit ('15m' → 15, '5x' → 5, '1-5-7' → 1-5), which let a fat-fingered
// field like '*/15m' (interval shorthand mixed into cron) parse as a healthy
// cron HERE while mc_scheduler's `int('15m')` raises and the daemon never fires
// it — the UI would show a next-fire countdown for a job that can never run.
// Closing this last leniency gap keeps the parser in lock-step with the daemon
// (the recurring #27/#28/#58 cron-parser-divergence class). `int('+5')` is valid
// in Python, so '+5' stays accepted (and is then rejected by the bounds check).
function strictInt(tok: string): number | null {
  if (!/^[+-]?\d+$/.test(tok)) return null;
  const n = parseInt(tok, 10);
  return Number.isInteger(n) ? n : null;
}

// Expand one cron field ("*", "5", "1-5", "*/15", "1-10/2", "0,30") into the
// concrete set of matching values, or null when the field is malformed / uses
// an unsupported token (L, W, ?, names, trailing garbage) — caller treats null
// as unparseable.
function expandField(field: string, min: number, max: number): Set<number> | null {
  const out = new Set<number>();
  for (const part of field.split(',')) {
    if (!part) return null;
    const slash = part.split('/');
    if (slash.length > 2) return null;
    const range = slash[0];
    const stepStr = slash[1];
    const step = stepStr === undefined ? 1 : strictInt(stepStr);
    if (step === null || step < 1) return null;

    let lo: number;
    let hi: number;
    if (range === '*') {
      lo = min;
      hi = max;
    } else if (range.includes('-')) {
      // Exactly two bounds — "1-5-7" (which the daemon's str.partition + int()
      // rejects) is malformed, not a silent "1-5".
      const bounds = range.split('-');
      if (bounds.length !== 2) return null;
      const loP = strictInt(bounds[0]);
      const hiP = strictInt(bounds[1]);
      if (loP === null || hiP === null) return null;
      lo = loP;
      hi = hiP;
    } else {
      const v = strictInt(range);
      if (v === null) return null;
      lo = v;
      // "5/2" means 5,7,9,… up to max; a bare "5" matches only 5.
      hi = stepStr === undefined ? v : max;
    }
    if (lo < min || hi > max || lo > hi) return null;
    for (let v = lo; v <= hi; v += step) out.add(v);
  }
  return out.size ? out : null;
}

function describeCron(parts: string[], minute: Set<number>, hour: Set<number>, dow: Set<number>): string {
  const single = (s: Set<number>) => (s.size === 1 ? [...s][0] : null);
  const mm = single(minute);
  const hh = single(hour);
  // "MM HH * * *"  → "HH:MM daily" / "HH:MM Mon/Wed"
  if (mm !== null && hh !== null && parts[2] === '*' && parts[3] === '*') {
    const t = `${pad(hh)}:${pad(mm)}`;
    if (parts[4] === '*') return `${t} daily`;
    if (dow.size <= 3) return `${t} ${[...dow].sort().map((d) => DAYS[d]).join('/')}`;
  }
  // "*/n * * * *" → "every n min"
  if (parts[0].startsWith('*/') && parts.slice(1).every((p) => p === '*')) {
    return `every ${parts[0].slice(2)}m`;
  }
  // "0 */n * * *" → "every n h"
  if (parts[0] === '0' && parts[1].startsWith('*/') && parts.slice(2).every((p) => p === '*')) {
    return `every ${parts[1].slice(2)}h`;
  }
  return parts.join(' ');
}

function parseCron(text: string): CronFields | null {
  let expr = text;
  if (expr.startsWith('@')) {
    const named = NAMED[expr.toLowerCase()];
    if (!named) return null;
    expr = named;
  }
  const parts = expr.split(/\s+/);
  if (parts.length !== 5) return null;

  const minute = expandField(parts[0], 0, 59);
  const hour = expandField(parts[1], 0, 23);
  const dom = expandField(parts[2], 1, 31);
  const month = expandField(parts[3], 1, 12);
  const dow = expandField(parts[4], 0, 7);
  if (!minute || !hour || !dom || !month || !dow) return null;

  // Cron day-of-week uses 0 and 7 for Sunday — normalize 7 → 0.
  if (dow.has(7)) {
    dow.delete(7);
    dow.add(0);
  }

  return {
    minute,
    hour,
    dom,
    month,
    dow,
    domRestricted: parts[2] !== '*',
    dowRestricted: parts[4] !== '*',
    label: describeCron(parts, minute, hour, dow),
  };
}

// Standard cron day rule: when BOTH day-of-month and day-of-week are restricted
// the job fires if EITHER matches; otherwise only the restricted field applies.
function dayMatches(d: Date, f: CronFields): boolean {
  const domHit = f.dom.has(d.getDate());
  const dowHit = f.dow.has(d.getDay());
  if (f.domRestricted && f.dowRestricted) return domHit || dowHit;
  if (f.domRestricted) return domHit;
  if (f.dowRestricted) return dowHit;
  return true;
}

// Walk forward from the minute after `nowMs` to the next matching instant.
// Skips whole months/days/hours that can't match so the loop stays cheap
// (a handful of steps for typical jobs); a generous iteration guard caps the
// worst case (e.g. a never-matching expression) instead of spinning.
function nextCron(f: CronFields, nowMs: number): number | null {
  const d = new Date(nowMs);
  d.setSeconds(0, 0);
  d.setMinutes(d.getMinutes() + 1);
  const limit = nowMs + 366 * 24 * 3600 * 1000;
  let guard = 0;
  while (d.getTime() <= limit && guard < 600000) {
    guard++;
    if (!f.month.has(d.getMonth() + 1)) {
      d.setMonth(d.getMonth() + 1, 1);
      d.setHours(0, 0, 0, 0);
      continue;
    }
    if (!dayMatches(d, f)) {
      d.setDate(d.getDate() + 1);
      d.setHours(0, 0, 0, 0);
      continue;
    }
    if (!f.hour.has(d.getHours())) {
      d.setHours(d.getHours() + 1, 0, 0, 0);
      continue;
    }
    if (!f.minute.has(d.getMinutes())) {
      d.setMinutes(d.getMinutes() + 1, 0, 0);
      continue;
    }
    return d.getTime();
  }
  return null;
}

function parseInterval(text: string): { ms: number; label: string } | null {
  const m = text
    .toLowerCase()
    // Trailing whitespace after "every" is OPTIONAL: the daemon's matcher
    // (mc_scheduler.parse_interval_seconds, via str.removeprefix) accepts the
    // no-space shorthand "every30m" too. Requiring \s+ here made the UI report
    // such a job as kind 'unknown' (no countdown — looks inert) while the bridge
    // daemon silently fired it every period. \s* keeps the two in lock-step.
    .replace(/^every\s*/, '')
    .match(/^(\d+)\s*(s|sec|secs|second|seconds|m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days)$/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  if (!Number.isInteger(n) || n < 1) return null;
  const u = m[2][0]; // s | m | h | d — distinct first letters across the allowed units
  const mult = u === 's' ? 1000 : u === 'm' ? 60000 : u === 'h' ? 3600000 : 86400000;
  return { ms: n * mult, label: `every ${n}${u}` };
}

/**
 * The daemon's interval anchor for a job in epoch-MS, or undefined when the job
 * has never fired and carries no creation stamp. Single source of truth for the
 * `last_run ?? created_at` precedence in mc_scheduler.is_due — both inputs are
 * epoch SECONDS (the bridge stamps them via `time.time()`), so we ×1000 to ms.
 * undefined → callers leave the interval un-anchored (no countdown), exactly as
 * before the anchor existed.
 */
export function cronAnchorMs(lastRunSec?: number, createdAtSec?: number): number | undefined {
  const s =
    typeof lastRunSec === 'number' ? lastRunSec : typeof createdAtSec === 'number' ? createdAtSec : undefined;
  return s === undefined ? undefined : s * 1000;
}

/** Parse any Mc schedule string into a kind + human label + next-fire time. */
export function parseSchedule(raw: string | undefined, nowMs: number, anchorMs?: number): ParsedSchedule {
  const text = (raw || '').trim();
  if (!text) return { kind: 'unknown', label: '—', nextMs: null };

  const interval = parseInterval(text);
  if (interval) {
    // Mirror mc_scheduler.is_due: an interval is due one period after its anchor
    // (last_run, else created_at). With an anchor we surface a real next-fire
    // countdown; without one (never fired, no stamp) we leave it un-anchored as
    // before. An overdue anchor yields a past nextMs → the caller renders "now",
    // matching the daemon firing it on the next tick (`now - anchor >= period`).
    const nextMs = anchorMs === undefined ? null : anchorMs + interval.ms;
    return { kind: 'interval', label: interval.label, nextMs, intervalMs: interval.ms };
  }

  const cron = parseCron(text);
  if (cron) return { kind: 'cron', label: cron.label, nextMs: nextCron(cron, nowMs) };

  return { kind: 'unknown', label: text, nextMs: null };
}

/**
 * Every fire time within `(nowMs, nowMs + windowMs]` for any schedule kind,
 * soonest first, capped at `maxFires`. Cron expressions are walked forward via
 * the same stepper used for the next-fire countdown; interval jobs are anchored
 * at the daemon's `anchorMs` (last_run/created_at) when known so the ticks land
 * on the *actual* fire phase, falling back to `nowMs` when un-anchored (first
 * fire one period out — the prior behavior). Returns `[]` for unparseable /
 * empty schedules. Pure — no `Date.now()`, no bridge.
 */
export function upcomingFires(
  raw: string | undefined,
  nowMs: number,
  windowMs: number,
  maxFires = 64,
  anchorMs?: number,
): number[] {
  const text = (raw || '').trim();
  if (!text || windowMs <= 0) return [];
  const end = nowMs + windowMs;
  const out: number[] = [];

  const interval = parseInterval(text);
  if (interval) {
    // First fire strictly after nowMs, phase-aligned to the anchor. Computed
    // directly (not by stepping from a possibly-stale anchor) so a long-past
    // anchor with a short period stays O(maxFires) instead of O(elapsed/period).
    const anchor = anchorMs === undefined ? nowMs : anchorMs;
    const k = Math.max(1, Math.floor((nowMs - anchor) / interval.ms) + 1);
    for (let t = anchor + k * interval.ms; t <= end && out.length < maxFires; t += interval.ms) out.push(t);
    return out;
  }

  const cron = parseCron(text);
  if (cron) {
    let cursor = nowMs;
    while (out.length < maxFires) {
      const next = nextCron(cron, cursor);
      // nextCron returns the first match strictly after cursor's minute, so
      // advancing cursor to each fire can never repeat or stall.
      if (next === null || next > end) break;
      out.push(next);
      cursor = next;
    }
    return out;
  }
  return [];
}

/** Format a positive duration (ms) as a compact "2d 4h" / "3h 12m" / "45m" countdown. */
export function formatCountdown(deltaMs: number): string {
  if (deltaMs <= 0) return 'now';
  const s = Math.floor(deltaMs / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return '<1m';
}

/** Short local clock label for an absolute fire time, e.g. "Tue 09:00". */
export function fireLabel(ms: number): string {
  const d = new Date(ms);
  return `${DAYS[d.getDay()]} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
