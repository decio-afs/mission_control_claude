# Mission Control Improvement Instructions

Generated: 2026-06-09T00:01:17.806473
Audit Result: 0 issues found (0 critical, 0 high, 0 medium)

## Mission
Fix Mission Control web app so it displays REAL data from Hermes bridge instead of mock/hardcoded data.

## Current State
- Build: PASS
- Bridge: ONLINE
- Bridge Agents: 18
- Bridge Tasks: 8

## Data-Source Bloodhound Results

### LIVE Components (bridge-connected)
- ✅ `AgentHub.tsx`
- ✅ `BriefingTerminal.tsx`
- ✅ `ChatTerminal.tsx`
- ✅ `ContentFactory.tsx`
- ✅ `Cyberpunk.tsx`
- ✅ `GhostNetwork.tsx`
- ✅ `OperationsCenter.tsx`
- ✅ `SignalIntelligence.tsx`
- ✅ `WarRoom.tsx`

### DEMO Components (intentional static data)
- 📊 `Archives.tsx` — uses legionData.ts / DemoBadge (no Hermes source exists)
- 📊 `BroadcastUplink.tsx` — uses legionData.ts / DemoBadge (no Hermes source exists)
- 📊 `IntelligenceDeck.tsx` — uses legionData.ts / DemoBadge (no Hermes source exists)
- 📊 `WorkflowBuilder.tsx` — uses legionData.ts / DemoBadge (no Hermes source exists)

### STRANDED Components (should be live but no bridge integration)
- None found 🎉

### UNKNOWN Components (no clear data source detected)
- ❓ `LeadTracker.tsx`

## Issues to Fix

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
