import { isHex } from "./color";
import {
  DENSITIES,
  FONT_SIZES,
  MODULE_VIEWS,
  SIDES,
  SMART_LISTS,
  THEMES,
  TIME_FORMATS,
  WEEK_STARTS,
  type Settings,
  type ViewId,
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
};

const VIEWS: readonly ViewId[] = [...SMART_LISTS, ...MODULE_VIEWS];

function oneOf<T>(allowed: readonly T[], v: unknown): v is T {
  return (allowed as readonly unknown[]).includes(v);
}

/** Boundary parser: anything from disk or an import file becomes a valid Settings, field by field. */
export function parseSettings(raw: unknown): Settings {
  const r: Record<string, unknown> = typeof raw === "object" && raw !== null ? { ...raw } : {};
  const d = DEFAULT_SETTINGS;
  return {
    theme: oneOf(THEMES, r.theme) ? r.theme : d.theme,
    accent: isHex(r.accent) ? r.accent.toLowerCase() : d.accent,
    density: oneOf(DENSITIES, r.density) ? r.density : d.density,
    fontSize: oneOf(FONT_SIZES, r.fontSize) ? r.fontSize : d.fontSize,
    sidebarSide: oneOf(SIDES, r.sidebarSide) ? r.sidebarSide : d.sidebarSide,
    sidebarCollapsed: typeof r.sidebarCollapsed === "boolean" ? r.sidebarCollapsed : d.sidebarCollapsed,
    defaultView: oneOf(VIEWS, r.defaultView) ? r.defaultView : d.defaultView,
    weekStart: oneOf(WEEK_STARTS, r.weekStart) ? r.weekStart : d.weekStart,
    timeFormat: oneOf(TIME_FORMATS, r.timeFormat) ? r.timeFormat : d.timeFormat,
    hiddenSmartLists: Array.isArray(r.hiddenSmartLists)
      ? [...new Set(r.hiddenSmartLists.filter((x): x is Settings["hiddenSmartLists"][number] => oneOf(SMART_LISTS, x)))]
      : d.hiddenSmartLists,
  };
}
