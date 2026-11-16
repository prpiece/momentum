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
  "go-home",
  "go-inbox",
  "go-today",
  "go-upcoming",
  "go-calendar",
  "go-habits",
  "go-focus",
  "go-progress",
  "go-friends",
  "go-trash",
  "go-review",
  "go-logbook",
  "plan-day",
  "shut-down",
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
  "from-template",
  "print",
] as const;
export type PaletteId = (typeof PALETTE_IDS)[number];

/** `G` then a letter jumps to a view; `G M` (Matrix mode) is handled in lib/shortcuts.ts. */
export const GO: Record<string, ViewId> = {
  o: "home",
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

export const FEATURE_GROUPS = ["Capture", "Tasks", "Views", "Habits & focus", "Progress", "Friends & sharing", "Keyboard"] as const;
export type FeatureGroup = (typeof FEATURE_GROUPS)[number];

/** Icon keys; the UI maps each to a component, so this module stays free of React. */
export const FEATURE_ICONS = ["plus", "token", "paste", "mic", "search", "keyboard", "undo", "filter", "check", "list", "sun", "grid", "board", "calendar", "hourglass", "file", "target", "timer", "window", "chart", "palette", "help", "share", "users"] as const;
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
    commands: [palette("new-task", "New task", "N"), keys("N", "Focus quick add"), keys("Ctrl Shift A", "Quick add from any app (changeable in Settings)")] },
  { id: "tokens", title: "Set details as you type", howTo: "Add a date, priority, tag or list to the task text, in any add box, and it's picked out for you.", icon: "token", group: "Capture", since: OLD, core: true, done: "task:token-used",
    commands: [token("tomorrow 5pm", "Date and time"), token("every mon  weekly for 5 weeks  daily x5  until dec 1", "Repeat, with a count or end"), token("eod  eow  eom", "End of today, this working week (Friday), this month"), token("!high  !2", "Priority"), token("#tag", "Tag"), token("~List", "List")] },
  { id: "bulk-import", title: "Paste many tasks at once", howTo: "Paste a list of lines and each one becomes a task.", icon: "paste", group: "Capture", since: OLD, core: false,
    commands: [palette("import", "Import tasks…")] },
  { id: "external-import", title: "Import from another task app", howTo: "Settings → Data → Import from another app (or Import tasks…). Pick a Todoist, TickTick, Google Tasks (Takeout Tasks.json) or Apple Reminders / Outlook (.ics) export, check the preview, import; one Undo takes it all back.", icon: "file", group: "Capture", since: "1.3.0", core: false, commands: [] },
  { id: "data-export", title: "Export tasks and calendar", howTo: "Settings → Data → Export tasks (.json), or Export calendar (.ics) for your dated tasks and events in another calendar app.", icon: "file", group: "Capture", since: "1.3.0", core: false, commands: [] },
  { id: "auto-backup", title: "Back up automatically", howTo: "Settings → Data → Back up automatically every day keeps the newest few zips in the backups folder; Back up now makes one at once.", icon: "file", group: "Capture", since: "1.3.0", core: false, commands: [] },
  { id: "print", title: "Print or save as PDF", howTo: "Open a list or Today, then run Print from the command palette and choose a printer or Save as PDF.", icon: "file", group: "Views", since: "1.3.0", core: false, commands: [palette("print", "Print this view")] },
  { id: "attachment-preview", title: "Preview PDFs and text files", howTo: "Open a PDF or .txt attached to a task to read it inside Momentum.", icon: "file", group: "Tasks", since: "1.3.0", core: false, commands: [] },
  { id: "csv-export", title: "Export tasks to a spreadsheet", howTo: "Settings → Data → Export tasks (.csv) saves every task with its list, date, repeat and tags, to open in Excel or Sheets.", icon: "file", group: "Capture", since: "1.3.0", core: false, commands: [] },
  { id: "custom-repeat", title: "Custom repeats with an end", howTo: "Date → Repeat → Custom…: every few days, weeks, months or years; monthly on the 2nd Tuesday or last Friday; and end never, on a date or after a number of times.", icon: "calendar", group: "Tasks", since: "1.3.0", core: false, commands: [] },
  { id: "skip-missed", title: "Skip missed repeats", howTo: "A repeating task with past occurrences you never did shows Skip to today in its right-click menu and details; they're all skipped at once, and Undo brings them back.", icon: "calendar", group: "Tasks", since: "1.3.0", core: false, commands: [] },
  { id: "voice", title: "Add tasks by voice", howTo: "Hold the shortcut and say the task, or say “open today”, “start focus”, “show matrix”.", icon: "mic", group: "Capture", since: OLD, core: false,
    commands: [keys("Ctrl Alt Space", "Hold to talk (changeable in Settings)")] },
  { id: "palette", title: "Search and run commands", howTo: "Find any task, list or tag, or run a command by name.", icon: "search", group: "Capture", since: OLD, core: true, done: "palette:opened",
    commands: [keys("Ctrl K", "Open the command palette")] },

  // ---- Tasks
  { id: "task-keys", title: "Work through tasks from the keyboard", howTo: "Move, open, complete and reschedule without the mouse.", icon: "keyboard", group: "Tasks", since: OLD, core: false,
    commands: [keys("↑ ↓  or  J K", "Move between tasks"), keys("Enter", "Open the task"), keys("Space  or  C", "Complete"), keys("1 2 3 / 0", "Priority low, medium, high / none"), keys("T / Shift T", "Do today / tomorrow"), keys("Delete", "Delete"), keys("Ctrl / Shift + click", "Select several"), keys("Esc", "Close the drawer or clear the selection")] },
  { id: "undo", title: "Undo anything", howTo: "Every change can be taken back.", icon: "undo", group: "Tasks", since: OLD, core: false,
    commands: [keys("Ctrl Z", "Undo the last change")] },
  { id: "filter", title: "Filter a view", howTo: "Filter with the same words you add tasks with, put a minus in front to leave something out, and pin a filter to the navigation.", icon: "filter", group: "Tasks", since: OLD, core: false,
    commands: [keys("/", "Filter the current view"), token("overdue  nodate", "Overdue or undated"), token("done  wontdo", "Finished tasks, anywhere"), token("someday", "Someday, no date yet"), token("30m", "Exact duration"), token("by fri", "Deadline on or before the day"), token("waiting @sam", "Waiting for a person"), token("-#tag  -~list  -!high", "Leave out a tag, list or priority"), token("#work or #home", "Either tag"), token("this week  next week", "Whole week, from your week start")] },
  { id: "show-completed", title: "Show completed tasks", howTo: "Show or hide finished tasks in every view, in Settings or from the palette.", icon: "check", group: "Tasks", since: "1.0.0", core: false,
    commands: [palette("show-completed", "Toggle completed tasks")] },
  { id: "lists", title: "Organise with lists and folders", howTo: "Make a list for each part of your life and group lists into folders.", icon: "list", group: "Tasks", since: OLD, core: false,
    commands: [palette("new-list", "New list")] },
  { id: "templates", title: "Task templates", howTo: "Right-click a task → Save as template (its subtasks, checklist, tags and dates come along). Then New from template in the palette makes a fresh copy, with dates counted from today. Delete templates in Settings → General.", icon: "list", group: "Tasks", since: "1.2.4", core: false,
    commands: [palette("from-template", "New from template")] },
  { id: "edit-with-tokens", title: "Edit a task by typing", howTo: "Type a date, !priority, #tag, ~list or repeat into a task's title in its details. An Apply chip appears; Apply sets them and removes them from the title, Keep as text leaves it.", icon: "token", group: "Tasks", since: "1.2.4", core: false, commands: [] },
  { id: "recurring-checklist", title: "Repeating checklists start fresh", howTo: "A repeating task's checklist is unticked again for each occurrence; the finished one keeps what you ticked.", icon: "check", group: "Tasks", since: "1.2.4", core: false, commands: [] },
  { id: "new-task-defaults", title: "Defaults for new tasks", howTo: "Settings → General → New tasks: a default list, priority, and a reminder for tasks with a start time. They apply to tasks added from quick add; anything you type wins.", icon: "plus", group: "Capture", since: "1.2.4", core: false, commands: [] },
  { id: "blocking", title: "See what blocks what", howTo: "A task waiting on another shows “blocked by …” on its row; the task it waits on shows “blocking N” and lists them under Blocking in its details.", icon: "hourglass", group: "Tasks", since: "1.2.4", core: false, commands: [] },

  // ---- Planning (v1.3, D267)
  { id: "planning-tokens", title: "Deadlines, durations, someday and waiting", howTo: "Add these to the task text in any add box: a deadline apart from the planned date, how long it takes, Someday, or who you're waiting for and when to follow up.", icon: "token", group: "Capture", since: "1.3.0", core: false,
    commands: [token("by fri  by 12/3", "Deadline"), token("30m  1h30m  ~2h", "Duration"), token("someday", "Someday, no date yet"), token("waiting @sam fri", "Waiting for a person, follow up Friday")] },
  { id: "deadline", title: "Set a deadline", howTo: "A deadline is when it must be done by, apart from when you plan to do it. It shows as “by Fri”, turns red once passed, brings the task into Today on the day, and makes it urgent in the Matrix.", icon: "calendar", group: "Tasks", since: "1.3.0", core: false, commands: [] },
  { id: "duration", title: "Say how long a task takes", howTo: "Give a task a duration in its details or with “30m”, even without a time. Today's header adds up what's planned.", icon: "timer", group: "Tasks", since: "1.3.0", core: false, commands: [] },
  { id: "someday-waiting", title: "Someday and Waiting", howTo: "Someday holds tasks with no date yet. Waiting holds tasks waiting for someone or another task; they come back on the follow-up date or when that task is done.", icon: "hourglass", group: "Views", since: "1.3.0", core: false, commands: [] },
  { id: "one-thing", title: "One thing at a time", howTo: "Turn on One thing in Today's toolbar to see only the next task, with Done and Not now. Low energy shows only tasks of 15 minutes or less.", icon: "target", group: "Views", since: "1.3.0", core: false, commands: [] },
  { id: "snooze", title: "Snooze a task to a time", howTo: "Right-click a task → Snooze… and pick a day and time; it moves there and reminds you when it starts.", icon: "timer", group: "Tasks", since: "1.3.0", core: false, commands: [] },
  { id: "date-format", title: "Choose how dates read", howTo: "Settings → General → Date format: match the system, day first (31/12), month first (12/31) or year first. It sets how dates are shown and how quick add reads “3/4”.", icon: "calendar", group: "Tasks", since: "1.2.4", core: false, commands: [] },
  { id: "high-contrast", title: "High contrast", howTo: "Settings → Appearance → High contrast: black-on-white or white-on-black with strong borders (System follows your OS setting). Text size is the Scale slider.", icon: "palette", group: "Views", since: "1.2.4", core: false, commands: [] },
  { id: "sample-data", title: "Try with sample data", howTo: "Getting started (or Settings → General → Sample data) adds a “Sample data” folder with two lists to explore; Remove sample data deletes exactly that folder.", icon: "list", group: "Capture", since: "1.2.4", core: false, commands: [] },
  { id: "day-end", title: "Late nights count as the same day", howTo: "Settings → General → Day ends at: before that hour, Today, overdue and habits still count as the day before.", icon: "sun", group: "Keyboard", since: "1.3.0", core: false, commands: [] },

  // ---- Views
  { id: "home", title: "Start from Home", howTo: "Home shows today's tasks, what's next on your calendar, your habits and focus time, with a tile for every section. Choose what the app opens to in Settings → General → Open to.", icon: "sun", group: "Views", since: "1.3.0", core: false,
    commands: [palette("go-home", "Go to Home"), keys("G O", "Home")] },
  { id: "smart-views", title: "Inbox, Today and Upcoming", howTo: "New tasks land in Inbox; Today shows what's planned for today, overdue or at its deadline; Upcoming, the days ahead.", icon: "sun", group: "Views", since: OLD, core: false,
    commands: [palette("go-inbox", "Go to Inbox"), palette("go-today", "Go to Today"), palette("go-upcoming", "Go to Upcoming"), keys("G I / G T / G U", "Inbox / Today / Upcoming")] },
  { id: "day-order", title: "Reorder Today and Upcoming", howTo: "Drag a task above or below another in Today or Upcoming, or focus it and press Alt Up / Alt Down. The view switches to Manual sort and remembers your order; in Upcoming, dropping on another day's heading moves the task there.", icon: "sun", group: "Views", since: "1.3.0", core: false,
    commands: [keys("Alt ↑ / Alt ↓", "Move the focused task up or down")] },
  { id: "matrix-mode", title: "Sort tasks by urgent and important", howTo: "Switch any view to Matrix and drag tasks between the four quadrants.", icon: "grid", group: "Views", since: "1.0.0", core: true, done: "view:matrix",
    commands: [palette("matrix-mode", "Show as matrix"), keys("G M", "Matrix mode")] },
  { id: "board-timeline", title: "Board and Timeline", howTo: "Pick Board (a list's sections as columns) or Timeline in a view's header.", icon: "board", group: "Views", since: OLD, core: false, commands: [] },
  { id: "calendar", title: "Plan on the calendar", howTo: "Drag tasks onto time slots, and add events of your own.", icon: "calendar", group: "Views", since: OLD, core: false,
    commands: [palette("go-calendar", "Go to Calendar"), keys("G C", "Calendar"), keys("D / X / W / M / A", "Day / 5 days / week / month / agenda"), keys("T", "Jump to today"), keys("← →", "Previous / next")] },
  { id: "countdowns", title: "Count down to a date", howTo: "Turn on Show countdown on an all-day event, and pin it to Today.", icon: "hourglass", group: "Views", since: "1.0.0", core: false, commands: [] },
  { id: "calendar-subscriptions", title: "Follow a calendar", howTo: "Settings → Data → Calendar subscriptions: paste an .ics address (Google, Outlook, iCloud…) and its events appear here and on your phone, read-only.", icon: "calendar", group: "Views", since: "1.3.0", core: false, commands: [] },
  { id: "ics-import", title: "Import a calendar", howTo: "Settings → Data → Import an .ics file.", icon: "file", group: "Views", since: OLD, core: false, commands: [] },

  // ---- Habits & focus
  { id: "habits", title: "Keep a habit", howTo: "Build a habit, limit something (at most 5 minutes of Instagram), or quit it. Check in each day: builds reach a goal, limits log what you used, quits log a slip.", icon: "target", group: "Habits & focus", since: OLD, core: true, done: "habit:checked",
    commands: [palette("go-habits", "Go to Habits"), keys("G H", "Habits")] },
  { id: "focus", title: "Focus with a timer", howTo: "Start a Pomodoro, optionally on a task or some of its subtasks, and finish a session.", icon: "timer", group: "Habits & focus", since: OLD, core: true, done: "focus:completed",
    commands: [palette("go-focus", "Go to Focus"), keys("G F", "Focus")] },
  { id: "mini-window", title: "Keep the timer on top", howTo: "The mini window shows your next tasks, the timer and the matrix while you work elsewhere.", icon: "window", group: "Habits & focus", since: OLD, core: false,
    commands: [keys("Ctrl Alt M", "Show or hide the mini window (changeable in Settings)")] },
  { id: "streak-reminder", title: "Save a streak before it breaks", howTo: "At 18:00 (change it in Settings → Notifications) you get one reminder for habits with a running streak that you haven't done yet. Weekly habits are reminded on the week's last day.", icon: "target", group: "Habits & focus", since: "1.1.2", core: false, commands: [] },
  { id: "habit-backfill", title: "Fix a past day of a habit", howTo: "Open a habit and click any past day in the month grid or the year heatmap to check in or change its value. Future days stay closed.", icon: "target", group: "Habits & focus", since: "1.3.0", core: false, commands: [] },
  { id: "habit-pause", title: "Skip or pause a habit", howTo: "Right-click a habit, then Skip a day or Pause until I resume (Resume habit ends it). Paused days aren't due and don't break the streak. Quit and limit habits also show the days since your last slip.", icon: "target", group: "Habits & focus", since: "1.3.0", core: false, commands: [] },
  { id: "focus-manual", title: "Add focus time by hand", howTo: "On Focus, Add past session: pick the task, when it started and how long. A session that runs past midnight is split between the two days. If the computer sleeps mid-timer, a Keep button offers the time you were away.", icon: "timer", group: "Habits & focus", since: "1.3.0", core: false, commands: [] },
  { id: "auto-focus", title: "Start focus when a time block begins", howTo: "Turn on Start focus at time blocks in Settings → Notifications: a task you've put on the calendar starts a focus session when its time comes, and stops it when the block ends.", icon: "timer", group: "Habits & focus", since: "1.1.2", core: false, commands: [] },

  { id: "trash", title: "Get a deleted task back", howTo: "Deleted tasks wait in Trash for 30 days. Open Trash to Restore one, or Delete forever.", icon: "undo", group: "Tasks", since: "1.2.1", core: false,
    commands: [palette("go-trash", "Go to Trash")] },
  { id: "plan-day", title: "Plan your day and shut down", howTo: "Plan my day walks you through yesterday's leftovers (Keep, Tomorrow, Someday, Drop), picks today's tasks and shows the time planned. Shut down shows what you finished and sweeps the rest. Both start from Home or the palette.", icon: "sun", group: "Tasks", since: "1.3.0", core: false,
    commands: [palette("plan-day", "Plan my day"), palette("shut-down", "Shut down for the day"), keys("K / T / S / D", "In the flow: keep, tomorrow, someday, drop")] },
  { id: "weekly-review", title: "Review your week", howTo: "Review lists what is overdue, follow-ups that are due, old Inbox items, Someday, last week's done count and next week, with a quick action on each task.", icon: "check", group: "Views", since: "1.3.0", core: false,
    commands: [palette("go-review", "Go to Weekly review")] },
  { id: "logbook", title: "Look back at finished tasks", howTo: "Logbook lists everything you finished, by day, newest first. Search it to find a task you did long ago.", icon: "list", group: "Views", since: "1.3.0", core: false,
    commands: [palette("go-logbook", "Go to Logbook")] },
  { id: "time-report", title: "See where your focus time went", howTo: "Progress shows focus time by list and tag for the last 30 days, and how long finished tasks took compared with their estimate.", icon: "chart", group: "Progress", since: "1.3.0", core: false, commands: [] },
  { id: "search-more", title: "Search habits, events and notes", howTo: "The palette also finds habits and calendar events, and shows the matching line when a word is only in a task's notes.", icon: "search", group: "Capture", since: "1.3.0", core: false, commands: [] },

  // ---- Progress
  { id: "progress", title: "See your progress", howTo: "What you finished and how long you focused, by day and week, plus an activity heatmap.", icon: "chart", group: "Progress", since: OLD, core: false,
    commands: [palette("go-progress", "Go to Progress"), keys("G S", "Progress")] },
  { id: "sync", title: "Sync across your devices", howTo: "Settings → Account: sign in with your email and the same tasks, habits and settings appear on every device, even after offline edits.", icon: "window", group: "Progress", since: "1.1.0", core: false, commands: [] },

  // ---- Friends & sharing (v1.4)
  { id: "friends", title: "Add friends", howTo: "Friends → Add friend by @handle, or Copy invite link and send it. Friends see nothing of your tasks unless you share or send them.", icon: "users", group: "Friends & sharing", since: "1.2.0", requires: "signedIn", core: false,
    commands: [palette("go-friends", "Go to Friends")] },
  { id: "sent-task", title: "Send a task to a friend", howTo: "Right-click a task → Send to friend…. They accept it from Friends → Requests and get their own copy in Inbox; you only see Accepted, Declined or Waiting.", icon: "share", group: "Friends & sharing", since: "1.2.0", requires: "signedIn", core: false, commands: [] },
  { id: "sharing", title: "Share a list or folder", howTo: "Right-click a list or folder → Share…. Invite friends or make a link, and choose who can edit and who can only view.", icon: "list", group: "Friends & sharing", since: "1.2.0", requires: "signedIn", core: false, commands: [] },
  { id: "focus-together", title: "Focus together", howTo: "Turn on Let friends see when I'm focusing in Focus. Friends see only that you're focusing and when it ends; Join starts your own session that ends at the same moment.", icon: "timer", group: "Friends & sharing", since: "1.2.0", requires: "signedIn", core: false, commands: [] },
  { id: "buddies", title: "Check-in buddies", howTo: "Edit a habit → Check-in buddies, and pick friends who see its name and today's check-in. A buddy can nudge you once a day; switch nudges off per habit.", icon: "target", group: "Friends & sharing", since: "1.2.0", requires: "signedIn", core: false, commands: [] },
  { id: "connections", title: "Add tasks from Discord, Slack, Telegram or a webhook", howTo: "Settings → Connections shows a 6-digit code to link a chat, and a private webhook URL. Linked chats can add tasks, list your day and get a daily Digest.", icon: "plus", group: "Friends & sharing", since: "1.2.0", requires: "signedIn", core: false, commands: [] },

  // ---- Keyboard and app
  { id: "appearance", title: "Make it yours", howTo: "Theme, accent, layout and scale are in Settings → Appearance.", icon: "palette", group: "Keyboard", since: OLD, core: false,
    commands: [palette("theme-light", "Switch theme: Light"), palette("theme-dark", "Switch theme: Dark"), palette("theme-system", "Switch theme: System"), palette("sidebar", "Collapse or expand the sidebar", "["), keys("[", "Collapse or expand the sidebar"), keys("Ctrl + / Ctrl − / Ctrl 0", "Scale up / down / reset")] },
  { id: "background", title: "Pick a background", howTo: "Put a colour or one of your own images behind the app, and dim it to keep text easy to read, in Settings → Appearance.", icon: "palette", group: "Keyboard", since: "1.0.2", core: false, commands: [] },
  { id: "agents", title: "Let your AI agent use Momentum", howTo: "Settings → AI agents shows the setup for Claude, Cursor, Codex and Gemini. Or run momentum add \"call mom by fri 15m\" in a terminal. Deleted tasks go to the Trash: momentum trash lists them, momentum restore brings one back.", icon: "window", group: "Keyboard", since: "1.3.0", core: false, commands: [] },
  { id: "report", title: "Report a problem", howTo: "Settings → Help → Report a problem sends us a description, and a screenshot if you like. It needs an internet connection.", icon: "help", group: "Keyboard", since: "1.1.2", core: false, commands: [] },
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
