/*
 * The feature registry (D167–D169, D176–D179): one entry per thing a user can learn. The command
 * palette, the "?" sheet, Settings → Help, Getting started and the tour all read it, so a command
 * can't exist without help text. Pure; `features.test.ts` checks every palette command and G key
 * has an entry. Every new command gets an entry here.
 */
import { compareVersions } from "./changelog";
import type { ViewId } from "./types";

/** Static palette commands. The palette's runner table is typed by this, so each needs code and help. */
export const PALETTE_IDS = [
  "new-task",
  "new-list",
  "import",
  "go-inbox",
  "go-today",
  "go-upcoming",
  "go-calendar",
  "go-habits",
  "go-focus",
  "go-progress",
  "go-settings",
  "matrix-mode",
  "show-completed",
  "theme-light",
  "theme-dark",
  "theme-system",
  "sidebar",
  "tour",
  "help",
  "shortcuts",
] as const;
export type PaletteId = (typeof PALETTE_IDS)[number];

/** `G` then a letter jumps to a view; `G M` (Matrix mode) is handled in lib/shortcuts.ts. */
export const GO: Record<string, ViewId> = {
  i: "inbox",
  t: "today",
  u: "upcoming",
  c: "calendar",
  h: "habits",
  f: "focus",
  s: "progress",
  ",": "settings",
};

/** Getting started ticks an item when its event fires in the app. */
export const DONE_EVENTS = ["task:created-quickadd", "task:token-used", "view:matrix", "habit:checked", "focus:completed", "palette:opened"] as const;
export type DoneEvent = (typeof DONE_EVENTS)[number];

export const FEATURE_GROUPS = ["Capture", "Tasks", "Views", "Habits & focus", "Progress", "Keyboard"] as const;
export type FeatureGroup = (typeof FEATURE_GROUPS)[number];

/** Icon keys; the UI maps each to a component, so this module stays free of React. */
export const FEATURE_ICONS = ["plus", "token", "paste", "mic", "search", "keyboard", "undo", "filter", "check", "list", "sun", "grid", "board", "calendar", "hourglass", "file", "target", "timer", "window", "chart", "share", "palette", "help"] as const;
export type FeatureIcon = (typeof FEATURE_ICONS)[number];

export type FeatureCommand =
  | { kind: "palette"; id: PaletteId; text: string; hint?: string }
  | { kind: "keys"; keys: string; text: string }
  | { kind: "token"; token: string; text: string };

export type Feature = {
  id: string;
  title: string;
  /** One line: how to use it. */
  howTo: string;
  icon: FeatureIcon;
  group: FeatureGroup;
  /** The version it arrived in; newer than the user's last seen version shows as "New:". */
  since: string;
  requires?: "signedIn" | "ai";
  /** One of the six core Getting started items. */
  core: boolean;
  commands: FeatureCommand[];
  done?: DoneEvent;
};

const OLD = "0.9.0";
const palette = (id: PaletteId, text: string, hint?: string): FeatureCommand => ({ kind: "palette", id, text, hint });
const keys = (k: string, text: string): FeatureCommand => ({ kind: "keys", keys: k, text });
const token = (t: string, text: string): FeatureCommand => ({ kind: "token", token: t, text });

