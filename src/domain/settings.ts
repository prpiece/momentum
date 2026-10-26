import { isHex } from "./color";
import {
  CAL_VIEWS,
  COLOR_BYS,
  DENSITIES,
  FONT_SIZES,
  GROUP_BYS,
  MODULE_VIEWS,
  NOTIFY_CORNERS,
  NOTIFY_STYLES,
  PRIORITIES,
  SIDES,
  SMART_LISTS,
  SORT_BYS,
  THEMES,
  TIME_FORMATS,
  WEEK_STARTS,
  type Settings,
  type ViewId,
  type ViewOptions,
} from "./types";

export const DEFAULT_SETTINGS: Settings = {
  theme: "system",
  accent: "#5b5bd6",
  density: "comfortable",
  fontSize: "md",
  sidebarSide: "left",
  sidebarCollapsed: false,
  defaultView: "today",
  weekStart: 1,
  timeFormat: "24h",
  hiddenSmartLists: ["wontdo"],
  smartParse: true,
  viewOptions: {},
  calendar: {
    view: "week",
    colorBy: "list",
    showCompleted: true,
    showHabits: false,
    showFocus: false,
    density: "comfortable",
    arrangeOpen: true,
  },
  matrix: { importantPriorities: [2, 3], urgentDays: 2 },
  closeToTray: true,
  launchAtStartup: false,
  notify: {
    enabled: true,
    style: "both",
    corner: "bottom-right",
    sound: true,
    taskReminders: true,
    habitReminders: true,
    starts: true,
    digest: true,
    digestTime: "08:00",
    focus: true,
    quickAdd: true,
  },
  onboarded: false,
  quickAddShortcut: "CommandOrControl+Shift+A",
  pomodoro: { focusMin: 25, shortMin: 5, longMin: 15, longEvery: 4 },
};

export const DEFAULT_VIEW_OPTIONS: ViewOptions = { groupBy: "none", sortBy: "manual" };

export function oneOf<T>(allowed: readonly T[], v: unknown): v is T {
  return (allowed as readonly unknown[]).includes(v);
}

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function isViewId(v: unknown): v is ViewId {
  if (oneOf(SMART_LISTS, v) || oneOf(MODULE_VIEWS, v)) return true;
  return typeof v === "string" && /^(list|tag):.+/.test(v);
}

function parseViewOptions(raw: unknown): Settings["viewOptions"] {
  if (!isRecord(raw)) return {};
  const out: Settings["viewOptions"] = {};
  for (const [key, v] of Object.entries(raw)) {
    if (!isRecord(v)) continue;
    out[key] = {
      groupBy: oneOf(GROUP_BYS, v.groupBy) ? v.groupBy : DEFAULT_VIEW_OPTIONS.groupBy,
      sortBy: oneOf(SORT_BYS, v.sortBy) ? v.sortBy : DEFAULT_VIEW_OPTIONS.sortBy,
    };
  }
  return out;
}

function parseCalendar(raw: unknown): Settings["calendar"] {
  const r = isRecord(raw) ? raw : {};
  const d = DEFAULT_SETTINGS.calendar;
  const flag = (v: unknown, fallback: boolean) => (typeof v === "boolean" ? v : fallback);
  return {
    // "3day" was replaced by "5day".
    view: oneOf(CAL_VIEWS, r.view) ? r.view : r.view === "3day" ? "5day" : d.view,
    colorBy: oneOf(COLOR_BYS, r.colorBy) ? r.colorBy : d.colorBy,
    showCompleted: flag(r.showCompleted, d.showCompleted),
    showHabits: flag(r.showHabits, d.showHabits),
    showFocus: flag(r.showFocus, d.showFocus),
    density: oneOf(DENSITIES, r.density) ? r.density : d.density,
    arrangeOpen: flag(r.arrangeOpen, d.arrangeOpen),
  };
}

function parseMatrix(raw: unknown): Settings["matrix"] {
  const r = isRecord(raw) ? raw : {};
  const d = DEFAULT_SETTINGS.matrix;
  const prios = Array.isArray(r.importantPriorities) ? [...new Set(r.importantPriorities.filter((x) => oneOf(PRIORITIES, x)))].sort() : [];
  // Some, but not all, priorities must be important or quadrant moves can't be satisfied.
  const valid = prios.length > 0 && prios.length < PRIORITIES.length;
  const days = typeof r.urgentDays === "number" && Number.isInteger(r.urgentDays) && r.urgentDays >= 0 && r.urgentDays <= 30 ? r.urgentDays : d.urgentDays;
  return { importantPriorities: valid ? prios : d.importantPriorities, urgentDays: days };
}

