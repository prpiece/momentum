import { create } from "zustand";
import { loadSettings, saveSettings } from "../db/settings";
import { markDone, type DoneEvent } from "../domain/features";
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

/** Which Settings category page is open; null is the category list. Set before `go("settings")` to deep-link (D202). */
export const useSettingsPage = create<{ page: string | null }>(() => ({ page: null }));
export const openSettingsPage = (page: string | null) => useSettingsPage.setState({ page });

/** Ticks the Getting started item for `event`; writes only the first time (D168). */
export function trackDone(event: DoneEvent) {
  const { settings, update } = useSettings.getState();
  const next = markDone(settings.gettingStarted, event);
  if (next !== settings.gettingStarted) update({ gettingStarted: next });
}
