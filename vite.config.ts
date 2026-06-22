import { defineConfig, type Plugin, type ViteDevServer } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { spawn } from 'node:child_process'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'

const BRIDGE_PORT = process.env.BRIDGE_PORT || '8767'

function probeBridge(timeoutMs = 1500): Promise<boolean> {
  // /api/ping answers instantly (no CLI shell-out) — see mission-control-bridge.py.
  return new Promise((resolve) => {
    const req = http.get(
      { host: '127.0.0.1', port: BRIDGE_PORT, path: '/api/ping', timeout: timeoutMs },
      (res) => { res.resume(); resolve(true) },
    )
    req.on('error', () => resolve(false))
    req.on('timeout', () => { req.destroy(); resolve(false) })
  })
}

// Dev-server twin of the Electron `bridge:start` IPC: the browser build can't
// spawn processes, so the Bridge Diagnostics panel POSTs here and the Vite dev
// server launches mission-control-bridge.py on its behalf. Production/Electron uses the
// preload IPC instead — this middleware only exists while `npm run dev` runs.
function bridgeLauncher(): Plugin {
  return {
    name: 'mc-bridge-launcher',
    configureServer(server: ViteDevServer) {
      server.middlewares.use('/__bridge/start', (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; res.end(); return }
        void (async () => {
          res.setHeader('Content-Type', 'application/json')
          if (await probeBridge()) {
            res.end(JSON.stringify({ ok: true, already: true }))
            return
          }
          const py = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3')
          // Detached bridge has no terminal — capture its output in a log file
          // so "where are the bridge logs?" always has an answer.
          const logPath = path.join(server.config.root, '.mc', 'bridge.log')
          let logFd: number | 'ignore' = 'ignore'
          try { logFd = fs.openSync(logPath, 'a') } catch { /* fall back to ignore */ }
          server.config.logger.info(`[mc] starting Mission Control bridge: ${py} mission-control-bridge.py (port ${BRIDGE_PORT}) — logs → ${logPath}`)
          const child = spawn(py, ['mission-control-bridge.py'], {
            cwd: server.config.root,
            env: { ...process.env, BRIDGE_PORT },
            detached: true,
            stdio: ['ignore', logFd, logFd],
            windowsHide: true,
          })
          // The child inherited its own dup of logFd, so close the dev server's
          // copy — otherwise each /__bridge/start spawn leaks one fd in the
          // long-lived Vite process. Fires exactly once ('spawn' XOR 'error'),
          // guarded against a double-close.
          let logFdClosed = false
          const closeLogFd = () => {
            if (logFd !== 'ignore' && !logFdClosed) {
              logFdClosed = true
              try { fs.closeSync(logFd) } catch { /* already gone */ }
            }
          }
          child.on('spawn', closeLogFd)
          child.on('error', (e) => { closeLogFd(); server.config.logger.error(`[mc] bridge spawn failed: ${e.message}`) })
          child.unref() // bridge outlives the dev server — same as a manual `npm run bridge`
          // Wait for it to answer (up to ~15s) so the panel can re-probe once.
          for (let i = 0; i < 30; i++) {
            if (await probeBridge(500)) {
              res.end(JSON.stringify({ ok: true, already: false }))
              return
            }
            await new Promise((r) => setTimeout(r, 500))
          }
          res.end(JSON.stringify({ ok: false, already: false }))
        })()
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), bridgeLauncher()],
  // Relative base so the built app loads correctly from file:// inside Electron.
  base: './',
  server: {
    port: 3001,
    host: '127.0.0.1',
  }
})
