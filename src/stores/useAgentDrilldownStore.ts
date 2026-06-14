import { create } from 'zustand';
// Live-data context (bloodhound): the panel reads the bridge via useGhostStore /
// useTaskStore in AgentDrillDown.tsx. This store does NOT fetch directly — it
// only manages the Agent Drill-Down panel open/close state.
import type { McAgent, McTask } from '../lib/api';

// Tiny global store so any roster surface (Agent Hub, Command's GHOST LEGION,
// the Nexus deck) can open the shared Agent Drill-Down slide-over by name,
// without prop-drilling. The slide-over itself is mounted once in Layout.tsx.
// Data is sourced live from useGhostStore / useTaskStore — this store only
// manages the panel open/close state.
interface AgentDrilldownStore {
  agentName: string | null;
  open: (name: string) => void;
  close: () => void;
}

export const useAgentDrilldownStore = create<AgentDrilldownStore>((set) => ({
  agentName: null,
  open: (name) => set({ agentName: name }),
  close: () => set({ agentName: null }),
}));

// Re-export types for consumers that build drill-down data from live stores.
export type { McAgent, McTask };
