export const SMART_LISTS = [
  "inbox",
  "today",
  "tomorrow",
  "next7",
  "overdue",
  "unscheduled",
  "high",
  "completed",
  "wontdo",
] as const;
export type SmartListId = (typeof SMART_LISTS)[number];

export const MODULE_VIEWS = ["calendar", "matrix", "habits", "focus", "countdown", "settings"] as const;
export type ModuleView = (typeof MODULE_VIEWS)[number];

/** Every top-level screen. User lists will join as `list:${id}` in Phase 2. */
export type ViewId = SmartListId | ModuleView;

export const THEMES = ["light", "dark", "system"] as const;
export const DENSITIES = ["comfortable", "compact"] as const;
export const FONT_SIZES = ["sm", "md", "lg"] as const;
export const SIDES = ["left", "right"] as const;
export const TIME_FORMATS = ["12h", "24h"] as const;
/** date-fns weekStartsOn: Sunday, Monday, Saturday. */
export const WEEK_STARTS = [0, 1, 6] as const;

export type Settings = {
  theme: (typeof THEMES)[number];
  /** #rrggbb */
  accent: string;
  density: (typeof DENSITIES)[number];
  fontSize: (typeof FONT_SIZES)[number];
  sidebarSide: (typeof SIDES)[number];
  sidebarCollapsed: boolean;
  defaultView: ViewId;
  weekStart: (typeof WEEK_STARTS)[number];
  timeFormat: (typeof TIME_FORMATS)[number];
  hiddenSmartLists: SmartListId[];
};
