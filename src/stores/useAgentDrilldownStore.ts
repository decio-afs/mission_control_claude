import { create } from 'zustand';

// Tiny global store so any roster surface (Agent Hub, Command's GHOST LEGION,
// the Nexus deck) can open the shared Agent Drill-Down slide-over by name,
// without prop-drilling. The slide-over itself is mounted once in Layout.tsx.
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
