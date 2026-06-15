# Mission Control · Claude

A **local desktop app** (Electron) for **Claude**. Every screen
renders **live data** from your local Claude install — agents, kanban tasks, cron
jobs, and bridge status. Nothing is deployed and nothing leaves your machine.

```
┌──────────────────────────┐   spawns    ┌──────────────────┐  subprocess  ┌──────────┐
│  Electron desktop window │ ──────────▶ │  mission-control-bridge   │ ───────────▶ │  claude  │
│  (React app, file://)    │   on launch │  (FastAPI :8767) │   CLI calls  │  CLI     │
└──────────────────────────┘ ◀──HTTP──── └──────────────────┘              └──────────┘
```

The desktop process launches the Mission Control bridge for you and shuts it down on quit —
one window, no separate servers to babysit.

## Modules

**Live (real Mission Control data):**

| Module             | Source (Claude CLI)                                          |
|--------------------|-------------------------------------------------------------|
| **Claude Command** | `kanban assignees`, `kanban list`, `cron list`, `chat -q` (spawn) |
| **Ghost Network**  | `kanban assignees` → agent topology visualization           |
| **War Room**       | `--version`, agents, tasks, cron → live metrics             |
| **Operations**     | `kanban list/create/claim/complete/block`, `cron list/run`  |

**Design showcase (static demo data — Claude has no source for these; marked
`DEMO DATA` in the UI):** Intel Deck, Content Factory, Briefing, Workflow
Builder, Archives, Broadcast Uplink. These preserve the full original design.
Static demo data lives in `src/lib/legionData.ts`.

## Prerequisites

- [Claude](https://github.com/) installed and on your `PATH` (`claude --version`)
- Python 3.11+ with `fastapi` and `uvicorn` (`pip install fastapi uvicorn`)
- Node 20+

## Run (desktop app)

**Simplest — double-click `start.bat`** (Windows). It installs deps on first run,
builds the UI, opens the desktop window, and auto-starts/stops the Mission Control bridge.

Or from a terminal:

```bash
npm install   # first time only
npm start     # = npm run desktop
```

`npm start` builds the UI, opens the desktop window, auto-starts the Mission Control
bridge on launch, and stops it on close. That's the whole workflow.

### Dev mode (hot reload)

Run the Vite dev server and point the desktop shell at it:

```bash
npm run dev                                   # terminal 1 → http://localhost:3001
MC_DEV_URL=http://localhost:3001 npm run desktop:dev   # terminal 2 (opens devtools)
```

> On Windows PowerShell: `$env:MC_DEV_URL="http://localhost:3001"; npm run desktop:dev`

You can also just run the bridge alone (`npm run bridge`) and open the UI in a
browser at http://localhost:3001 via `npm run dev` if you prefer.

## Configuration

Single env var in `.env.local` (gitignored):

```bash
VITE_BRIDGE_URL=http://localhost:8767
```

Optional bridge env vars: `MC_HOME`, `BRIDGE_PORT`
(default `8767`), `CORS_ORIGINS`. The Electron shell honors `PYTHON` (python
executable) and `BRIDGE_PORT`.

### Optional: offline voice dictation in the chat tab

The Ghost Comms chat supports microphone dictation. In the packaged desktop app
this uses a **local Whisper** model so nothing leaves your machine:

```bash
pip install faster-whisper
```

Tune with `WHISPER_MODEL` (default `base.en`), `WHISPER_DEVICE` (`cpu`/`cuda`),
`WHISPER_COMPUTE` (`int8`). If `faster-whisper` isn't installed, the mic falls
back to the browser Web Speech API (works in `npm run dev`, not in Electron).

See [AGENTS.md](AGENTS.md) for architecture and contribution details.
