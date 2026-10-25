import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, parseSettings } from "./settings";

describe("parseSettings", () => {
  it("returns defaults for garbage", () => {
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings("nope")).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings([])).toEqual(DEFAULT_SETTINGS);
  });

  it("keeps valid fields and replaces invalid ones individually", () => {
    const s = parseSettings({ theme: "dark", accent: "#ABCDEF", density: "huge", weekStart: 3, sidebarSide: "right" });
    expect(s.theme).toBe("dark");
    expect(s.accent).toBe("#abcdef");
    expect(s.density).toBe(DEFAULT_SETTINGS.density);
    expect(s.weekStart).toBe(DEFAULT_SETTINGS.weekStart);
    expect(s.sidebarSide).toBe("right");
  });

  it("filters and dedupes hidden smart lists", () => {
    expect(parseSettings({ hiddenSmartLists: ["today", "bogus", "today", 7] }).hiddenSmartLists).toEqual(["today"]);
  });

  it("is idempotent", () => {
    const once = parseSettings({ theme: "light", defaultView: "calendar" });
    expect(parseSettings(once)).toEqual(once);
  });
});

describe("parseSettings view options", () => {
  it("keeps valid per-view options and repairs bad fields", () => {
    const s = parseSettings({ viewOptions: { today: { groupBy: "priority", sortBy: "nope" }, x: 5 } });
    expect(s.viewOptions).toEqual({ today: { groupBy: "priority", sortBy: "manual" } });
  });

  it("accepts list and tag views as default view", () => {
    expect(parseSettings({ defaultView: "list:abc" }).defaultView).toBe("list:abc");
    expect(parseSettings({ defaultView: "list:" }).defaultView).toBe("today");
  });
});
