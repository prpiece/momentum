/** Local calendar date, `YYYY-MM-DD`. Never converted to an instant. */
export type LocalDate = string;
/** UTC instant, ISO 8601 (`Date.prototype.toISOString`). */
export type Instant = string;

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

export const MODULE_VIEWS = ["calendar", "matrix", "habits", "focus", "countdown", "stats", "settings"] as const;
export type ModuleView = (typeof MODULE_VIEWS)[number];

/** Every top-level screen. */
export type ViewId = SmartListId | ModuleView | `list:${string}` | `tag:${string}`;

// ---------- Tasks ----------

export const PRIORITIES = [0, 1, 2, 3] as const;
/** 0 none, 1 low, 2 medium, 3 high */
export type Priority = (typeof PRIORITIES)[number];
export const PRIORITY_LABEL: Record<Priority, string> = { 0: "None", 1: "Low", 2: "Medium", 3: "High" };

export const TASK_STATUSES = ["open", "done", "wont_do"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

/** When a task happens. `day` is all-day on a local date; `timed` has a real start and end. */
export type Schedule =
  | { kind: "none" }
  | { kind: "day"; date: LocalDate }
  | { kind: "timed"; start: Instant; end: Instant };

export type Reminder =
  /** Timed tasks: N minutes before start. */
  | { kind: "before"; minutes: number }
  /** Day tasks: at a wall-clock time, N days before the date. */
  | { kind: "dayOf"; daysBefore: number; time: string };

export type ChecklistItem = { id: string; title: string; done: boolean };

export type Recurrence = {
  /** RFC 5545 RRULE body without DTSTART, e.g. `FREQ=WEEKLY;BYDAY=MO,WE`. Anchored at the task's schedule. */
  rule: string;
  /** Excluded occurrence keys (see recurrence.ts `occurrenceKey`). */
  exdates: string[];
};

export type Task = {
  id: string;
  title: string;
  /** Markdown */
  description: string;
  listId: string;
  parentId: string | null;
  sectionId: string | null;
  status: TaskStatus;
  priority: Priority;
  schedule: Schedule;
  recurrence: Recurrence | null;
  /** Set on an occurrence detached from a series (edited or completed individually). */
  recurrenceParentId: string | null;
  tags: string[];
  checklist: ChecklistItem[];
  reminders: Reminder[];
  sortOrder: number;
  pinned: boolean;
  createdAt: Instant;
  updatedAt: Instant;
  completedAt: Instant | null;
  /** Soft delete; purged on next launch. Makes undo a single write. */
  deletedAt: Instant | null;
};

export const MAX_SUBTASK_DEPTH = 5;

export const LIST_LAYOUTS = ["list", "kanban", "timeline"] as const;
export type ListLayout = (typeof LIST_LAYOUTS)[number];

export const INBOX_ID = "inbox";

export type TaskList = {
  id: string;
  name: string;
  color: string | null;
  emoji: string | null;
  folderId: string | null;
  pinned: boolean;
  archived: boolean;
  /** Tint the list's background with its color. */
  tint: boolean;
  layout: ListLayout;
  sortOrder: number;
};

export type Folder = { id: string; name: string; sortOrder: number; collapsed: boolean };
export type Section = { id: string; listId: string; name: string; sortOrder: number };
export type Tag = { id: string; name: string; color: string | null };

export type ActivityKind = "created" | "completed" | "reopened" | "wont_do" | "moved" | "scheduled" | "priority" | "renamed";
export type Activity = { id: number; taskId: string; at: Instant; kind: ActivityKind; detail: string };

// ---------- View options ----------

export const GROUP_BYS = ["none", "list", "date", "priority", "tag"] as const;
export type GroupBy = (typeof GROUP_BYS)[number];
export const SORT_BYS = ["manual", "date", "priority", "created", "title"] as const;
export type SortBy = (typeof SORT_BYS)[number];
export type ViewOptions = { groupBy: GroupBy; sortBy: SortBy };

// ---------- Settings ----------

export const THEMES = ["light", "dark", "system"] as const;
export const DENSITIES = ["comfortable", "compact"] as const;
export const FONT_SIZES = ["sm", "md", "lg"] as const;
export const SIDES = ["left", "right"] as const;
export const TIME_FORMATS = ["12h", "24h"] as const;
/** date-fns weekStartsOn: Sunday, Monday, Saturday. */
export const WEEK_STARTS = [0, 1, 6] as const;
export type WeekStart = (typeof WEEK_STARTS)[number];

export type Settings = {
  theme: (typeof THEMES)[number];
  /** #rrggbb */
  accent: string;
  density: (typeof DENSITIES)[number];
  fontSize: (typeof FONT_SIZES)[number];
  sidebarSide: (typeof SIDES)[number];
  sidebarCollapsed: boolean;
  defaultView: ViewId;
  weekStart: WeekStart;
  timeFormat: (typeof TIME_FORMATS)[number];
  hiddenSmartLists: SmartListId[];
  /** Natural-language parsing in quick add. */
  smartParse: boolean;
  viewOptions: Record<string, ViewOptions>;
};