function parseNotify(raw: unknown, legacyEnabled: unknown): Settings["notify"] {
  const r = isRecord(raw) ? raw : {};
  const d = DEFAULT_SETTINGS.notify;
  const flag = (v: unknown, fallback: boolean) => (typeof v === "boolean" ? v : fallback);
  return {
    // Before per-type settings there was a single `notifications` switch.
    enabled: flag(r.enabled, flag(legacyEnabled, d.enabled)),
    style: oneOf(NOTIFY_STYLES, r.style) ? r.style : d.style,
    corner: oneOf(NOTIFY_CORNERS, r.corner) ? r.corner : d.corner,
    sound: flag(r.sound, d.sound),
    taskReminders: flag(r.taskReminders, d.taskReminders),
    habitReminders: flag(r.habitReminders, d.habitReminders),
    starts: flag(r.starts, d.starts),
    digest: flag(r.digest, d.digest),
    digestTime: typeof r.digestTime === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(r.digestTime) ? r.digestTime : d.digestTime,
    focus: flag(r.focus, d.focus),
    quickAdd: flag(r.quickAdd, d.quickAdd),
  };
}

function parsePomodoro(raw: unknown): Settings["pomodoro"] {
  const r = isRecord(raw) ? raw : {};
  const d = DEFAULT_SETTINGS.pomodoro;
  const int = (v: unknown, lo: number, hi: number, fallback: number) => (typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi ? v : fallback);
  return { focusMin: int(r.focusMin, 1, 180, d.focusMin), shortMin: int(r.shortMin, 1, 60, d.shortMin), longMin: int(r.longMin, 1, 90, d.longMin), longEvery: int(r.longEvery, 2, 12, d.longEvery) };
}

/** Boundary parser: anything from disk or an import file becomes a valid Settings, field by field. */
export function parseSettings(raw: unknown): Settings {
  const r = isRecord(raw) ? raw : {};
  const d = DEFAULT_SETTINGS;
  return {
    theme: oneOf(THEMES, r.theme) ? r.theme : d.theme,
    accent: isHex(r.accent) ? r.accent.toLowerCase() : d.accent,
    density: oneOf(DENSITIES, r.density) ? r.density : d.density,
    fontSize: oneOf(FONT_SIZES, r.fontSize) ? r.fontSize : d.fontSize,
    sidebarSide: oneOf(SIDES, r.sidebarSide) ? r.sidebarSide : d.sidebarSide,
    sidebarCollapsed: typeof r.sidebarCollapsed === "boolean" ? r.sidebarCollapsed : d.sidebarCollapsed,
    defaultView: isViewId(r.defaultView) ? r.defaultView : d.defaultView,
    weekStart: oneOf(WEEK_STARTS, r.weekStart) ? r.weekStart : d.weekStart,
    timeFormat: oneOf(TIME_FORMATS, r.timeFormat) ? r.timeFormat : d.timeFormat,
    hiddenSmartLists: Array.isArray(r.hiddenSmartLists)
      ? [...new Set(r.hiddenSmartLists.filter((x) => oneOf(SMART_LISTS, x)))]
      : d.hiddenSmartLists,
    smartParse: typeof r.smartParse === "boolean" ? r.smartParse : d.smartParse,
    viewOptions: parseViewOptions(r.viewOptions),
    calendar: parseCalendar(r.calendar),
    matrix: parseMatrix(r.matrix),
    closeToTray: typeof r.closeToTray === "boolean" ? r.closeToTray : d.closeToTray,
    launchAtStartup: typeof r.launchAtStartup === "boolean" ? r.launchAtStartup : d.launchAtStartup,
    notify: parseNotify(r.notify, r.notifications),
    onboarded: r.onboarded === true,
    quickAddShortcut: typeof r.quickAddShortcut === "string" && /^[w+]+$/.test(r.quickAddShortcut) ? r.quickAddShortcut : d.quickAddShortcut,
    pomodoro: parsePomodoro(r.pomodoro),
  };
}
