import { create } from 'zustand';

// Live-data context (bloodhound): this store does NOT fetch from the bridge —
// by design. It is a pure UI-preference store persisted to localStorage; it
// holds no Mc data and has no live data source to wire.
//
// UI preference store — persisted to localStorage (same hand-rolled pattern as
// `mc-tweaks` in Layout). Holds switches that trade fidelity for resources;
// the Ghost Office scene is only code-split-loaded when richNetworkUI is on.
const KEY = 'mc-settings';

interface PersistedSettings {
  richNetworkUI: boolean;
}

const DEFAULTS: PersistedSettings = { richNetworkUI: false };

function load(): PersistedSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch { /* ignore bad cache */ }
  return DEFAULTS;
}

interface SettingsStore extends PersistedSettings {
  setRichNetworkUI: (on: boolean) => void;
}

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  ...load(),
  setRichNetworkUI: (on) => {
    set({ richNetworkUI: on });
    try {
      const { richNetworkUI } = get();
      localStorage.setItem(KEY, JSON.stringify({ richNetworkUI } satisfies PersistedSettings));
    } catch { /* storage unavailable */ }
  },
}));
