#!/usr/bin/env python3
"""
Mission Control DATA-SOURCE BLOODHOUND

Analyzes every src/pages/*.tsx file, traces its data provenance, and classifies
components as LIVE (real Hermes bridge), DEMO (intentional static/demo data), or
STRANDED (should be live but has no bridge integration).

For every STRANDED component the script generates copy-pasteable TypeScript/React
fetch-pipeline code: store patch, API addition, and component wiring.

Preserves the original build-check and bridge-check functionality.

Usage:
    python audit-and-improve.py           # Full cycle
    python audit-and-improve.py --dry-run # Audit only, no Claude Code
"""

from __future__ import annotations

import argparse
import datetime
import json
import os
import re
import subprocess
import sys
import textwrap
from pathlib import Path
from typing import Any

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
MISSION_CONTROL_DIR = Path("C:/Users/decio/Documents/Business Projects/05_Web_Devs/Mission_Control")
CLAUDE_CMD = "claude"

LOG_FILE = MISSION_CONTROL_DIR / ".hermes" / "audit-log.txt"
REPORT_FILE = MISSION_CONTROL_DIR / ".hermes" / "audit-report.md"
INSTRUCTIONS_FILE = MISSION_CONTROL_DIR / ".hermes" / "audit-instructions.md"

# Files that are KNOWN intentional demo modules (no Hermes data source exists).
# These are flagged as DEMO, not STRANDED, unless they suddenly start importing
# bridge code — then we treat them as already migrating.
INTENTIONAL_DEMO_MODULES = {
    "IntelligenceDeck.tsx",
    "ContentFactory.tsx",
    "WorkflowBuilder.tsx",
    "Archives.tsx",
    "BroadcastUplink.tsx",
}

# Patterns that indicate a component is consuming DEMO / STATIC data
DEMO_PATTERNS = [
    r"from\s+['\"]\.\./lib/legionData['\"]",
    r"import\s+.*\s+from\s+['\"]\.\./lib/legionData['\"]",
    r"DEMO_NOTE",
    r"DemoBadge",
    r"MOCK_",
    r"mock[A-Z]",
    # Only flag hardcoded arrays when they are NOT preceded by live data mapping
    r"const\s+(trends|slides|queue|rows|nav|channels|nodes|edges)\s*:",
    r"const\s+(trends|slides|queue|rows|nav|channels|nodes|edges)\s*=\s*\[",
    r"sampleData",
    r"fakeData",
    r"hardcoded",
    r"staticData",
    r"placeholderData",
    r"DEMO DATA",
    r"//\s*NOTE:\s*static demo data",
    r"//\s*NOTE:\s*static demo",
    r"//\s*NOTE:\s*no Hermes source",
]

# Files that are KNOWN to use live data but may match DEMO_PATTERNS accidentally
# (e.g., ContentFactory maps live Hermes tasks into campaigns/drafts/calendar)
LIVE_OVERRIDES = {
    "ContentFactory.tsx",
}

# Patterns that indicate a component is LIVE (fetching from Hermes bridge)
LIVE_PATTERNS = [
    r"from\s+['\"]\.\./lib/api['\"]",
    r"import\s+.*\s+from\s+['\"]\.\./lib/api['\"]",
    r"from\s+['\"]\.\./stores/useGhostStore['\"]",
    r"from\s+['\"]\.\./stores/useTaskStore['\"]",
    r"from\s+['\"]\.\./stores/useSystemStore['\"]",
    r"from\s+['\"]\.\./stores/useBriefingStore['\"]",
    r"from\s+['\"]\.\./stores/useChatStore['\"]",
    r"getHermes",
    r"useGhostStore",
    r"useTaskStore",
    r"useSystemStore",
    r"useBriefingStore",
    r"useChatStore",
    r"fetchTopology",
    r"fetchTasks",
    r"fetchHermesStatus",
    r"refresh\(\)",  # briefing store
    r"sendHermesChat",
    r"spawnHermesAgent",
    r"createHermesTask",
    r"claimHermesTask",
    r"completeHermesTask",
    r"blockHermesTask",
    r"runHermesCron",
    r"getHermesCron",
    r"getHermesAgents",
    r"getHermesTasks",
    r"getHermesStatus",
    r"getHermesBriefing",
]

