import { create } from 'zustand';
// Live-data context (bloodhound): this store does NOT fetch from the bridge
// directly — it receives a focusId and routes scroll to tasks already loaded by
// useTaskStore (live from /api/hermes/tasks).

// Tiny global store letting the Task Search overlay (⌘F) hand a task id off to
// the Operations Center, which scrolls it into view and highlights it briefly.
// `nonce` lets Operations re-trigger the scroll/highlight even when the same id
// is chosen twice in a row (the id alone wouldn't change).
//
// No direct bridge fetching — it routes focus to tasks already loaded by
// useTaskStore (live from /api/hermes/tasks).
interface TaskFocusStore {
  focusId: string | null;
  nonce: number;
  focus: (id: string) => void;
  clear: () => void;
}

export const useTaskFocusStore = create<TaskFocusStore>((set) => ({
  focusId: null,
  nonce: 0,
  focus: (id) => set((s) => ({ focusId: id, nonce: s.nonce + 1 })),
  clear: () => set({ focusId: null }),
}));
