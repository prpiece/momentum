import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../domain/settings";

const saveSettings = vi.fn(async () => undefined);
vi.mock("../db/settings", () => ({ loadSettings: async () => DEFAULT_SETTINGS, saveSettings }));

beforeEach(() => (vi.useFakeTimers(), saveSettings.mockClear()));
afterEach(() => vi.useRealTimers());

it("H9: replace saves the restored settings at once and cancels a pending save of the old ones", async () => {
  const { useSettings } = await import("./settings");
  useSettings.getState().update({ scale: 1.3 });
  const restored = { ...DEFAULT_SETTINGS, scale: 0.9 };
  await useSettings.getState().replace(restored);
  await useSettings.getState().hydrate(); // what restoreBackup does next
  vi.advanceTimersByTime(1000);
  expect(saveSettings).toHaveBeenCalledTimes(1);
  expect(saveSettings).toHaveBeenCalledWith(restored);
});
