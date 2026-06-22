// Electron main process for Mission Control (local desktop app).
// Responsibilities:
//   1. Launch the Mission Control bridge (mission-control-bridge.py) as a child process.
//   2. Wait for the bridge to answer, then open the desktop window.
//   3. Tear the bridge down when the app quits.
const { app, BrowserWindow, shell, session, ipcMain } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const http = require('http');

const ROOT = path.join(__dirname, '..');
const BRIDGE_PORT = process.env.BRIDGE_PORT || '8767';
// In dev, set MC_DEV_URL=http://localhost:3001 and run `npm run dev` separately.
const DEV_URL = process.env.MC_DEV_URL || '';

let bridgeProc = null;
let win = null;

// Bridge supervision: if the bridge dies while the app is still running, the
// dashboard loses its only backend. Auto-restart it (with exponential backoff)
// unless we're intentionally quitting. A run that stays up a while resets the
// counter, so only a genuine crash-loop trips the give-up guard.
let isQuitting = false;
let restartTimer = null;
let restarts = 0;
const MAX_RAPID_RESTARTS = 5;

function startBridge() {
  const py = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
  console.log(`[mc] starting Mission Control bridge: ${py} mission-control-bridge.py (port ${BRIDGE_PORT})`);
  bridgeProc = spawn(py, ['mission-control-bridge.py'], {
    cwd: ROOT,
    env: { ...process.env, BRIDGE_PORT },
    stdio: 'inherit',
  });
  const startedAt = Date.now();
  bridgeProc.on('error', (e) => console.error('[mc] bridge failed to start:', e.message));
  bridgeProc.on('exit', (code, signal) => {
    console.log('[mc] bridge exited with', code === null ? `signal ${signal}` : `code ${code}`);
    bridgeProc = null;
    if (isQuitting) return; // expected teardown on quit — do not restart

    // A bridge that had been healthy for a while then died is not a crash loop.
    if (Date.now() - startedAt > 20000) restarts = 0;
    if (restarts >= MAX_RAPID_RESTARTS) {
      console.error('[mc] bridge keeps exiting; auto-restart disabled — relaunch the app.');
      return;
    }
    restarts += 1;
    const delay = Math.min(8000, 500 * 2 ** (restarts - 1));
    console.log(`[mc] auto-restarting bridge in ${delay}ms (attempt ${restarts}/${MAX_RAPID_RESTARTS})`);
    restartTimer = setTimeout(() => { if (!isQuitting) startBridge(); }, delay);
  });
}

// Renderer-triggered bridge (re)start — used by the Bridge Diagnostics panel
// when its probes find the bridge down (e.g. it crashed and the auto-restart
// guard gave up, or it was killed externally). Manual intent resets the
// crash-loop counter so a deliberate start always gets its full retry budget.
ipcMain.handle('bridge:start', async () => {
  if (bridgeProc && !bridgeProc.killed) {
    return { ok: true, already: true };
  }
  // The bridge may be running outside our supervision (npm run bridge) — don't
  // spawn a second copy onto the same port.
  if (await waitForBridge(0)) {
    return { ok: true, already: true };
  }
  restarts = 0;
  if (restartTimer) { clearTimeout(restartTimer); restartTimer = null; }
  startBridge();
  const ok = await waitForBridge(20);
  return { ok, already: false };
});

function waitForBridge(retries = 40) {
  // Probe /api/ping (instant, no CLI shell-out). An older status probe
  // ran a CLI per request (1-4s) — slower than the 1s probe
  // timeout, so every attempt timed out and the window opened ~60s late.
  return new Promise((resolve) => {
    const attempt = (n) => {
      const req = http.get(
        { host: '127.0.0.1', port: BRIDGE_PORT, path: '/api/ping', timeout: 1500 },
        (res) => { res.resume(); resolve(true); },
      );
      req.on('error', () => (n <= 0 ? resolve(false) : setTimeout(() => attempt(n - 1), 500)));
      req.on('timeout', () => { req.destroy(); n <= 0 ? resolve(false) : setTimeout(() => attempt(n - 1), 500); });
    };
    attempt(retries);
  });
}

async function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    backgroundColor: '#050505',
    title: 'Mission Control · Claude',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Allow microphone access (used by the chat voice-dictation feature). This is a
  // local-only desktop app, so auto-grant media permission rather than prompting.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(permission === 'media' || permission === 'microphone');
  });

  // Open external links in the system browser, not inside the app window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  if (DEV_URL) {
    await win.loadURL(DEV_URL);
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    await win.loadFile(path.join(ROOT, 'dist', 'index.html'));
  }
}

// Single-instance lock so we never run two bridges at once.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(async () => {
    // Reuse a bridge that's already up (npm run bridge, the dev-server
    // launcher, or a previous session) instead of double-binding port 8767.
    if (await waitForBridge(2)) {
      console.log('[mc] bridge already running on port ' + BRIDGE_PORT + ' — reusing it');
    } else {
      startBridge();
      await waitForBridge();
    }
    await createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

function shutdown() {
  isQuitting = true;
  if (restartTimer) { clearTimeout(restartTimer); restartTimer = null; }
  if (bridgeProc && !bridgeProc.killed) {
    try { bridgeProc.kill(); } catch { /* already gone */ }
    bridgeProc = null;
  }
}

app.on('window-all-closed', () => {
  // On macOS the app (and its supervised bridge) conventionally stay alive in the
  // dock after the last window closes, to be reopened via `activate`. Tearing the
  // bridge down here — and latching `isQuitting` — would leave a dock-reopened
  // window pointing at a dead, un-supervised backend. Let `before-quit` handle
  // teardown on a real quit (Cmd-Q) instead.
  if (process.platform !== 'darwin') {
    shutdown();
    app.quit();
  }
});
app.on('before-quit', shutdown);
process.on('exit', shutdown);