# Bridge API functions that should exist in api.ts
REQUIRED_API_FUNCTIONS = [
    "getHermesStatus",
    "getHermesAgents",
    "getHermesTasks",
    "getHermesCron",
    "createHermesTask",
    "claimHermesTask",
    "completeHermesTask",
    "blockHermesTask",
    "runHermesCron",
    "spawnHermesAgent",
    "sendHermesChat",
    "getHermesBriefing",
]

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
def log(msg: str) -> None:
    timestamp = datetime.datetime.now().isoformat()
    line = f"[{timestamp}] {msg}"
    print(line)
    try:
        with open(LOG_FILE, "a", encoding="utf-8") as f:
            f.write(line + "\n")
    except Exception:
        pass


def ensure_dirs() -> None:
    (MISSION_CONTROL_DIR / ".hermes").mkdir(parents=True, exist_ok=True)


# ---------------------------------------------------------------------------
# File reading helpers
# ---------------------------------------------------------------------------
def read_file_text(path: Path) -> str:
    if not path.exists():
        return ""
    try:
        return path.read_text(encoding="utf-8")
    except Exception:
        return ""


def find_matches(content: str, patterns: list[str]) -> list[str]:
    found = []
    for pat in patterns:
        if re.search(pat, content):
            found.append(pat)
    return found


# ---------------------------------------------------------------------------
# Build / Bridge checks (preserved from original)
# ---------------------------------------------------------------------------
def check_build() -> tuple[bool, str]:
    log("Checking build...")
    result = subprocess.run(
        ["npm", "run", "build"],
        cwd=MISSION_CONTROL_DIR,
        capture_output=True,
        text=True,
        shell=True,
    )
    ok = result.returncode == 0
    tail = result.stdout[-1000:] if result.stdout else ""
    return ok, tail


def check_bridge() -> tuple[bool, int, int]:
    log("Checking Hermes bridge...")
    bridge_ok = False
    agents = 0
    tasks = 0
    try:
        import urllib.request

        req = urllib.request.urlopen("http://localhost:8767/api/hermes/status", timeout=5)
        data = json.loads(req.read())
        bridge_ok = data.get("bridge") == "ok"

        req_a = urllib.request.urlopen("http://localhost:8767/api/hermes/agents", timeout=5)
        agents = len(json.loads(req_a.read()).get("agents", []))

        req_t = urllib.request.urlopen("http://localhost:8767/api/hermes/tasks", timeout=5)
        tasks = len(json.loads(req_t.read()).get("tasks", []))
    except Exception as e:
        log(f"Bridge check failed: {e}")
    return bridge_ok, agents, tasks


# ---------------------------------------------------------------------------
# Data-source bloodhound
# ---------------------------------------------------------------------------
def analyze_pages() -> dict[str, Any]:
    pages_dir = MISSION_CONTROL_DIR / "src" / "pages"
    if not pages_dir.exists():
        log("WARNING: src/pages/ not found")
        return {"live": [], "demo": [], "stranded": [], "unknown": []}

    live: list[dict] = []
    demo: list[dict] = []
    stranded: list[dict] = []
    unknown: list[dict] = []

    for tsx in sorted(pages_dir.glob("*.tsx")):
        content = read_file_text(tsx)
        if not content.strip():
            continue

        name = tsx.name
        demo_hits = find_matches(content, DEMO_PATTERNS)
        live_hits = find_matches(content, LIVE_PATTERNS)

        # Heuristic classification
        is_intentional_demo = name in INTENTIONAL_DEMO_MODULES
        has_demo_imports = bool(demo_hits)
        has_live_imports = bool(live_hits)

        component = {
            "file": name,
            "path": str(tsx),
            "demo_hits": demo_hits,
            "live_hits": live_hits,
        }

        if has_live_imports and not has_demo_imports:
            live.append(component)
        elif has_demo_imports and not has_live_imports:
            if is_intentional_demo:
                demo.append(component)
            elif name in LIVE_OVERRIDES:
                # Known live component that happens to match a demo pattern
                live.append(component)
            else:
                # A non-intentional-demo page using only static data → STRANDED
                stranded.append(component)
        elif has_live_imports and has_demo_imports:
            # Mixed: could be mid-migration or a live page with some static fallback.
            # If it's an intentional demo module but now has bridge imports, flag as
            # migrating (treat as live with warning).
            if is_intentional_demo:
                component["note"] = "Intentional demo module now has bridge imports — migration in progress?"
                live.append(component)
            elif name in LIVE_OVERRIDES:
                live.append(component)
            else:
                component["note"] = "Uses both live and demo data — verify no mock fallback"
                stranded.append(component)
        else:
            # No clear data source detected
            if is_intentional_demo:
                demo.append(component)
            elif name in LIVE_OVERRIDES:
                live.append(component)
            else:
                unknown.append(component)

    return {"live": live, "demo": demo, "stranded": stranded, "unknown": unknown}


