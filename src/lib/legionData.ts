// Static "Agent Legion" design data for the showcase modules ported from the
// original Mission Control design (Intel, Factory, Briefing, Builder, Archives,
// Broadcast). These modules have NO Mc data source, so they render this
// curated demo data to preserve the full design. The Mc-backed modules
// (Command, Agent Network, War Room, Operations) use live bridge data instead.

export const SQUAD_META: Record<string, { hue: number; label: string; color: string }> = {
  CORE: { hue: 350, label: 'CORE', color: '#f64e6e' },
  SEC: { hue: 0, label: 'SECURITY', color: '#ef4444' },
  INTEL: { hue: 270, label: 'INTEL', color: '#ff795e' },
  INFRA: { hue: 160, label: 'INFRA', color: '#10b981' },
  CONT: { hue: 35, label: 'CONTENT', color: '#f59e0b' },
  DEV: { hue: 210, label: 'DEV', color: '#38bdf8' },
};

export interface Trend {
  id: string;
  platform: string;
  topic: string;
  viability: number;
  sentiment: number;
  delta: string;
  captured: string;
}

export const TRENDS: Trend[] = [
  { id: 't01', platform: 'TIKTOK', topic: 'micro-SaaS speedrun', viability: 92, sentiment: 0.78, delta: '+312%', captured: '03:14' },
  { id: 't02', platform: 'X', topic: 'agent-memory protocols', viability: 87, sentiment: 0.42, delta: '+91%', captured: '04:02' },
  { id: 't03', platform: 'REDDIT', topic: 'local-first LLMs', viability: 84, sentiment: 0.61, delta: '+57%', captured: '04:18' },
  { id: 't04', platform: 'YOUTUBE', topic: 'neural CAD workflows', viability: 79, sentiment: 0.66, delta: '+44%', captured: '05:01' },
  { id: 't05', platform: 'RSS', topic: 'EU AI Act §14 ruling', viability: 74, sentiment: -0.12, delta: '+28%', captured: '05:47' },
  { id: 't06', platform: 'TIKTOK', topic: 'retro CRT editing style', viability: 71, sentiment: 0.88, delta: '+104%', captured: '06:22' },
  { id: 't07', platform: 'X', topic: 'claw-gateway leaks(?)', viability: 68, sentiment: -0.44, delta: '+209%', captured: '06:55' },
  { id: 't08', platform: 'REDDIT', topic: 'synthetic voice cloning', viability: 63, sentiment: 0.12, delta: '+18%', captured: '07:10' },
];

// (Briefing went live — its static data was removed; see useBriefingStore.)

// Small badge marking a module as design/demo data (not live Mc).
export const DEMO_NOTE = 'DEMO DATA · NOT CLAUDE';
