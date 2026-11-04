import { BLUR_MAX, DIM_MAX, GRADIENTS } from "./backgrounds";
import { ACCENT_PRESETS } from "./color";
import {
  type Background,
  CAL_VIEWS,
  type Cycles,
  COLOR_BYS,
  DENSITIES,
  FONT_SIZES,
  LAYOUTS,
  GROUP_BYS,
  MODULE_VIEWS,
  MOTIONS,
  NOTIFY_CORNERS,
  NOTIFY_STYLES,
  PRIORITIES,
  SIDES,
  SMART_LISTS,
  SOUNDS,
  ZOOMS,
  SORT_BYS,
  THEMES,
  TIME_FORMATS,
  WEEK_STARTS,
  type Settings,
  type SoundEvent,
  type ViewId,
  type ViewOptions,
} from "./types";

export const DEFAULT_SETTINGS: Settings = {
  theme: "system",
  accent: "#2f6fed",
  density: "comfortable",
  motion: "system",
  fontSize: "md",
  zoom: 1,
  layout: "classic",
  background: { kind: "none" },
  backgroundDim: 40,
  backgroundBlur: 8,
  dockLabels: true,
  sidebarSide: "left",
  sidebarCollapsed: false,
  sidebarMoreOpen: false,
  defaultView: "today",
  weekStart: 1,
  timeFormat: "24h",
  smartParse: true,
  viewOptions: {},
  savedFilters: [],
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
  matrixColors: [null, null, null, null],
  closeToTray: true,
  launchAtStartup: false,
  checkUpdates: true,
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
  sounds: {
    enabled: true,
    volume: 0.7,
    picks: { task: "pop", habit: "marimba", streak: "fanfare", dayDone: "fanfare", focusEnd: "chime", longBreak: "ding" },
  },
  onboarded: false,
  quickAddShortcut: "CommandOrControl+Shift+A",
  miniShortcut: "CommandOrControl+Alt+M",
  voiceShortcut: "CommandOrControl+Alt+Space",
  pomodoro: { focusMin: 25, shortMin: 5, longMin: 15, longEvery: 4, cycles: { kind: "infinite" } },
};

export const DEFAULT_VIEW_OPTIONS: ViewOptions = { groupBy: "none", sortBy: "manual" };

export function oneOf<T>(allowed: readonly T[], v: unknown): v is T {
  return (allowed as readonly unknown[]).includes(v);
}

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Smart lists merged in D49; old ids in saved settings carry over. */
const RENAMED_VIEWS: Record<string, ViewId> = { tomorrow: "upcoming", next7: "upcoming", completed: "logbook", wontdo: "logbook" };
const renamed = (v: unknown): unknown => (typeof v === "string" && RENAMED_VIEWS[v]) || v;

export function isViewId(v: unknown): v is ViewId {
  if (oneOf(SMART_LISTS, v) || oneOf(MODULE_VIEWS, v)) return true;
  return typeof v === "string" && /^(list|tag|filter):.+/.test(v);
}

function parseViewOptions(raw: unknown): Settings["viewOptions"] {
  if (!isRecord(raw)) return {};
  const out: Settings["viewOptions"] = {};
  for (const [k, v] of Object.entries(raw)) {
    const key = String(renamed(k));
    if (!isRecord(v) || out[key]) continue;
    out[key] = {
      groupBy: oneOf(GROUP_BYS, v.groupBy) ? v.groupBy : DEFAULT_VIEW_OPTIONS.groupBy,
      sortBy: oneOf(SORT_BYS, v.sortBy) ? v.sortBy : DEFAULT_VIEW_OPTIONS.sortBy,
    };
  }
  return out;
}