def analyze_stores() -> list[dict]:
    stores_dir = MISSION_CONTROL_DIR / "src" / "stores"
    issues: list[dict] = []
    if not stores_dir.exists():
        return issues

    for store_file in sorted(stores_dir.glob("*.ts")):
        content = read_file_text(store_file)
        if not content:
            continue

        # Silent failure detection
        if "catch" in content and "console.error" in content:
            if "set({" not in content and "setError" not in content and "error:" not in content:
                issues.append({
                    "severity": "medium",
                    "component": store_file.stem,
                    "issue": "Store catches errors but doesn't set error state — UI shows stale/empty data silently",
                    "fix": f"Add error state to {store_file.name} and expose it to UI",
                })

        # Check live stores actually call bridge
        if store_file.name.startswith("use") and store_file.name.endswith("Store.ts"):
            if "getHermes" not in content and "api.ts" not in content:
                # UI-coordination stores (drilldown open/close, task focus, notify
                # history) legitimately never touch the bridge — they consume live
                # data via other stores or only hold UI state. They declare this
                # with a "bloodhound" marker comment. Don't flag those, and NEVER
                # suggest adding an import to satisfy this check: an unused import
                # fails `tsc -b` (noUnusedLocals) and breaks the desktop build.
                live_store_consumers = ["useGhostStore", "useTaskStore", "useSystemStore", "useBriefingStore", "useChatStore"]
                is_ui_coordination = "bloodhound" in content.lower() or any(ls in content for ls in live_store_consumers)
                if store_file.name == "useChatStore.ts" or is_ui_coordination:
                    # useChatStore is hybrid (calls sendHermesChat); marked stores
                    # are intentional UI-state only.
                    pass
                else:
                    issues.append({
                        "severity": "medium",
                        "component": store_file.stem,
                        "issue": f"Store {store_file.name} does not import from api.ts — may not fetch live Hermes data",
                        "fix": (
                            f"If {store_file.name} should display live data, wire it to CALL a bridge "
                            "function from api.ts (an actually-invoked call, e.g. getHermes*). If it is "
                            "intentionally UI-state only, add a '// Live-data context (bloodhound): ...' "
                            "comment explaining where its data comes from. NEVER add an unused import — "
                            "tsc's noUnusedLocals fails the build on unused imports."
                        ),
                    })

        # Check stores that import api.ts but don't actually call bridge functions
        if store_file.name.startswith("use") and store_file.name.endswith("Store.ts"):
            # Use regex to detect actual import statements from api.ts, not just
            # comments or strings that happen to contain "api.ts".
            has_api_import = bool(re.search(r"from\s+['\"]\.\./lib/api['\"]", content))
            if has_api_import and "getHermes" not in content:
                # UI-coordination stores (drilldown, focus, notify) import api.ts
                # for bloodhound context but don't fetch directly — they consume
                # live data from other stores. Only flag if there's no evidence
                # they consume live store data.
                live_store_consumers = ["useGhostStore", "useTaskStore", "useSystemStore", "useBriefingStore", "useChatStore"]
                consumes_live = any(ls in content for ls in live_store_consumers)
                if not consumes_live:
                    issues.append({
                        "severity": "medium",
                        "component": store_file.stem,
                        "issue": f"Store {store_file.name} imports api.ts but does not call bridge functions or consume live stores — may be stranded",
                        "fix": f"Wire {store_file.name} to call bridge functions from api.ts or consume live store data",
                    })

    return issues


