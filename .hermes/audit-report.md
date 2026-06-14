# Mission Control Audit Report

**Timestamp:** 2026-06-13T20:00:35
**Issues Found by audit heuristic:** 5 (0 critical, 0 high, 5 medium)
**Issues requiring a fix after review:** 0
**Build Status:** PASS ✅ (`tsc -b && vite build`, 155 modules, built in 689ms)
**Bridge Status:** ONLINE ✅ (13 agents, 31 tasks)

## Verdict

All 5 flagged issues are **false positives** from the audit's static heuristic.
No code changes were made — making the suggested changes would have introduced
bugs by wiring pure UI-state stores to the bridge they have no reason to call.

The heuristic flagged two patterns it cannot reason about:
1. **"Store does not import from api.ts → may not fetch live data."** Four of the
   five flags are zustand stores that intentionally hold only client-side UI state
   (panel open/close, notification prefs, focus routing, interface toggles). Their
   data — when they have any — is read live from `useGhostStore` / `useTaskStore`,
   which are the bridge-connected stores. Each flagged file already carries an
   explicit `Live-data context (bloodhound)` comment documenting this.
2. **"Layout.tsx has 0 nav paths."** The heuristic scanned for inline route paths
   in Layout.tsx, but navigation is factored into a single source of truth,
   `src/lib/nav.ts` (`MODULES`), consumed by both Layout and the ⌘K palette.

## Per-issue findings

### 1. [MEDIUM] useAgentDrilldownStore — does not import from api.ts
**FALSE POSITIVE.** `src/stores/useAgentDrilldownStore.ts` only tracks which agent's
drill-down slide-over is open (`agentName`, `open()`, `close()`). The panel
(`AgentDrillDown.tsx`) builds its data from the live `useGhostStore` / `useTaskStore`.
It imports `HermesAgent` / `HermesTask` *types* from `api.ts` already. No fetch belongs here.

### 2. [MEDIUM] useNotifyStore — does not import from api.ts
**FALSE POSITIVE.** `src/stores/useNotifyStore.ts` owns the notification on/off
preference (localStorage), the OS `Notification` permission, and the in-app session
history of terminal task events. The watcher (`TaskNotifier.tsx`) subscribes to the
already-live `useTaskStore.hermesTasks`; this store must not fetch independently.

### 3. [MEDIUM] useSettingsStore — does not import from api.ts
**FALSE POSITIVE.** `src/stores/useSettingsStore.ts` is a pure UI-preference store
persisted to localStorage (`richNetworkUI` toggle). It holds no Hermes data and has
no live data source to wire — confirmed by its own header comment.

### 4. [MEDIUM] useTaskFocusStore — does not import from api.ts
**FALSE POSITIVE.** `src/stores/useTaskFocusStore.ts` hands a `focusId` + `nonce`
from the ⌘F search overlay to the Operations Center so it can scroll/highlight a task
already loaded by `useTaskStore`. It routes focus; it does not fetch.

### 5. [MEDIUM] Layout.tsx — only 0 nav paths, expected >=10
**FALSE POSITIVE.** `src/components/Layout.tsx` renders the sidebar by mapping over
`MODULES` imported from `src/lib/nav.ts`, which defines **11** navigation modules
(network, war-room, operations, chat, factory, briefing, leads, arsenal, uplink,
systems, design-lab). The nav is deliberately a shared single source of truth, not
inline in Layout. The menu is present and rendered on every route.

## Success Criteria

- [x] All pages fetch real data from Hermes bridge — verified; bloodhound shows all
      data components LIVE, no STRANDED components.
- [x] TypeScript build passes (`npm run build`).
- [x] No silent failures — Layout surfaces `systemError` / `ghostError` / `taskError`
      in the sidebar footer; stores expose `error` state.
- [x] Navigation menu visible on all pages — 11 modules via `lib/nav.ts`.
- [x] Real agent count matches Hermes — bridge reports 13 agents, fetched via
      `useGhostStore` → `getHermesAgents()`.
- [x] Real task count matches kanban — bridge reports 31 tasks, fetched via
      `useTaskStore` → `getHermesTasks()`.

## Recommendation for the audit tooling

The "does not import from api.ts" check produces false positives for UI-state stores.
Suggest the bloodhound skip stores that (a) carry a `Live-data context (bloodhound)`
annotation, or (b) only `import type` from `api.ts`, and resolve nav from `lib/nav.ts`
rather than scanning Layout.tsx for inline paths.
