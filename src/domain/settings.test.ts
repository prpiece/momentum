import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, parseSettings } from "./settings";
import type { Settings } from "./types";

describe("parseSettings", () => {
  it("returns defaults for garbage", () => {
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings("nope")).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings([])).toEqual(DEFAULT_SETTINGS);
  });

  it("keeps valid fields and replaces invalid ones individually", () => {
    const s = parseSettings({ theme: "dark", accent: "#2F6FED", density: "huge", weekStart: 3, sidebarSide: "right" });
    expect(s.theme).toBe("dark");
    expect(s.accent).toBe("#2f6fed");
    expect(parseSettings({ accent: "#abcdef" }).accent).toBe(DEFAULT_SETTINGS.accent);
    expect(s.density).toBe(DEFAULT_SETTINGS.density);
    expect(s.weekStart).toBe(DEFAULT_SETTINGS.weekStart);
    expect(s.sidebarSide).toBe("right");
  });

  it("round-trips every non-default setting through save and load", () => {
    const s: Settings = {
      theme: "dark", accent: "#0e8a85", density: "compact", motion: "on", fontSize: "lg", sidebarSide: "right",
      sidebarCollapsed: true, sidebarMoreOpen: true, defaultView: "inbox", weekStart: 0, timeFormat: "12h", smartParse: false,
      viewOptions: { inbox: { groupBy: "priority", sortBy: "date" } }, savedFilters: [{ id: "f", name: "Work", query: "#work" }],
      calendar: { view: "month", colorBy: "priority", showCompleted: false, showHabits: true, showFocus: true, density: "compact", arrangeOpen: false },
      matrix: { importantPriorities: [3], urgentDays: 5 }, closeToTray: false, launchAtStartup: true, checkUpdates: false,
      notify: { enabled: false, style: "popup", corner: "top-right", sound: false, taskReminders: false, habitReminders: false, starts: false, digest: false, digestTime: "21:30", focus: false, quickAdd: false },
      onboarded: true, quickAddShortcut: "CommandOrControl+N", pomodoro: { focusMin: 50, shortMin: 10, longMin: 30, longEvery: 3 },
    };
    expect(parseSettings(JSON.parse(JSON.stringify(s)))).toEqual(s);
  });

  it("keeps well-formed saved filters only", () => {
    const savedFilters = [
      { id: "a", name: "Work", query: "#work" },
      { id: "a", name: "dupe", query: "x" },
      { id: "b", name: " ", query: "!high" },
      { id: "c", name: "no query" },
      "junk",
    ];
    expect(parseSettings({ savedFilters }).savedFilters).toEqual([
      { id: "a", name: "Work", query: "#work" },
      { id: "b", name: "!high", query: "!high" },
    ]);
    expect(parseSettings({ defaultView: "filter:a" }).defaultView).toBe("filter:a");
  });

  it("carries merged smart lists over to their new ids", () => {
    expect(parseSettings({ defaultView: "next7" }).defaultView).toBe("upcoming");
    expect(parseSettings({ defaultView: "wontdo" }).defaultView).toBe("logbook");
    expect(parseSettings({ defaultView: "overdue" }).defaultView).toBe(DEFAULT_SETTINGS.defaultView);
    expect(parseSettings({ viewOptions: { tomorrow: { groupBy: "priority", sortBy: "title" } } }).viewOptions).toEqual({
      upcoming: { groupBy: "priority", sortBy: "title" },
    });
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

describe("parseSettings matrix rules", () => {
  it("keeps valid rules and rejects unsatisfiable ones", () => {
    expect(parseSettings({ matrix: { importantPriorities: [3, 3, 9], urgentDays: 5 } }).matrix).toEqual({ importantPriorities: [3], urgentDays: 5 });
    expect(parseSettings({ matrix: { importantPriorities: [0, 1, 2, 3], urgentDays: -1 } }).matrix).toEqual(DEFAULT_SETTINGS.matrix);
    expect(parseSettings({ matrix: { importantPriorities: [] } }).matrix.importantPriorities).toEqual([2, 3]);
  });
});

describe("parseSettings migrations", () => {
  it("carries the old single notifications switch into notify.enabled and repairs bad fields", () => {
    expect(parseSettings({ notifications: false }).notify.enabled).toBe(false);
    const n = parseSettings({ notify: { style: "fax", digestTime: "25:00", starts: false } }).notify;
    expect([n.enabled, n.style, n.digestTime, n.starts]).toEqual([true, "both", "08:00", false]);
  });

  it("maps the retired 3-day calendar view to 5 days", () => {
    expect(parseSettings({ calendar: { view: "3day" } }).calendar.view).toBe("5day");
  });
});
