// Single source of truth for the primary navigation modules.
// Consumed by Layout.tsx (sidebar) and CommandPalette.tsx (⌘K jump-to).
export interface NavModule {
  id: string;
  path: string;
  label: string;
  short: string;
  num: string;
}

export const MODULES: NavModule[] = [
  // Agent Network is the primary dashboard: the live agent mesh, plus the
  // agent Registry (CRUD) and the orchestrator command bar all in one place.
  { id: 'network',    path: '/network',    label: 'Agent Network',   short: 'Network',  num: '00' },
  { id: 'warroom',    path: '/war-room',   label: 'War Room',        short: 'War Room', num: '01' },
  { id: 'operations', path: '/operations', label: 'Operations',      short: 'Ops',      num: '02' },
  { id: 'chat',       path: '/chat',       label: 'Claude Chat',     short: 'Chat',     num: '03' },
  { id: 'factory',    path: '/factory',    label: 'Content Factory', short: 'Factory',  num: '04' },
  { id: 'briefing',   path: '/briefing',   label: 'Briefing',        short: 'Brief',    num: '05' },
  { id: 'leads',      path: '/leads',      label: 'Lead Tracker',    short: 'Leads',    num: '06' },
  // Full Mc capability surface: skills/plugins/MCP, comms, runtime health.
  { id: 'arsenal',    path: '/arsenal',    label: 'Arsenal',         short: 'Arsenal',  num: '07' },
  { id: 'uplink',     path: '/uplink',     label: 'Uplink',          short: 'Uplink',   num: '08' },
  { id: 'systems',    path: '/systems',    label: 'Systems',         short: 'Systems',  num: '09' },
  // Consolidated design showcase (Intel Deck, Workflow Builder, Archives, Broadcast Uplink).
  { id: 'designlab',  path: '/design-lab', label: 'Design Lab',      short: 'Lab',      num: '10' },
];