def analyze_api() -> list[dict]:
    api_file = MISSION_CONTROL_DIR / "src" / "lib" / "api.ts"
    issues: list[dict] = []
    if not api_file.exists():
        issues.append({
            "severity": "critical",
            "component": "API",
            "issue": "api.ts not found",
            "fix": "Recreate src/lib/api.ts with bridge client and Hermes types",
        })
        return issues

    content = read_file_text(api_file)
    if "BRIDGE_BASE_URL" not in content and "baseURL" not in content:
        issues.append({
            "severity": "high",
            "component": "API",
            "issue": "No BRIDGE_BASE_URL or axios baseURL configured",
            "fix": "Add BRIDGE_BASE_URL pointing to http://localhost:8767",
        })

    for endpoint in REQUIRED_API_FUNCTIONS:
        if endpoint not in content:
            issues.append({
                "severity": "high",
                "component": "API",
                "issue": f"Missing API function: {endpoint}",
                "fix": f"Add {endpoint} to api.ts",
            })

    return issues


def analyze_routing() -> list[dict]:
    issues: list[dict] = []
    app_file = MISSION_CONTROL_DIR / "src" / "App.tsx"
    layout_file = MISSION_CONTROL_DIR / "src" / "components" / "Layout.tsx"

    if app_file.exists():
        content = read_file_text(app_file)
        # Count routes inside Layout
        route_count = content.count('element={')
        if route_count < 10:
            issues.append({
                "severity": "medium",
                "component": "Routing",
                "issue": f"App.tsx only has ~{route_count} route elements, expected >=10",
                "fix": "Add missing routes to App.tsx",
            })

    if layout_file.exists():
        content = read_file_text(layout_file)
        # Layout.tsx now imports MODULES from src/lib/nav.ts instead of inline paths
        # Check for the MODULES import to confirm navigation is configured
        has_modules_import = "MODULES" in content and "from '../lib/nav'" in content
        nav_count = content.count("path:")
        if not has_modules_import and nav_count < 10:
            issues.append({
                "severity": "medium",
                "component": "Navigation",
                "issue": f"Layout.tsx only has {nav_count} nav paths, expected >=10",
                "fix": "Add missing MODULES entries to Layout.tsx or src/lib/nav.ts",
            })

    return issues


# ---------------------------------------------------------------------------
# Code generation for stranded components
# ---------------------------------------------------------------------------
def generate_store_patch(component_name: str) -> str:
    """Generate a Zustand store snippet for a stranded component."""
    store_name = f"use{component_name}Store"
    return textwrap.dedent(
        f"""\
        // ---------------------------------------------------------------------------
        // Generated store patch for {component_name}
        // Place in src/stores/{store_name}.ts
        // ---------------------------------------------------------------------------
        import {{ create }} from 'zustand';
        import {{ getHermesStatus, errMessage }} from '../lib/api';

        interface {component_name}Data {{
          items: any[];
          isLoading: boolean;
          error: string | null;
          lastSync: Date | null;
        }}

        interface {store_name} extends {component_name}Data {{
          fetch: () => Promise<void>;
        }}

        export const {store_name} = create<{store_name}>((set) => ({{
          items: [],
          isLoading: false,
          error: null,
          lastSync: null,

          fetch: async () => {{
            set({{ isLoading: true }});
            try {{
              // TODO: replace with real endpoint once bridge supports it
              const data = await getHermesStatus();
              set({{
                items: (data as any).items || [],
                error: null,
                isLoading: false,
                lastSync: new Date(),
              }});
            }} catch (err) {{
              const msg = errMessage(err);
              console.error('[{store_name}] fetch failed:', msg);
              set({{ error: msg, isLoading: false }});
            }}
          }},
        }}));
        """
    )


def generate_api_addition(component_name: str) -> str:
    """Generate an API function stub for api.ts."""
    camel = component_name[0].lower() + component_name[1:]
    return textwrap.dedent(
        f"""\
        // ---------------------------------------------------------------------------
        // Generated API addition for {component_name}
        // Add to src/lib/api.ts
        // ---------------------------------------------------------------------------
        export async function getHermes{component_name}(): Promise<{{ items: any[] }}> {{
          const {{ data }} = await bridge.get('/api/hermes/{camel}');
          return data;
        }}
        """
    )


