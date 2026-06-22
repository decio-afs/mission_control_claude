import { create } from 'zustand';
import {
  getMcTasks,
  getContentPipeline,
  errMessage,
  type McTask,
  type ContentCampaign,
  type ContentDraft,
  type ContentCalendarItem,
} from '../lib/api';

// Primary source: the bridge's /api/content/pipeline — kanban-derived
// campaigns/drafts PLUS the planned-post calendar store (Metricool-scheduled).
// If that call fails, fall back to deriving everything client-side from the
// raw kanban tasks so the Factory still renders real Mc data.

interface ContentStore {
  campaigns: ContentCampaign[];
  drafts: ContentDraft[];
  calendar: ContentCalendarItem[];
  isLoading: boolean;
  error: string | null;
  lastSync: Date | null;
  refresh: () => Promise<void>;
}

type ContentStatus = ContentCampaign['status'];

// Keywords that flag a Mc task as content/marketing work.
const CONTENT_KEYWORDS = [
  'content', 'post', 'blog', 'social', 'twitter', 'tweet', 'linkedin', 'instagram',
  'reel', 'video', 'youtube', 'newsletter', 'email', 'campaign', 'article', 'draft',
  'copy', 'copywriting', 'seo', 'marketing', 'caption', 'thread',
];

function haystack(t: McTask): string {
  return `${t.title} ${t.body ?? ''} ${(t.skills || []).join(' ')}`.toLowerCase();
}

function isContentTask(t: McTask): boolean {
  const hay = haystack(t);
  return CONTENT_KEYWORDS.some((k) => hay.includes(k));
}

function platformFor(t: McTask): string {
  // Emit the SAME short codes the bridge's `_detect_platform` does
  // (IG/TT/X/LI/YT/WEB/MULTI), in its priority order, so this degraded
  // client-side fallback renders platform badges identical to the normal
  // pipeline path instead of full names. Earlier this returned Twitter/
  // LinkedIn/Instagram/… — a forward-migration straggler (the iter-#18
  // CF-PLATVOCAB fix normalized the backend projection but left this
  // fallback on the old vocabulary), so the same content task got a
  // different badge depending on whether the pipeline GET succeeded.
  const hay = haystack(t);
  if (hay.includes('instagram') || hay.includes('reel')) return 'IG';
  if (hay.includes('tiktok')) return 'TT';
  if (hay.includes('twitter') || hay.includes('tweet') || hay.includes('thread')) return 'X';
  if (hay.includes('linkedin')) return 'LI';
  if (hay.includes('youtube') || hay.includes('video')) return 'YT';
  if (hay.includes('blog') || hay.includes('article') || hay.includes('seo') || hay.includes('website')) return 'WEB';
  return 'MULTI';
}

function normStatus(s: string): ContentStatus {
  return s === 'done' || s === 'completed' ? 'done'
    : s === 'running' ? 'running'
    : s === 'blocked' ? 'blocked'
    : s === 'failed' ? 'failed'
    : 'ready';
}

// Mirror the bridge's `_extract_date`: prefer an explicit date written into the
// task title/body (ISO YYYY-MM-DD, else US MM/DD/YYYY) over the created_at
// stamp. The bridge pipeline derives every kanban calendar entry's `date` as
// `_extract_date(title+body)` FIRST, falling back to created_at only when no
// date is found (mission-control-bridge.py:2346) — but this client fallback
// always used created_at, so a content task that encodes its target date in the
// title ("Launch post 2026-07-15") showed on that day via the pipeline GET yet
// jumped to its CREATION day on the degraded path, landing on the wrong calendar
// cell (or dropping out of UPCOMING) purely based on whether one HTTP call
// succeeded. Same regexes as the backend, so the two paths extract identically
// (PRIMARY↔FALLBACK PARITY — date-basis field, sibling of the platformFor()/
// isoDate()/drafts-status stragglers already closed).
function extractDate(text: string): string | null {
  const iso = text.match(/(\d{4}-\d{2}-\d{2})/);
  if (iso) return iso[1];
  const us = text.match(/(\d{2}\/\d{2}\/\d{4})/);
  if (us) {
    const [mm, dd, yyyy] = us[1].split('/');
    return `${yyyy}-${mm}-${dd}`;
  }
  return null;
}

function isoDate(unixSeconds: number): string {
  // LOCAL calendar date (not UTC). The bridge pipeline derives every `c.date`
  // with datetime.fromtimestamp/now() (local) and ContentFactory's `upcoming`
  // filter compares against a LOCAL `today` boundary (see iter #43). A UTC
  // `toISOString().slice(0,10)` here made the kanban-derived fallback `c.date`
  // disagree with that boundary by the operator's offset, re-introducing the
  // iter-#43 off-by-one (today's posts dropping off UPCOMING ~7h early) on the
  // degraded path. Build the local YMD so both calendar sources agree.
  const d = new Date((unixSeconds || 0) * 1000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export const useContentStore = create<ContentStore>((set) => ({
  campaigns: [],
  drafts: [],
  calendar: [],
  isLoading: false,
  error: null,
  lastSync: null,

  refresh: async () => {
    set({ isLoading: true });
    // Preferred path: the bridge pipeline (includes planned posts).
    try {
      const pipeline = await getContentPipeline();
      set({
        campaigns: pipeline.campaigns ?? [],
        drafts: pipeline.drafts ?? [],
        calendar: pipeline.calendar ?? [],
        error: null,
        isLoading: false,
        lastSync: new Date(),
      });
      return;
    } catch {
      // fall through to the client-side kanban derivation
    }
    try {
      const { tasks } = await getMcTasks();
      const all = tasks || [];
      // Prefer genuine content tasks; if none are tagged, fall back to the full
      // task list so the Factory still renders real Mc data instead of an
      // empty shell.
      const matched = all.filter(isContentTask);
      const source = matched.length > 0 ? matched : all;

      const campaigns: ContentCampaign[] = source.map((t) => ({
        id: t.id,
        title: t.title,
        status: normStatus(t.status),
        assignee: t.assignee || 'unassigned',
        priority: t.priority,
        platform: platformFor(t),
      }));

      // Mirror the bridge pipeline's draft set (todo/pending/ready/blocked/
      // failed; done & running excluded — normStatus folds todo/pending into
      // 'ready'). Earlier this kept only 'ready', so blocked/failed content
      // tasks silently vanished from the Factory drafts queue on this degraded
      // path while the normal pipeline path surfaced them — the same "different
      // result depending on whether the GET succeeded" straggler the
      // platformFor() fix above already closed. Carry each draft's REAL status
      // so the queue's status dot/pill match (not a hardcoded 'ready').
      const draftStatuses: ContentStatus[] = ['ready', 'blocked', 'failed'];
      const drafts: ContentDraft[] = source
        .filter((t) => draftStatuses.includes(normStatus(t.status)))
        .map((t) => ({
          id: t.id,
          title: t.title,
          status: normStatus(t.status),
          assignee: t.assignee || 'unassigned',
          priority: t.priority,
          platform: platformFor(t),
        }));

      const calendar: ContentCalendarItem[] = source.map((t) => ({
        id: t.id,
        title: t.title,
        date: extractDate(`${t.title} ${t.body ?? ''}`) ?? isoDate(t.created_at),
        status: normStatus(t.status),
        platform: platformFor(t),
      }));

      set({
        campaigns,
        drafts,
        calendar,
        error: null,
        isLoading: false,
        lastSync: new Date(),
      });
    } catch (err) {
      const msg = errMessage(err);
      console.error('[ContentStore] refresh failed:', msg);
      set({ isLoading: false, error: msg });
    }
  },
}));
