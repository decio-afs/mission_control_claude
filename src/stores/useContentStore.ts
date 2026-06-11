import { create } from 'zustand';
import {
  getHermesTasks,
  getContentPipeline,
  errMessage,
  type HermesTask,
  type ContentCampaign,
  type ContentDraft,
  type ContentCalendarItem,
} from '../lib/api';

// Primary source: the bridge's /api/content/pipeline — kanban-derived
// campaigns/drafts PLUS the planned-post calendar store (Buffer-synced).
// If that call fails, fall back to deriving everything client-side from the
// raw kanban tasks so the Factory still renders real Hermes data.

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

// Keywords that flag a Hermes task as content/marketing work.
const CONTENT_KEYWORDS = [
  'content', 'post', 'blog', 'social', 'twitter', 'tweet', 'linkedin', 'instagram',
  'reel', 'video', 'youtube', 'newsletter', 'email', 'campaign', 'article', 'draft',
  'copy', 'copywriting', 'seo', 'marketing', 'caption', 'thread',
];

function haystack(t: HermesTask): string {
  return `${t.title} ${t.body ?? ''} ${(t.skills || []).join(' ')}`.toLowerCase();
}

function isContentTask(t: HermesTask): boolean {
  const hay = haystack(t);
  return CONTENT_KEYWORDS.some((k) => hay.includes(k));
}

function platformFor(t: HermesTask): string {
  const hay = haystack(t);
  if (hay.includes('twitter') || hay.includes('tweet') || hay.includes('thread')) return 'Twitter';
  if (hay.includes('linkedin')) return 'LinkedIn';
  if (hay.includes('instagram') || hay.includes('reel')) return 'Instagram';
  if (hay.includes('youtube') || hay.includes('video')) return 'YouTube';
  if (hay.includes('newsletter') || hay.includes('email')) return 'Email';
  if (hay.includes('blog') || hay.includes('article') || hay.includes('seo')) return 'Blog';
  return 'Content';
}

function normStatus(s: string): ContentStatus {
  return s === 'done' || s === 'completed' ? 'done'
    : s === 'running' ? 'running'
    : s === 'blocked' ? 'blocked'
    : s === 'failed' ? 'failed'
    : 'ready';
}

function isoDate(unixSeconds: number): string {
  return new Date((unixSeconds || 0) * 1000).toISOString().slice(0, 10);
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
      const { tasks } = await getHermesTasks();
      const all = tasks || [];
      // Prefer genuine content tasks; if none are tagged, fall back to the full
      // task list so the Factory still renders real Hermes data instead of an
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

      const drafts: ContentDraft[] = source
        .filter((t) => normStatus(t.status) === 'ready')
        .map((t) => ({
          id: t.id,
          title: t.title,
          status: 'ready',
          assignee: t.assignee || 'unassigned',
          priority: t.priority,
          platform: platformFor(t),
        }));

      const calendar: ContentCalendarItem[] = source.map((t) => ({
        id: t.id,
        title: t.title,
        date: isoDate(t.created_at),
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
