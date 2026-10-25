import { create } from "zustand";
import { loadSettings, saveSettings } from "../db/settings";
import { DEFAULT_SETTINGS } from "../domain/settings";
import type { Settings } from "../domain/types";

type SettingsStore = {
  settings: Settings;
  hydrate: () => Promise<void>;
  update: (patch: Partial<Settings>) => void;
};

// Writes are chained so a burst of changes (e.g. dragging the color picker) lands in order.
let writes = Promise.resolve();

export const useSettings = create<SettingsStore>((set, get) => ({
  settings: DEFAULT_SETTINGS,
  hydrate: async () => set({ settings: await loadSettings() }),
  update: (patch) => {
    const settings = { ...get().settings, ...patch };
    set({ settings });
    writes = writes.then(() => saveSettings(settings)).catch((err) => console.error("Failed to save settings", err));
  },
}));