function parseSavedFilters(raw: unknown): Settings["savedFilters"] {
  if (!Array.isArray(raw)) return [];
  const out: Settings["savedFilters"] = [];
  for (const f of raw) {
    if (!isRecord(f) || typeof f.id !== "string" || typeof f.name !== "string" || typeof f.query !== "string") continue;
    if (!f.id || out.some((x) => x.id === f.id)) continue;
    out.push({ id: f.id, name: f.name.trim() || f.query, query: f.query });
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

/** Anything but an accent preset (or null) falls back to the theme default for that quadrant. */
function parseMatrixColors(raw: unknown): Settings["matrixColors"] {
  const at = (i: number): string | null => {
    const v = Array.isArray(raw) ? raw[i] : null;
    return typeof v === "string" ? (ACCENT_PRESETS.find((p) => p.hex === v.toLowerCase())?.hex ?? null) : null;
  };
  return [at(0), at(1), at(2), at(3)];
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

function parseSounds(raw: unknown): Settings["sounds"] {
  const r = isRecord(raw) ? raw : {};
  const d = DEFAULT_SETTINGS.sounds;
  const picks = isRecord(r.picks) ? r.picks : {};
  const pick = (e: SoundEvent) => ((v) => (oneOf(SOUNDS, v) ? v : d.picks[e]))(picks[e]);
  return {
    enabled: typeof r.enabled === "boolean" ? r.enabled : d.enabled,
    volume: typeof r.volume === "number" && r.volume >= 0 && r.volume <= 1 ? r.volume : d.volume,
    picks: { task: pick("task"), habit: pick("habit"), streak: pick("streak"), dayDone: pick("dayDone"), focusEnd: pick("focusEnd"), longBreak: pick("longBreak") },
  };
}

function parseCycles(raw: unknown): Cycles {
  if (!isRecord(raw) || raw.kind !== "finite" || typeof raw.count !== "number" || !Number.isFinite(raw.count)) return { kind: "infinite" };
  return { kind: "finite", count: Math.min(24, Math.max(1, Math.round(raw.count))) };
}

function parsePomodoro(raw: unknown): Settings["pomodoro"] {
  const r = isRecord(raw) ? raw : {};
  const d = DEFAULT_SETTINGS.pomodoro;
  const int = (v: unknown, lo: number, hi: number, fallback: number) => (typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi ? v : fallback);
  return { focusMin: int(r.focusMin, 1, 180, d.focusMin), shortMin: int(r.shortMin, 1, 60, d.shortMin), longMin: int(r.longMin, 1, 90, d.longMin), longEvery: int(r.longEvery, 2, 12, d.longEvery), cycles: parseCycles(r.cycles) };
}

/** Image files are `<uuid>.<ext>` (src/lib/appFiles.ts); anything else could point outside the backgrounds folder. */
const IMAGE_NAME = /^[0-9a-f-]{36}\.(png|jpg|gif|webp)$/;

function parseBackground(raw: unknown): Background {
  if (!isRecord(raw)) return DEFAULT_SETTINGS.background;
  if (raw.kind === "image" && typeof raw.name === "string" && IMAGE_NAME.test(raw.name)) return { kind: "image", name: raw.name };
  const g = raw.kind === "gradient" ? GRADIENTS.find((x) => x.id === raw.id) : undefined;
  return g ? { kind: "gradient", id: g.id } : DEFAULT_SETTINGS.background;
}

const clampInt = (v: unknown, max: number, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(0, Math.round(v))) : fallback);

const accelerator = (v: unknown, fallback: string) => (typeof v === "string" && /^[\w+]+$/.test(v) ? v : fallback);

/** Boundary parser: anything from disk or an import file becomes a valid Settings, field by field. */
export function parseSettings(raw: unknown): Settings {
  const r = isRecord(raw) ? raw : {};
  const d = DEFAULT_SETTINGS;
  return {
    theme: oneOf(THEMES, r.theme) ? r.theme : d.theme,
    // Only the presets: each has a matching app icon (D55). Custom colors from before fall back.
    accent: ((v) => ACCENT_PRESETS.find((p) => p.hex === v)?.hex ?? d.accent)(typeof r.accent === "string" ? r.accent.toLowerCase() : null),
    density: oneOf(DENSITIES, r.density) ? r.density : d.density,
    motion: oneOf(MOTIONS, r.motion) ? r.motion : d.motion,
    fontSize: oneOf(FONT_SIZES, r.fontSize) ? r.fontSize : d.fontSize,
    zoom: oneOf(ZOOMS, r.zoom) ? r.zoom : d.zoom,
    layout: oneOf(LAYOUTS, r.layout) ? r.layout : d.layout,
    background: parseBackground(r.background),
    backgroundDim: clampInt(r.backgroundDim, DIM_MAX, d.backgroundDim),
    backgroundBlur: clampInt(r.backgroundBlur, BLUR_MAX, d.backgroundBlur),
    dockLabels: typeof r.dockLabels === "boolean" ? r.dockLabels : d.dockLabels,
    sidebarSide: oneOf(SIDES, r.sidebarSide) ? r.sidebarSide : d.sidebarSide,
    sidebarCollapsed: typeof r.sidebarCollapsed === "boolean" ? r.sidebarCollapsed : d.sidebarCollapsed,
    sidebarMoreOpen: r.sidebarMoreOpen === true,
    defaultView: ((v) => (isViewId(v) ? v : d.defaultView))(renamed(r.defaultView)),
    weekStart: oneOf(WEEK_STARTS, r.weekStart) ? r.weekStart : d.weekStart,
    timeFormat: oneOf(TIME_FORMATS, r.timeFormat) ? r.timeFormat : d.timeFormat,
    smartParse: typeof r.smartParse === "boolean" ? r.smartParse : d.smartParse,
    viewOptions: parseViewOptions(r.viewOptions),
    savedFilters: parseSavedFilters(r.savedFilters),
    calendar: parseCalendar(r.calendar),
    matrix: parseMatrix(r.matrix),
    matrixColors: parseMatrixColors(r.matrixColors),
    closeToTray: typeof r.closeToTray === "boolean" ? r.closeToTray : d.closeToTray,
    launchAtStartup: typeof r.launchAtStartup === "boolean" ? r.launchAtStartup : d.launchAtStartup,
    checkUpdates: typeof r.checkUpdates === "boolean" ? r.checkUpdates : d.checkUpdates,
    notify: parseNotify(r.notify, r.notifications),
    sounds: parseSounds(r.sounds),
    onboarded: r.onboarded === true,
    quickAddShortcut: accelerator(r.quickAddShortcut, d.quickAddShortcut),
    voiceShortcut: ((v) => (v === accelerator(r.quickAddShortcut, d.quickAddShortcut) ? d.voiceShortcut : v))(accelerator(r.voiceShortcut, d.voiceShortcut)),
    miniShortcut: accelerator(r.miniShortcut, d.miniShortcut),
    pomodoro: parsePomodoro(r.pomodoro),
  };
}
