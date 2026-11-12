import { isHex, parseAccent, parseQuadrantColor } from "./color";
import { FEATURES, type GettingStarted } from "./features";
import {
  BAR_POSITIONS,
  BAR_STYLES,
  CAL_VIEWS,
  type Background,
  type Cycles,
  DIM_DEFAULT,
  DIM_MAX,
  COLOR_BYS,
  DENSITIES,
  LAYOUTS,
  GROUP_BYS,
  MODULE_VIEWS,
  MOTIONS,
  NOTIFY_CORNERS,
  NOTIFY_STYLES,
  PRIORITIES,
  SIDES,
  TASK_OPENS,
  SMART_LISTS,
  SOUNDS,
  SCALE_MAX,
  SCALE_MIN,
  SCALE_STEP,
  SORT_BYS,
  THEMES,
  TIME_FORMATS,
  VIEW_MODES,
  WEEK_STARTS,
  type Settings,
  type SoundEvent,
  type ViewId,
  type ViewOptions,
} from "./types";

export const DEFAULT_SETTINGS: Settings = {
  theme: "system",
  accent: "indigo",
  density: "comfortable",
  motion: "system",
  scale: 1,
  layout: "sidebar",
  barPosition: "top",
  barStyle: "flat",
  background: { kind: "none" },
  sidebarSide: "left",
  taskOpen: "side",
  sidebarCollapsed: false,
  defaultView: "today",
  weekStart: 1,
  timeFormat: "24h",
  smartParse: true,
  showCompleted: true,
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
  launchAtStartup: true,
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
  streakReminder: { on: true, time: "18:00" },
  autoFocus: false,
  sounds: {
    enabled: true,
    volume: 0.7,
    picks: { task: "pop", habit: "marimba", streak: "fanfare", dayDone: "fanfare", focusEnd: "chime", longBreak: "ding" },
  },
  onboarded: false,
  gettingStarted: { dismissed: false, done: [], seenVersion: null },
  quickAddShortcut: "CommandOrControl+Shift+A",
  miniShortcut: "CommandOrControl+Alt+M",
  voiceShortcut: "CommandOrControl+Alt+Space",
  voiceMic: null,
  pomodoro: { focusMin: 25, shortMin: 5, longMin: 15, longEvery: 4, cycles: { kind: "infinite" } },
};

/** A view's options before the user changes any. Today and Upcoming hide finished tasks; lists show them in a Completed group. */
export function defaultViewOptions(view: string): ViewOptions {
  const ordered = view === "inbox" || view.startsWith("list:");
  return { groupBy: view === "upcoming" ? "date" : "none", sortBy: ordered ? "manual" : "date", mode: "list" };
}

export function oneOf<T>(allowed: readonly T[], v: unknown): v is T {
  return (allowed as readonly unknown[]).includes(v);
}

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Smart lists merged in D49, pages retired in v1.0 (D165, D163, D164); old ids in saved settings carry over. */
const RENAMED_VIEWS: Record<string, ViewId> = {
  tomorrow: "upcoming",
  next7: "upcoming",
  completed: "today",
  wontdo: "today",
  logbook: "today",
  countdown: "calendar",
  matrix: "today",
  stats: "progress",
};
/** Retired views whose own view options are dropped rather than carried to the view they map to. */
const RETIRED = new Set(["completed", "wontdo", "logbook", "countdown", "matrix"]);
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
    if (!isRecord(v) || out[key] || RETIRED.has(k)) continue;
    const d = defaultViewOptions(key);
    out[key] = {
      groupBy: oneOf(GROUP_BYS, v.groupBy) ? v.groupBy : d.groupBy,
      sortBy: oneOf(SORT_BYS, v.sortBy) ? v.sortBy : d.sortBy,
      mode: oneOf(VIEW_MODES, v.mode) ? v.mode : d.mode,
    };
  }
  return out;
}

