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
  { id: 'command',    path: '/command',    label: 'Hermes Command',  short: 'Command',  num: '00' },
  { id: 'network',    path: '/network',    label: 'Ghost Network',   short: 'Network',  num: '01' },
  { id: 'agenthub',   path: '/agent-hub',  label: 'Agent Hub',       short: 'Agents',   num: '02' },
  { id: 'warroom',    path: '/war-room',   label: 'War Room',        short: 'War Room', num: '03' },
  { id: 'operations', path: '/operations', label: 'Operations',      short: 'Ops',      num: '04' },
  { id: 'chat',       path: '/chat',       label: 'Ghost Comms',     short: 'Chat',     num: '05' },
  { id: 'factory',    path: '/factory',    label: 'Content Factory', short: 'Factory',  num: '06' },
  { id: 'briefing',   path: '/briefing',   label: 'Briefing',        short: 'Brief',    num: '07' },
  { id: 'leads',      path: '/leads',      label: 'Lead Tracker',    short: 'Leads',    num: '08' },
  // Consolidated design showcase (Intel Deck, Workflow Builder, Archives, Broadcast Uplink).
  { id: 'designlab',  path: '/design-lab', label: 'Design Lab',      short: 'Lab',      num: '09' },
];