export const FEATURES: Feature[] = [
  // ---- Capture
  { id: "quick-add", title: "Add a task", howTo: "Type in the box at the top of a view and press Enter.", icon: "plus", group: "Capture", since: OLD, core: true, done: "task:created-quickadd",
    commands: [palette("new-task", "New task", "N"), keys("N", "Focus quick add"), keys("Ctrl Shift A", "Quick add from any app")] },
  { id: "tokens", title: "Set details as you type", howTo: "Add a date, priority, tag or list to the task text, in any add box, and it's picked out for you.", icon: "token", group: "Capture", since: OLD, core: true, done: "task:token-used",
    commands: [token("tomorrow 5pm", "Date and time"), token("every mon", "Repeat"), token("!high  !2", "Priority"), token("#tag", "Tag"), token("~List", "List")] },
  { id: "bulk-import", title: "Paste many tasks at once", howTo: "Paste a list of lines and each one becomes a task.", icon: "paste", group: "Capture", since: OLD, core: false,
    commands: [palette("import", "Import tasks…")] },
  { id: "voice", title: "Add tasks by voice", howTo: "Hold the shortcut and say the task, or say “open today”, “start focus”, “show matrix”.", icon: "mic", group: "Capture", since: OLD, core: false,
    commands: [keys("Ctrl Alt Space", "Hold to talk")] },
  { id: "palette", title: "Search and run commands", howTo: "Find any task, list or tag, or run a command by name.", icon: "search", group: "Capture", since: OLD, core: true, done: "palette:opened",
    commands: [keys("Ctrl K", "Open the command palette")] },

  // ---- Tasks
  { id: "task-keys", title: "Work through tasks from the keyboard", howTo: "Move, open, complete and reschedule without the mouse.", icon: "keyboard", group: "Tasks", since: OLD, core: false,
    commands: [keys("↑ ↓  or  J K", "Move between tasks"), keys("Enter", "Open the task"), keys("Space  or  C", "Complete"), keys("1 2 3 / 0", "Priority high, medium, low / none"), keys("T / Shift T", "Do today / tomorrow"), keys("Delete", "Delete"), keys("Ctrl / Shift + click", "Select several"), keys("Esc", "Close the drawer or clear the selection")] },
  { id: "undo", title: "Undo anything", howTo: "Every change can be taken back.", icon: "undo", group: "Tasks", since: OLD, core: false,
    commands: [keys("Ctrl Z", "Undo the last change")] },
  { id: "filter", title: "Filter a view", howTo: "Filter with the same words you add tasks with, and pin a filter to the navigation.", icon: "filter", group: "Tasks", since: OLD, core: false,
    commands: [keys("/", "Filter the current view"), token("overdue  nodate", "Overdue or undated"), token("done  wontdo", "Finished tasks, anywhere")] },
  { id: "show-completed", title: "Show completed tasks", howTo: "Turn on Completed in a view's header to see what's finished there.", icon: "check", group: "Tasks", since: "1.0.0", core: false,
    commands: [palette("show-completed", "Show completed tasks")] },
  { id: "lists", title: "Organise with lists and folders", howTo: "Make a list for each part of your life and group lists into folders.", icon: "list", group: "Tasks", since: OLD, core: false,
    commands: [palette("new-list", "New list")] },

  // ---- Views
  { id: "smart-views", title: "Inbox, Today and Upcoming", howTo: "New tasks land in Inbox; Today shows what's due and overdue; Upcoming, the days ahead.", icon: "sun", group: "Views", since: OLD, core: false,
    commands: [palette("go-inbox", "Go to Inbox"), palette("go-today", "Go to Today"), palette("go-upcoming", "Go to Upcoming"), keys("G I / G T / G U", "Inbox / Today / Upcoming")] },
  { id: "matrix-mode", title: "Sort tasks by urgent and important", howTo: "Switch any view to Matrix and drag tasks between the four quadrants.", icon: "grid", group: "Views", since: "1.0.0", core: true, done: "view:matrix",
    commands: [palette("matrix-mode", "Show as matrix"), keys("G M", "Matrix mode")] },
  { id: "board-timeline", title: "Board and Timeline", howTo: "Pick Board (a list's sections as columns) or Timeline in a view's header.", icon: "board", group: "Views", since: OLD, core: false, commands: [] },
  { id: "calendar", title: "Plan on the calendar", howTo: "Drag tasks onto time slots, and add events of your own.", icon: "calendar", group: "Views", since: OLD, core: false,
    commands: [palette("go-calendar", "Go to Calendar"), keys("G C", "Calendar"), keys("D / X / W / M / A", "Day / 5 days / week / month / agenda"), keys("T", "Jump to today"), keys("← →", "Previous / next")] },
  { id: "countdowns", title: "Count down to a date", howTo: "Turn on Show countdown on an all-day event, and pin it to Today.", icon: "hourglass", group: "Views", since: "1.0.0", core: false, commands: [] },
  { id: "ics-import", title: "Import a calendar", howTo: "Settings → Data → Import an .ics file.", icon: "file", group: "Views", since: OLD, core: false, commands: [] },

  // ---- Habits & focus
  { id: "habits", title: "Keep a habit", howTo: "Add a habit and check it in each day it's due.", icon: "target", group: "Habits & focus", since: OLD, core: true, done: "habit:checked",
    commands: [palette("go-habits", "Go to Habits"), keys("G H", "Habits")] },
  { id: "focus", title: "Focus with a timer", howTo: "Start a Pomodoro, optionally on a task or some of its subtasks, and finish a session.", icon: "timer", group: "Habits & focus", since: OLD, core: true, done: "focus:completed",
    commands: [palette("go-focus", "Go to Focus"), keys("G F", "Focus")] },
  { id: "mini-window", title: "Keep the timer on top", howTo: "The mini window shows your next tasks, the timer and the matrix while you work elsewhere.", icon: "window", group: "Habits & focus", since: OLD, core: false,
    commands: [keys("Ctrl Alt M", "Show or hide the mini window")] },

  // ---- Progress
  { id: "progress", title: "See your progress", howTo: "Your week, streaks, trophies and trends in one place.", icon: "chart", group: "Progress", since: OLD, core: false,
    commands: [palette("go-progress", "Go to Progress"), keys("G S", "Progress")] },
  { id: "share-card", title: "Share your week", howTo: "Progress → Share makes an image of your numbers, never your task names.", icon: "share", group: "Progress", since: OLD, core: false, commands: [] },

  // ---- Keyboard and app
  { id: "appearance", title: "Make it yours", howTo: "Theme, accent, layout and scale are in Settings → Appearance.", icon: "palette", group: "Keyboard", since: OLD, core: false,
    commands: [palette("theme-light", "Switch theme: Light"), palette("theme-dark", "Switch theme: Dark"), palette("theme-system", "Switch theme: System"), palette("sidebar", "Collapse or expand the sidebar", "["), keys("[", "Collapse or expand the sidebar"), keys("Ctrl + / Ctrl − / Ctrl 0", "Scale up / down / reset")] },
  { id: "help", title: "Find your way around", howTo: "Help lists every command; the tour shows the main ideas again.", icon: "help", group: "Keyboard", since: "1.0.0", core: false,
    commands: [palette("help", "Help"), palette("tour", "Take the tour"), palette("shortcuts", "Keyboard shortcuts", "?"), palette("go-settings", "Go to Settings"), keys("?", "Keyboard shortcuts"), keys("Ctrl ,", "Settings"), keys("G ,", "Settings")] },
];