def generate_component_wiring(component_name: str, file_name: str) -> str:
    """Generate component wiring snippet."""
    store_name = f"use{component_name}Store"
    hook_name = f"fetch{component_name}"
    return textwrap.dedent(
        f"""\
        // ---------------------------------------------------------------------------
        // Generated component wiring for {file_name}
        // ---------------------------------------------------------------------------
        import {{ {store_name} }} from '../stores/{store_name}';

        export default function {component_name}() {{
          const {{ items, isLoading, error, fetch }} = {store_name}();

          useEffect(() => {{
            fetch();
            const id = setInterval(fetch, 15000);
            return () => clearInterval(id);
          }}, [fetch]);

          if (isLoading && !items.length) {{
            return <div className="text-[10px] font-mono text-[#545454]">Syncing with Hermes bridge…</div>;
          }}

          if (error) {{
            return <div className="text-[10px] font-mono text-red-400">⚠ {{error}}</div>;
          }}

          // TODO: replace static arrays with `items` mapped from live data
          return (
            <div>
              {{/* Render live data here */}}
            </div>
          );
        }}
        """
    )


def generate_pipeline_for(component: dict) -> dict:
    name = component["file"].replace(".tsx", "")
    return {
        "component": name,
        "store_patch": generate_store_patch(name),
        "api_addition": generate_api_addition(name),
        "component_wiring": generate_component_wiring(name, component["file"]),
    }


# ---------------------------------------------------------------------------
# Full audit
# ---------------------------------------------------------------------------
def audit_codebase() -> dict[str, Any]:
    issues: list[dict] = []

    # Build check
    build_ok, build_tail = check_build()
    if not build_ok:
        issues.append({
            "severity": "critical",
            "component": "Build",
            "issue": "TypeScript build fails",
            "fix": f"Fix build errors:\n{build_tail}",
        })

    # Bridge check
    bridge_ok, bridge_agents, bridge_tasks = check_bridge()
    if not bridge_ok:
        issues.append({
            "severity": "critical",
            "component": "Hermes Bridge",
            "issue": "Bridge not accessible",
            "fix": "Start the bridge: python hermes-bridge.py",
        })

    # Page bloodhound
    log("Running data-source bloodhound on src/pages/*.tsx ...")
    page_analysis = analyze_pages()

    # Store analysis
    log("Analyzing stores...")
    store_issues = analyze_stores()
    issues.extend(store_issues)

    # API analysis
    log("Analyzing API client...")
    api_issues = analyze_api()
    issues.extend(api_issues)

    # Routing analysis
    log("Analyzing routing...")
    routing_issues = analyze_routing()
    issues.extend(routing_issues)

    # Generate pipelines for stranded components
    pipelines = [generate_pipeline_for(c) for c in page_analysis["stranded"]]

    # Cross-check: any intentional demo that now has bridge imports?
    for comp in page_analysis["demo"]:
        if comp["live_hits"]:
            issues.append({
                "severity": "medium",
                "component": comp["file"].replace(".tsx", ""),
                "issue": "Intentional demo module now has bridge imports — may be mid-migration",
                "fix": "Complete migration: remove legionData.ts imports and wire fully to bridge",
            })

    # Cross-check: any live component that still has demo fallback?
    for comp in page_analysis["live"]:
        if comp["demo_hits"]:
            issues.append({
                "severity": "medium",
                "component": comp["file"].replace(".tsx", ""),
                "issue": "Live component still references demo/static data patterns",
                "fix": "Remove static fallback data and ensure 100% bridge-driven rendering",
            })

    return {
        "timestamp": datetime.datetime.now().isoformat(),
        "total_issues": len(issues),
        "critical": len([i for i in issues if i["severity"] == "critical"]),
        "high": len([i for i in issues if i["severity"] == "high"]),
        "medium": len([i for i in issues if i["severity"] == "medium"]),
        "issues": issues,
        "build_success": build_ok,
        "bridge_ok": bridge_ok,
        "bridge_agents": bridge_agents,
        "bridge_tasks": bridge_tasks,
        "page_analysis": page_analysis,
        "pipelines": pipelines,
    }


