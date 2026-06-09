// Minimal, safe preload. Exposes a tiny flag so the React app can tell it is
// running inside the desktop shell rather than a plain browser tab.
const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('missionControl', {
  desktop: true,
  bridgePort: process.env.BRIDGE_PORT || '8767',
});
