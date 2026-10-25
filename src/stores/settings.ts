import { create } from "zustand";
import { loadSettings, saveSettings } from "../db/settings";
import { DEFAULT_SETTINGS } from "../domain/settings";
import type { Settings } from "../domain/types";

type SettingsStore = {
  settings: Settings;
  hydrate: () => Promise<void>;
  update: (patch: Partial<Settings>) => void;
};

export const useSettings = create<SettingsStore>((set, get) => ({
  settings: DEFAULT_SETTINGS,
  hydrate: async () => set({ settings: await loadSettings() }),
  update: (patch) => {
    const settings = { ...get().settings, ...patch };
    set({ settings });
    void saveSettings(settings);
  },
}));