# ---------------------------------------------------------------------------
# Report generation
# ---------------------------------------------------------------------------
def write_instructions(audit: dict) -> str:
    instructions = f"""# Mission Control Improvement Instructions

Generated: {audit['timestamp']}
Audit Result: {audit['total_issues']} issues found ({audit['critical']} critical, {audit['high']} high, {audit['medium']} medium)

## Mission
Fix Mission Control web app so it displays REAL data from Hermes bridge instead of mock/hardcoded data.

## Current State
- Build: {'PASS' if audit['build_success'] else 'FAIL'}
- Bridge: {'ONLINE' if audit['bridge_ok'] else 'OFFLINE'}
- Bridge Agents: {audit.get('bridge_agents', 0)}
- Bridge Tasks: {audit.get('bridge_tasks', 0)}

## Data-Source Bloodhound Results

### LIVE Components (bridge-connected)
"""
    for c in audit["page_analysis"]["live"]:
        note = f" — *{c.get('note', '')}*" if c.get("note") else ""
        instructions += f"- ✅ `{c['file']}`{note}\n"

    instructions += "\n### DEMO Components (intentional static data)\n"
    for c in audit["page_analysis"]["demo"]:
        instructions += f"- 📊 `{c['file']}` — uses legionData.ts / DemoBadge (no Hermes source exists)\n"

    instructions += "\n### STRANDED Components (should be live but no bridge integration)\n"
    if audit["page_analysis"]["stranded"]:
        for c in audit["page_analysis"]["stranded"]:
            instructions += f"- ⚠️ `{c['file']}` — no bridge imports detected\n"
    else:
        instructions += "- None found 🎉\n"

    if audit["page_analysis"]["unknown"]:
        instructions += "\n### UNKNOWN Components (no clear data source detected)\n"
        for c in audit["page_analysis"]["unknown"]:
            instructions += f"- ❓ `{c['file']}`\n"

    instructions += "\n## Issues to Fix\n"
    for i, issue in enumerate(audit["issues"], 1):
        instructions += f"""
### {i}. [{issue['severity'].upper()}] {issue['component']}: {issue['issue']}
**Fix:** {issue['fix']}
"""

    # Append generated pipelines
    if audit["pipelines"]:
        instructions += "\n## Generated Fetch Pipelines (for STRANDED components)\n"
        for pipe in audit["pipelines"]:
            instructions += f"""
### {pipe['component']}

#### 1. Store Patch — `src/stores/use{pipe['component']}Store.ts`
```typescript
{pipe['store_patch']}
```

#### 2. API Addition — add to `src/lib/api.ts`
```typescript
{pipe['api_addition']}
```

#### 3. Component Wiring — update `src/pages/{pipe['component']}.tsx`
```typescript
{pipe['component_wiring']}
```
"""

    instructions += """
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
- NEVER add an unused import (e.g. `import { bridge }` just to mark a file as
  live-data) — tsc's noUnusedLocals fails `npm run desktop` on unused imports,
  and an eslint-disable comment does NOT silence tsc. To mark a UI-state-only
  store, use a `// Live-data context (bloodhound): ...` comment instead.
- `tsc -b && vite build` must pass before you finish

## Report Back
When complete, write a summary of changes to `.hermes/audit-report.md`
"""

    with open(INSTRUCTIONS_FILE, "w", encoding="utf-8") as f:
        f.write(instructions)
    return str(INSTRUCTIONS_FILE)


def write_report(audit: dict, verification: dict, claude_success: bool) -> str:
    report = f"""# Mission Control Audit Report

**Timestamp:** {audit['timestamp']}
**Issues Found:** {audit['total_issues']} ({audit['critical']} critical, {audit['high']} high, {audit['medium']} medium)
**Build Status:** {'PASS ✅' if verification['build_success'] else 'FAIL ❌'}
**Bridge Status:** {'ONLINE ✅' if verification['bridge_ok'] else 'OFFLINE ❌'}
**Claude Code:** {'SUCCESS ✅' if claude_success else 'FAILED ❌'}

## Data-Source Bloodhound

### LIVE Components
"""
    for c in audit["page_analysis"]["live"]:
        note = f" — {c.get('note', '')}" if c.get("note") else ""
        report += f"- ✅ `{c['file']}`{note}\n"

    report += "\n### DEMO Components (intentional)\n"
    for c in audit["page_analysis"]["demo"]:
        report += f"- 📊 `{c['file']}`\n"

    report += "\n### STRANDED Components\n"
    if audit["page_analysis"]["stranded"]:
        for c in audit["page_analysis"]["stranded"]:
            report += f"- ⚠️ `{c['file']}`\n"
    else:
        report += "- None 🎉\n"

    report += "\n## Issues Discovered\n"
    for issue in audit["issues"]:
        report += f"- **[{issue['severity'].upper()}]** {issue['component']}: {issue['issue']}\n"

    report += f"""
## Actions Taken
- Audited Mission Control codebase
- {'Triggered Claude Code to fix issues' if claude_success else 'Claude Code trigger failed'}
- Verified build {'passes' if verification['build_success'] else 'fails'}

## Next Steps
- {'Monitor next cron cycle' if claude_success else 'Manually fix remaining issues'}
- Verify UI shows real Hermes data

---
*Generated by Mission Control Data-Source Bloodhound*
"""

    with open(REPORT_FILE, "w", encoding="utf-8") as f:
        f.write(report)
    return str(REPORT_FILE)


