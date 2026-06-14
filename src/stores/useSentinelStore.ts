import { create } from 'zustand';
import {
  getMcActivity,
  getMcBriefing,
  errMessage,
  type SentinelDigest,
  type SentinelStory,
} from '../lib/api';

// The bridge has no /api/sentinel/digest endpoint. The Sentinel digest is
// composed from live Mc signals: the recent activity feed becomes the story
// list, enriched with the daily briefing's trend lines and directives. Either
// source alone is enough to render a digest; only when both fail do we surface
// an error.

interface SentinelStore {
  digest: SentinelDigest | null;
  isLoading: boolean;
  error: string | null;
  lastSync: Date | null;
  fetchDigest: () => Promise<void>;
}

function hash(s: string): number {
  let x = 0;
  for (let i = 0; i < s.length; i++) x = (x * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(x);
}

function scoreForStatus(status: string, seed: string): number {
  const base =
    status === 'completed' || status === 'done' ? 80
    : status === 'running' || status === 'active' ? 65
    : status === 'failed' || status === 'blocked' ? 40
    : 55;
  return Math.max(1, Math.min(99, base + (hash(seed) % 15)));
}

export const useSentinelStore = create<SentinelStore>((set) => ({
  digest: null,
  isLoading: false,
  error: null,
  lastSync: null,

  fetchDigest: async () => {
    set({ isLoading: true });
    try {
      const [activityRes, briefingRes] = await Promise.allSettled([
        getMcActivity(),
        getMcBriefing(),
      ]);

      const stories: SentinelStory[] = [];

      if (activityRes.status === 'fulfilled') {
        for (const a of activityRes.value.activities || []) {
          stories.push({
            title: `${a.agent} — ${a.action}`,
            url: '#',
            source: a.agent,
            score: scoreForStatus(a.status, a.id),
          });
        }
      }

      if (briefingRes.status === 'fulfilled') {
        const b = briefingRes.value;
        for (const t of b.trend || []) {
          stories.push({ title: t, url: '#', source: 'TREND', score: 60 + (hash(t) % 30) });
        }
        for (const d of b.directives || []) {
          stories.push({
            title: d.msg,
            url: '#',
            source: d.sev,
            score: d.sev === 'HIGH' ? 95 : d.sev === 'WARN' ? 75 : 55,
          });
        }
      }

      if (stories.length === 0) {
        const reason =
          activityRes.status === 'rejected'
            ? errMessage(activityRes.reason)
            : briefingRes.status === 'rejected'
              ? errMessage(briefingRes.reason)
              : 'No Mc activity available for digest.';
        console.error('[SentinelStore] fetchDigest failed:', reason);
        set({ isLoading: false, error: reason });
        return;
      }

      stories.sort((a, b) => b.score - a.score);
      const sources = Array.from(new Set(stories.map((s) => s.source)));

      const digest: SentinelDigest = {
        generated_at: new Date().toISOString(),
        total_stories: stories.length,
        sources,
        stories,
      };

      set({
        digest,
        error: null,
        isLoading: false,
        lastSync: new Date(),
      });
    } catch (err) {
      const msg = errMessage(err);
      console.error('[SentinelStore] fetchDigest failed:', msg);
      set({ isLoading: false, error: msg });
    }
  },
}));
