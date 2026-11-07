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

  it("keeps only preset quadrant colours", () => {
    expect(parseSettings({ matrixColors: ["#2F6FED", "red", 3] }).matrixColors).toEqual(["#2f6fed", null, null, null]);
    expect(parseSettings({ matrixColors: "nope" }).matrixColors).toEqual([null, null, null, null]);
  });

  it("round-trips every non-default setting through save and load", () => {
    const s: Settings = {
      theme: "dark", accent: "#0e8a85", density: "compact", motion: "on", fontSize: "xxl", zoom: 1.25, layout: "bar", barPosition: "bottom", sidebarSide: "right",
      sidebarCollapsed: true, sidebarMoreOpen: true, defaultView: "inbox", weekStart: 0, timeFormat: "12h", smartParse: false,
      viewOptions: { inbox: { groupBy: "priority", sortBy: "date", mode: "timeline", showCompleted: false } }, savedFilters: [{ id: "f", name: "Work", query: "#work" }],
      calendar: { view: "month", colorBy: "priority", showCompleted: false, showHabits: true, showFocus: true, density: "compact", arrangeOpen: false },
      matrix: { importantPriorities: [3], urgentDays: 5 }, matrixColors: ["#0e8a85", null, null, "#2f6fed"], closeToTray: false, launchAtStartup: true, checkUpdates: false,
      notify: { enabled: false, style: "popup", corner: "top-right", sound: false, taskReminders: false, habitReminders: false, starts: false, digest: false, digestTime: "21:30", focus: false, quickAdd: false },
      sounds: { enabled: false, volume: 0.3, picks: { task: "ding", habit: "none", streak: "pop", dayDone: "chime", focusEnd: "marimba", longBreak: "fanfare" } },
      onboarded: true, gettingStarted: { dismissed: true, done: ["habits", "tokens"], seenVersion: "1.0.0" }, quickAddShortcut: "CommandOrControl+N", miniShortcut: "Alt+F9", voiceShortcut: "Alt+Space", voiceMic: "USB Mic", pomodoro: { focusMin: 50, shortMin: 10, longMin: 30, longEvery: 3, cycles: { kind: "finite", count: 6 } },
    };
    expect(parseSettings(JSON.parse(JSON.stringify(s)))).toEqual(s);
  });

  it("keeps the voice shortcut apart from the quick-add one", () => {
    expect(parseSettings({ voiceShortcut: "Alt+V" }).voiceShortcut).toBe("Alt+V");
    expect(parseSettings({ voiceMic: 5 }).voiceMic).toBeNull();
    expect(parseSettings({ quickAddShortcut: "Alt+V", voiceShortcut: "Alt+V" }).voiceShortcut).toBe("CommandOrControl+Alt+Space");
    expect(parseSettings({ voiceShortcut: "Alt V; rm" }).voiceShortcut).toBe("CommandOrControl+Alt+Space");
  });

  it("parses the pomodoro cycle count at the boundary", () => {
    const c = (cycles: unknown) => parseSettings({ pomodoro: { cycles } }).pomodoro.cycles;
    expect(c(undefined)).toEqual({ kind: "infinite" });
    expect(c({ kind: "finite", count: 99 })).toEqual({ kind: "finite", count: 24 });
    expect(c({ kind: "finite", count: 0 })).toEqual({ kind: "finite", count: 1 });
    expect(c({ kind: "finite", count: "x" })).toEqual({ kind: "infinite" });
    expect(c({ kind: "bogus", count: 3 })).toEqual({ kind: "infinite" });
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
    expect(parseSettings({ defaultView: "wontdo" }).defaultView).toBe("today");
    expect(parseSettings({ defaultView: "overdue" }).defaultView).toBe(DEFAULT_SETTINGS.defaultView);
    expect(parseSettings({ viewOptions: { tomorrow: { groupBy: "priority", sortBy: "title" } } }).viewOptions).toEqual({
      upcoming: { groupBy: "priority", sortBy: "title", mode: "list", showCompleted: false },
    });
  });

  it("lands retired start views on Today, set up like the page they replace", () => {
    const logbook = parseSettings({ defaultView: "logbook", viewOptions: { logbook: { groupBy: "list", sortBy: "title" } } });
    expect([logbook.defaultView, logbook.viewOptions]).toEqual(["today", { today: { groupBy: "none", sortBy: "date", mode: "list", showCompleted: true } }]);
    const matrix = parseSettings({ defaultView: "matrix" });
    expect([matrix.defaultView, matrix.viewOptions.today.mode]).toEqual(["today", "matrix"]);
    expect(parseSettings({ defaultView: "countdown" }).defaultView).toBe("calendar");
    expect(parseSettings(matrix)).toEqual(matrix);
  });

  it("is idempotent", () => {
    const once = parseSettings({ theme: "light", defaultView: "calendar" });
    expect(parseSettings(once)).toEqual(once);
  });
});

describe("parseSettings view options", () => {
  it("keeps valid per-view options and repairs bad fields", () => {
    const s = parseSettings({ viewOptions: { today: { groupBy: "priority", sortBy: "nope" }, x: 5 } });
    expect(s.viewOptions).toEqual({ today: { groupBy: "priority", sortBy: "date", mode: "list", showCompleted: false } });
    expect(parseSettings({ viewOptions: { "list:a": { mode: "kanban" } } }).viewOptions["list:a"]).toEqual({ groupBy: "none", sortBy: "manual", mode: "list", showCompleted: true });
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

describe("parseSettings getting started", () => {
  it("treats pre-v1.0 users as upgraders and drops unknown items", () => {
    expect(parseSettings({ onboarded: true }).gettingStarted).toEqual({ dismissed: false, done: [], seenVersion: "0.9.1" });
    expect(parseSettings({}).gettingStarted.seenVersion).toBeNull();
    expect(parseSettings({ gettingStarted: { done: ["habits", "nope", "habits", 3], seenVersion: "x" } }).gettingStarted).toEqual({ dismissed: false, done: ["habits"], seenVersion: null });
  });
});

describe("parseSettings layout", () => {
  it("maps the four pre-D114 layouts onto sidebar and bar", () => {
    const l = (layout: string) => ((s) => [s.layout, s.barPosition])(parseSettings({ layout, barPosition: "bottom" }));
    expect(l("classic")).toEqual(["sidebar", "top"]);
    expect(l("flat")).toEqual(["sidebar", "top"]);
    expect(l("topbar")).toEqual(["bar", "top"]);
    expect(l("dock")).toEqual(["bar", "bottom"]);
    expect(l("bar")).toEqual(["bar", "bottom"]);
    expect(l("nope")).toEqual(["sidebar", "bottom"]);
  });
  it("drops the retired background keys", () => {
    const s = parseSettings({ background: { kind: "gradient", id: "ocean" }, backgroundDim: 50, dockLabels: false });
    expect(s).toEqual(DEFAULT_SETTINGS);
  });
});