# ---------------------------------------------------------------------------
# Claude Code trigger (preserved)
# ---------------------------------------------------------------------------
def trigger_claude_code(instructions_file: str) -> bool:
    log("Triggering Claude Code...")
    try:
        prompt = f"""You are Claude Code, a coding assistant. Read the file {instructions_file} for detailed instructions.

Your mission: Fix the Mission Control web app issues described in that file.

Key rules:
- Edit existing files in-place (do not create new files unless necessary)
- Preserve the cyberpunk visual style
- Maintain Hermes CLI integration
- Run `npm run build` after changes to verify
- Report what you changed

Start by reading {instructions_file} then fix the issues."""

        result = subprocess.run(
            [CLAUDE_CMD, "-p", prompt],
            cwd=MISSION_CONTROL_DIR,
            capture_output=True,
            text=True,
            timeout=300,
            shell=True,
        )
        log(f"Claude Code exit code: {result.returncode}")
        if result.stdout:
            log(f"Claude output: {result.stdout[:500]}")
        if result.stderr:
            log(f"Claude stderr: {result.stderr[:500]}")
        return result.returncode == 0
    except subprocess.TimeoutExpired:
        log("Claude Code timed out after 5 minutes")
        return False
    except FileNotFoundError:
        log("Claude Code CLI not found. Install with: npm install -g @anthropic-ai/claude-code")
        return False


def verify_fixes() -> dict:
    log("Verifying fixes...")
    result = subprocess.run(
        ["npm", "run", "build"],
        cwd=MISSION_CONTROL_DIR,
        capture_output=True,
        text=True,
        shell=True,
    )
    bridge_ok = False
    try:
        import urllib.request

        req = urllib.request.urlopen("http://localhost:8767/api/hermes/status", timeout=5)
        data = json.loads(req.read())
        bridge_ok = data.get("bridge") == "ok"
    except Exception:
        pass

    return {
        "build_success": result.returncode == 0,
        "bridge_ok": bridge_ok,
        "build_output": result.stdout[-500:] if result.stdout else "",
    }


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main() -> None:
    parser = argparse.ArgumentParser(description="Mission Control Data-Source Bloodhound")
    parser.add_argument("--dry-run", action="store_true", help="Audit only, do not trigger Claude Code")
    args = parser.parse_args()
    dry_run = args.dry_run

    ensure_dirs()
    log("=" * 60)
    log("Starting Mission Control Data-Source Bloodhound")

    # Phase 1: Audit
    log("Phase 1: Auditing codebase...")
    audit = audit_codebase()
    log(f"Found {audit['total_issues']} issues ({audit['critical']} critical)")
    log(f"LIVE: {len(audit['page_analysis']['live'])}, DEMO: {len(audit['page_analysis']['demo'])}, STRANDED: {len(audit['page_analysis']['stranded'])}")

    # Phase 2: Write instructions
    log("Phase 2: Writing instructions for Claude Code...")
    instructions_file = write_instructions(audit)
    log(f"Instructions written to {instructions_file}")

    # Phase 3: Trigger Claude Code
    claude_success = False
    if dry_run:
        log("DRY RUN: Skipping Claude Code trigger")
    elif audit["total_issues"] == 0:
        log("No issues found. Mission Control is healthy.")
    else:
        claude_success = trigger_claude_code(instructions_file)
        if not claude_success:
            log("WARNING: Claude Code did not complete successfully")

    # Phase 4: Verify
    log("Phase 4: Verifying fixes...")
    verification = verify_fixes()

    # Phase 5: Report
    log("Phase 5: Writing report...")
    report_file = write_report(audit, verification, claude_success)
    log(f"Report written to {report_file}")

    log("Cycle complete")
    log("=" * 60)

    if audit["critical"] > 0:
        sys.exit(1)
    sys.exit(0)


if __name__ == "__main__":
    main()
