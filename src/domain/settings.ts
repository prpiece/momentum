import { isHex } from "./color";
import {
  CAL_VIEWS,
  COLOR_BYS,
  DENSITIES,
  FONT_SIZES,
  GROUP_BYS,
  MODULE_VIEWS,
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
    view: oneOf(CAL_VIEWS, r.view) ? r.view : d.view,
    colorBy: oneOf(COLOR_BYS, r.colorBy) ? r.colorBy : d.colorBy,
    showCompleted: flag(r.showCompleted, d.showCompleted),
    showHabits: flag(r.showHabits, d.showHabits),
    showFocus: flag(r.showFocus, d.showFocus),
    density: oneOf(DENSITIES, r.density) ? r.density : d.density,
    arrangeOpen: flag(r.arrangeOpen, d.arrangeOpen),
  };
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
  };
}