/** Help search: every word must appear in the title, how-to or a command. */
export function searchFeatures(query: string, list: readonly Feature[] = FEATURES): Feature[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [...list];
  return list.filter((f) => {
    const text = [f.title, f.howTo, ...f.commands.map((c) => `${c.text} ${c.kind === "keys" ? c.keys : c.kind === "token" ? c.token : ""}`)].join(" ").toLowerCase();
    return words.every((w) => text.includes(w));
  });
}

export type GettingStarted = {
  dismissed: boolean;
  /** Ids of features whose `done` event has fired. */
  done: string[];
  /** The app version when the card was last dismissed; null on a fresh install until the tour ends. */
  seenVersion: string | null;
};

/** The feature an event ticks, recorded once. Returns the same object when nothing changes. */
export function markDone(gs: GettingStarted, event: DoneEvent): GettingStarted {
  const f = FEATURES.find((x) => x.done === event);
  return !f || gs.done.includes(f.id) ? gs : { ...gs, done: [...gs.done, f.id] };
}

export type Available = { signedIn: boolean; ai: boolean };

/** What the Getting started card shows: the core six, entries new since the last dismissal, and the rest to try. */
export function gettingStartedItems(gs: GettingStarted, current: string, available: Available = { signedIn: false, ai: false }) {
  const usable = FEATURES.filter((f) => !f.requires || available[f.requires]);
  const isNew = (f: Feature) => gs.seenVersion !== null && compareVersions(f.since, gs.seenVersion) > 0 && compareVersions(f.since, current) <= 0;
  const fresh = usable.filter(isNew);
  return {
    fresh,
    core: usable.filter((f) => f.core),
    more: usable.filter((f) => !f.core && !isNew(f)),
    /** The card is hidden once dismissed, until an update brings something new. */
    visible: !gs.dismissed || fresh.length > 0,
  };
}