/** A start view on a retired page lands on Today, set up to show what that page showed. */
function carryRetiredStartView(defaultView: unknown, options: Settings["viewOptions"]): Settings["viewOptions"] {
  const today = options.today ?? defaultViewOptions("today");
  if (defaultView === "matrix") return { ...options, today: { ...today, mode: "matrix" } };
  return options;
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

/** Anything but an accent preset, a #rrggbb (or null) falls back to the theme default for that quadrant. */
function parseMatrixColors(raw: unknown): Settings["matrixColors"] {
  const at = (i: number) => parseQuadrantColor(Array.isArray(raw) ? raw[i] : null);
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

function parseStreakReminder(raw: unknown): Settings["streakReminder"] {
  const r = isRecord(raw) ? raw : {};
  const d = DEFAULT_SETTINGS.streakReminder;
  return { on: typeof r.on === "boolean" ? r.on : d.on, time: typeof r.time === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(r.time) ? r.time : d.time };
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

const VERSION = /^\d+\.\d+\.\d+$/;

/** Users from before v1.0 (onboarded, no Getting started yet) see what v1.0 brought as "New:". */
function parseGettingStarted(raw: unknown, onboarded: boolean): GettingStarted {
  if (!isRecord(raw)) return { dismissed: false, done: [], seenVersion: onboarded ? "0.9.1" : null };
  const ids = new Set(FEATURES.map((f) => f.id));
  const done = Array.isArray(raw.done) ? [...new Set(raw.done.filter((x): x is string => typeof x === "string" && ids.has(x)))] : [];
  return { dismissed: raw.dismissed === true, done, seenVersion: typeof raw.seenVersion === "string" && VERSION.test(raw.seenVersion) ? raw.seenVersion : null };
}

/** Before D114 there were four layouts: classic and flat had a sidebar, topbar and dock a bar. */
function parseLayout(layout: unknown, barPosition: unknown, barStyle: unknown): Pick<Settings, "layout" | "barPosition" | "barStyle"> {
  const style = oneOf(BAR_STYLES, barStyle) ? barStyle : DEFAULT_SETTINGS.barStyle;
  if (layout === "classic" || layout === "flat") return { layout: "sidebar", barPosition: DEFAULT_SETTINGS.barPosition, barStyle: style };
  if (layout === "topbar") return { layout: "bar", barPosition: "top", barStyle: style };
  if (layout === "dock") return { layout: "bar", barPosition: "bottom", barStyle: style };
  return {
    layout: oneOf(LAYOUTS, layout) ? layout : DEFAULT_SETTINGS.layout,
    barPosition: oneOf(BAR_POSITIONS, barPosition) ? barPosition : DEFAULT_SETTINGS.barPosition,
    barStyle: style,
  };
}

/** The shape Rust accepts for a stored image name (files.rs valid_name). */
const IMAGE_FILE = /^[A-Za-z0-9_-]{1,64}\.(png|jpe?g|gif|webp)$/i;

function parseBackground(raw: unknown): Background {
  if (!isRecord(raw)) return DEFAULT_SETTINGS.background;
  if (raw.kind === "color" && isHex(raw.hex)) return { kind: "color", hex: raw.hex.toLowerCase() };
  if (raw.kind === "image" && typeof raw.file === "string" && IMAGE_FILE.test(raw.file)) {
    const dim = typeof raw.dim === "number" && Number.isFinite(raw.dim) ? Math.min(DIM_MAX, Math.max(0, Math.round(raw.dim))) : DIM_DEFAULT;
    return { kind: "image", file: raw.file, dim };
  }
  return DEFAULT_SETTINGS.background;
}

/** Text-size steps from before Scale (D202), as the factor on a 16px root. */
const LEGACY_TEXT: Record<string, number> = { sm: 15 / 16, md: 1, lg: 17.5 / 16, xl: 19 / 16, xxl: 21 / 16 };

/** Clamps to the Scale range and snaps to its step (rounded to dodge float noise such as 1.1500000000000001). */
export function clampScale(v: number): number {
  return Number((Math.round(Math.min(SCALE_MAX, Math.max(SCALE_MIN, v)) / SCALE_STEP) * SCALE_STEP).toFixed(2));
}

/** Before Scale there were two settings, `zoom` and `fontSize`. Their product, clamped to the range, keeps the old look. */
function parseScale(r: Record<string, unknown>): Settings["scale"] {
  if (typeof r.scale === "number" && Number.isFinite(r.scale)) return clampScale(r.scale);
  const zoom = typeof r.zoom === "number" && r.zoom >= 0.5 && r.zoom <= 3 ? r.zoom : 1;
  return clampScale(zoom * (typeof r.fontSize === "string" ? (LEGACY_TEXT[r.fontSize] ?? 1) : 1));
}

const accelerator = (v: unknown, fallback: string) => (typeof v === "string" && /^[\w+]+$/.test(v) ? v : fallback);

/** Boundary parser: anything from disk or an import file becomes a valid Settings, field by field. */
export function parseSettings(raw: unknown): Settings {
  const r = isRecord(raw) ? raw : {};
  const d = DEFAULT_SETTINGS;
  return {
    theme: oneOf(THEMES, r.theme) ? r.theme : d.theme,
    // Only the presets: each has a matching app icon (D55). Custom colors from before fall back.
    accent: parseAccent(r.accent) ?? d.accent,
    density: oneOf(DENSITIES, r.density) ? r.density : d.density,
    motion: oneOf(MOTIONS, r.motion) ? r.motion : d.motion,
    scale: parseScale(r),
    ...parseLayout(r.layout, r.barPosition, r.barStyle),
    background: parseBackground(r.background),
    sidebarSide: oneOf(SIDES, r.sidebarSide) ? r.sidebarSide : d.sidebarSide,
    taskOpen: oneOf(TASK_OPENS, r.taskOpen) ? r.taskOpen : d.taskOpen,
    sidebarCollapsed: typeof r.sidebarCollapsed === "boolean" ? r.sidebarCollapsed : d.sidebarCollapsed,
    defaultView: ((v) => (isViewId(v) ? v : d.defaultView))(renamed(r.defaultView)),
    weekStart: oneOf(WEEK_STARTS, r.weekStart) ? r.weekStart : d.weekStart,
    timeFormat: oneOf(TIME_FORMATS, r.timeFormat) ? r.timeFormat : d.timeFormat,
    smartParse: typeof r.smartParse === "boolean" ? r.smartParse : d.smartParse,
    showCompleted: typeof r.showCompleted === "boolean" ? r.showCompleted : d.showCompleted,
    viewOptions: carryRetiredStartView(r.defaultView, parseViewOptions(r.viewOptions)),
    savedFilters: parseSavedFilters(r.savedFilters),
    calendar: parseCalendar(r.calendar),
    matrix: parseMatrix(r.matrix),
    matrixColors: parseMatrixColors(r.matrixColors),
    closeToTray: typeof r.closeToTray === "boolean" ? r.closeToTray : d.closeToTray,
    launchAtStartup: typeof r.launchAtStartup === "boolean" ? r.launchAtStartup : d.launchAtStartup,
    checkUpdates: typeof r.checkUpdates === "boolean" ? r.checkUpdates : d.checkUpdates,
    notify: parseNotify(r.notify, r.notifications),
    streakReminder: parseStreakReminder(r.streakReminder),
    autoFocus: typeof r.autoFocus === "boolean" ? r.autoFocus : d.autoFocus,
    sounds: parseSounds(r.sounds),
    onboarded: r.onboarded === true,
    gettingStarted: parseGettingStarted(r.gettingStarted, r.onboarded === true),
    quickAddShortcut: accelerator(r.quickAddShortcut, d.quickAddShortcut),
    voiceShortcut: ((v) => (v === accelerator(r.quickAddShortcut, d.quickAddShortcut) ? d.voiceShortcut : v))(accelerator(r.voiceShortcut, d.voiceShortcut)),
    voiceMic: typeof r.voiceMic === "string" && r.voiceMic ? r.voiceMic : null,
    miniShortcut: accelerator(r.miniShortcut, d.miniShortcut),
    pomodoro: parsePomodoro(r.pomodoro),
  };
}

/** Settings that follow the account to every device (v1.1 spec, "What syncs"). */
export const USER_SETTING_KEYS = [
  "theme", "accent", "taskOpen", "defaultView", "weekStart", "timeFormat", "smartParse", "showCompleted", "viewOptions",
  "savedFilters", "calendar", "matrix", "matrixColors", "pomodoro", "streakReminder", "sounds", "onboarded", "gettingStarted",
] as const satisfies readonly (keyof Settings)[];

/** Settings that stay on this device: hardware, window and OS integration, and the local background image. */
export const DEVICE_SETTING_KEYS = [
  "density", "motion", "scale", "layout", "barPosition", "barStyle", "background", "sidebarSide", "sidebarCollapsed",
  "closeToTray", "launchAtStartup", "checkUpdates", "notify", "autoFocus", "quickAddShortcut", "miniShortcut", "voiceShortcut", "voiceMic",
] as const satisfies readonly (keyof Settings)[];

/** The user settings that differ between two snapshots: the synced patch for a settings save. */
export function userSettingsPatch(before: Settings, after: Settings): Partial<Settings> {
  const patch: Record<string, unknown> = {};
  for (const k of USER_SETTING_KEYS) if (JSON.stringify(before[k]) !== JSON.stringify(after[k])) patch[k] = after[k];
  return patch as Partial<Settings>;
}

/** Applies another device's user settings; device settings and unknown keys are ignored, values are re-validated. */
export function withRemoteSettings(local: Settings, remote: Record<string, unknown>): Settings {
  const picked = Object.fromEntries(USER_SETTING_KEYS.filter((k) => k in remote).map((k) => [k, remote[k]]));
  return parseSettings({ ...local, ...picked });
}
