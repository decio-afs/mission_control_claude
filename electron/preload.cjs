// Minimal, safe preload. Exposes a tiny flag so the React app can tell it is
// running inside the desktop shell rather than a plain browser tab, plus a
// single IPC verb letting the Bridge Diagnostics panel (re)start the bridge.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('missionControl', {
  desktop: true,
  bridgePort: process.env.BRIDGE_PORT || '8767',
  startBridge: () => ipcRenderer.invoke('bridge:start'),
});
