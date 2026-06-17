// Human-readable presentation for task lifecycle events.
//
// The task EVENT TIMELINE (TaskDetailDrawer) renders each event's raw `kind`
// (snake_case) with no icon, and `eventDetail()` only surfaces a small set of
// reason/message keys. That left two classes of events illegible to an operator:
//   1. dependency edge events (`dependency_link` / `dependency_unlink`) — the
//      WHICH-edge lives in `payload.parent`, which DETAIL_KEYS never scans, so
//      the operator saw a bare "dependency_link" with no indication of the edge.
//   2. every other kind shown as raw snake_case with no visual anchor.
//
// This module maps a `kind` -> {label, icon} for the kinds Mc actually emits,
// and surfaces the parent-edge id from a dependency event's payload. Unknown
// kinds fall back to a Title-Cased version of the raw kind (never blank), so a
// newly-added event verb is still legible without a code change here.

export interface EventLabel {
  label: string;
  icon: string;
}

// Kinds Mc emits across the store (create/claim/complete/block/fail/route/
// promote/escalate/reassign/reconcile/dependency/workspace/cron). Keep the
// labels short — the timeline row is a 10px mono line.
const EVENT_LABELS: Record<string, EventLabel> = {
  created: { label: 'created', icon: '✦' },
  claimed: { label: 'claimed', icon: '◉' },
  started: { label: 'started', icon: '▶' },
  completed: { label: 'completed', icon: '✓' },
  blocked: { label: 'blocked', icon: '⛔' },
  unblocked: { label: 'unblocked', icon: '◌' },
  failed: { label: 'failed', icon: '✕' },
  reassigned: { label: 'reassigned', icon: '♻' },
  reclaimed: { label: 'reclaimed', icon: '⟳' },
  reconciled: { label: 'reconciled', icon: '⟳' },
  routed: { label: 'routed', icon: '⤵' },
  promoted: { label: 'promoted', icon: '▲' },
  escalated: { label: 'escalated', icon: '⚑' },
  scheduled: { label: 'scheduled', icon: '⏱' },
  archived: { label: 'archived', icon: '🗄' },
  comment: { label: 'comment', icon: '💬' },
  edited: { label: 'edited', icon: '✎' },
  specified: { label: 'specified', icon: '✎' },
  workspace_ready: { label: 'workspace ready', icon: '📁' },
  dependency_hold: { label: 'dep hold', icon: '⏸' },
  dependency_clear: { label: 'dep clear', icon: '▶' },
  dependency_link: { label: 'dep linked', icon: '⇄' },
  dependency_unlink: { label: 'dep unlinked', icon: '✂' },
};

// Title-case a snake_case kind for the unknown-kind fallback.
function titleize(kind: string): string {
  return kind.replace(/_/g, ' ').trim();
}

export function labelFor(kind: string): EventLabel {
  return EVENT_LABELS[kind] ?? { label: titleize(kind) || kind, icon: '•' };
}

// Surface the parent-edge id carried by dependency events (link/unlink/hold/
// clear) so the operator can see WHICH edge the event refers to. Returns '' when
// the payload has no string `parent`, so callers can render it conditionally.
export function eventParent(payload: Record<string, unknown> | null): string {
  if (!payload) return '';
  const p = payload.parent;
  return typeof p === 'string' && p.trim() ? p.trim() : '';
}
