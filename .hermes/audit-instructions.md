# Mission Control Improvement Instructions

Generated: 2026-06-14T00:00:42.977645
Audit Result: 5 issues found (0 critical, 0 high, 5 medium)

## Mission
Fix Mission Control web app so it displays REAL data from Hermes bridge instead of mock/hardcoded data.

## Current State
- Build: PASS
- Bridge: ONLINE
- Bridge Agents: 13
- Bridge Tasks: 31

## Data-Source Bloodhound Results

### LIVE Components (bridge-connected)
- ✅ `Archives.tsx`
- ✅ `BriefingTerminal.tsx`
- ✅ `BroadcastUplink.tsx`
- ✅ `ChatTerminal.tsx`
- ✅ `ContentFactory.tsx`
- ✅ `GhostNetwork.tsx`
- ✅ `IntelligenceDeck.tsx`
- ✅ `LeadTracker.tsx`
- ✅ `OperationsCenter.tsx`
- ✅ `WarRoom.tsx`
- ✅ `WorkflowBuilder.tsx`

### DEMO Components (intentional static data)

### STRANDED Components (should be live but no bridge integration)
- None found 🎉

### UNKNOWN Components (no clear data source detected)
- ❓ `Arsenal.tsx`
- ❓ `DesignLab.tsx`
- ❓ `Systems.tsx`
- ❓ `Uplink.tsx`

## Issues to Fix

### 1. [MEDIUM] useAgentDrilldownStore: Store useAgentDrilldownStore.ts does not import from api.ts — may not fetch live Hermes data
**Fix:** Wire useAgentDrilldownStore.ts to call bridge functions from api.ts

### 2. [MEDIUM] useNotifyStore: Store useNotifyStore.ts does not import from api.ts — may not fetch live Hermes data
**Fix:** Wire useNotifyStore.ts to call bridge functions from api.ts

### 3. [MEDIUM] useSettingsStore: Store useSettingsStore.ts does not import from api.ts — may not fetch live Hermes data
**Fix:** Wire useSettingsStore.ts to call bridge functions from api.ts

### 4. [MEDIUM] useTaskFocusStore: Store useTaskFocusStore.ts does not import from api.ts — may not fetch live Hermes data
**Fix:** Wire useTaskFocusStore.ts to call bridge functions from api.ts

### 5. [MEDIUM] Navigation: Layout.tsx only has 0 nav paths, expected >=10
**Fix:** Add missing MODULES entries to Layout.tsx

## Success Criteria
- [ ] All pages fetch real data from Hermes bridge (not mocks)
- [ ] TypeScript build passes (`npm run build`)
- [ ] No silent failures — errors are visible in UI
- [ ] Navigation menu visible on all pages
- [ ] Real agent count matches Hermes CLI output
- [ ] Real task count matches `hermes kanban list --json`

## Files to Modify
- `src/stores/useGhostStore.ts` — Fetch real Hermes agents
- `src/stores/useTaskStore.ts` — Fetch real Hermes tasks
- `src/stores/useSystemStore.ts` — Fetch real Hermes status
- `src/stores/useBriefingStore.ts` — Fetch real Hermes briefings
- `src/pages/GhostNetwork.tsx` — Display real agents
- `src/pages/WarRoom.tsx` — Display real metrics
- `src/pages/OperationsCenter.tsx` — Display real tasks
- `src/pages/BriefingTerminal.tsx` — Display real briefings
- `src/lib/api.ts` — Ensure all bridge endpoints exist

## Constraints
- Edit existing files in-place (do not create new files unless necessary)
- Preserve existing cyberpunk visual style
- Add error states so UI shows when data fails to load
- Test build after every change

## Report Back
When complete, write a summary of changes to `.hermes/audit-report.md`
