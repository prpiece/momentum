import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../domain/settings";
import { changedKeys } from "./settingsDraft";

describe("settings draft", () => {
  it("keeps only the values that differ from the saved settings", () => {
    const patch = { scale: 1.25, theme: DEFAULT_SETTINGS.theme, notify: { ...DEFAULT_SETTINGS.notify } };
    expect(changedKeys(DEFAULT_SETTINGS, patch)).toEqual({ scale: 1.25 });
  });
});
