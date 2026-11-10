# Momentum — Implementation Plan

Offline, local-first desktop planner (tasks + calendar + habits + Eisenhower Matrix).
Tauri 2 + React/TS/Vite + Tailwind + Zustand + SQLite. Windows is the primary target.

Status: **All 7 phases done.** v0.1.0 is ready to tag.

---

## 0. Prerequisites (Windows)

| Tool | Status on this machine | Needed for |
|---|---|---|
| Node 24 + npm 11 | installed | frontend, Vitest |
| git | installed | commits |
| Rust (rustup, MSVC toolchain) | **missing** | Tauri build. `winget install Rustlang.Rustup` |
| MSVC Build Tools ("Desktop development with C++") | unknown | Rust linker on Windows |
| WebView2 | ships with Windows 11 | runtime |
| gh CLI | missing | optional; releases are cut by pushing a tag |

Package manager: **npm**, since pnpm isn't installed and npm is good enough here.

---

## 1. Architecture

```
React views ──► Zustand stores (in-memory, the read model every view shares)
                    │  actions write through
                    ▼
               db/ repositories (typed SQL, one file per entity)
                    │
                    ▼
           @tauri-apps/plugin-sql ──► SQLite  (%APPDATA%/com.momentum.planner/momentum.db)
```

- **One source of truth:** on startup the stores hydrate from SQLite. Every mutation is `store.update → repo.write` (optimistic, auto-saved). Smart Lists, Matrix quadrants, calendar blocks and search results are **derived selectors** over the same task records. None of them is stored.
- **Pure logic lives in `src/domain/`** (recurrence, date math, matrix rules, streaks, NL parsing, smart-list predicates, calendar overlap layout). It has no React and no Tauri imports, so Vitest can test all of it directly.
- **Search:** an in-memory filter over store data. A few thousand records is trivial; FTS5 waits until profiling says otherwise.
- **Second window:** the quick-add window is the same bundle loaded with `?window=quickadd`. No separate app.

### Time and date rules (where most of the bugs come from)
- Timed instants (`startAt`, `endAt`, `completedAt`, `createdAt`) are stored as **UTC ISO strings**.
- All-day items and `dueDate` are stored as **local calendar dates `YYYY-MM-DD`**. Never convert them to an instant, because that shifts them by a day across time zones.
- Recurrence is evaluated in **floating local wall-clock time**: a 09:00 daily task stays at 09:00 across a DST change. rrule runs on "fake-UTC" dates built from local components and converts back to the user's zone afterwards. This is the standard rrule workaround, and it gets covered by DST tests.
- Occurrences are **virtual**: expanded on demand for the visible range and never written as rows. Exceptions live in `recurrence_exceptions`:
  - `skip`: a deleted occurrence, which becomes an EXDATE.
  - `override`: an edited or completed occurrence, which points to a detached task row (`recurrenceParentId` + `originalStart`).
  - "This and following": the original series gets an `UNTIL` and a new series starts.
- Recurring tasks complete **per occurrence**: completing one writes an override, and the series stays open.

### Eisenhower Matrix
- The quadrant is **derived, never stored**: `important = priority ∈ rules.importantPriorities`, `urgent = overdue || due within rules.urgentDays`. The defaults are {high, medium} and 2 days, held in settings.
- Dropping a task into a quadrant applies the **minimal attribute change** that makes the rule true or false:
  - Important → priority becomes High, unless it's already Medium or High.
  - Not important → priority becomes Low, unless it's already none or Low.
  - Urgent → due becomes today, unless it's already urgent.
  - Not urgent → due becomes `today + urgentDays + 1`, unless it's already not urgent.

  Tasks created inside a quadrant get the same patch.

### Habits
- Frequency is a discriminated union: `{kind:'daily'} | {kind:'weekdays', days:number[]} | {kind:'perWeek', count:number}`.
- Streaks:
  - Daily and weekday habits count scheduled days, so unscheduled days neither break nor extend a streak.
  - Per-week habits count consecutive weeks that hit the target. The current week can't break a streak until it ends.
- Goal types: `once` (value 1), `count` (increment toward a target), `amount` (manual entry toward a target). A check-in counts as complete when `value ≥ target`.

### Migrations and backup
- SQL migrations are registered through `tauri-plugin-sql` in `src-tauri/src/lib.rs` from numbered files in `src-tauri/migrations/NNNN_name.sql`.
- **Pre-migration backup:** in Rust `setup`, which runs before the frontend opens the DB (the moment the plugin migrates), copy `momentum.db` and its WAL sidecars to `backups/momentum-v<oldSchema>-<unix>.db` whenever the `schema_version` marker is behind the newest bundled migration. Keep the last 10. The marker only advances after the copy succeeds, and a failed backup stops startup with an error.
- JSON export and import cover every table, with a `schemaVersion` field. Import validates the data at that boundary and runs in one transaction that replaces everything, after an automatic backup.

---

## 2. Data model (SQLite tables)

`folders`, `lists`, `sections` (Kanban columns per list), `tasks`, `task_tags`, `tags`, `checklist_items`, `reminders`, `recurrence_exceptions`, `task_activity`, `calendar_events`, `habits`, `habit_groups`, `habit_checkins`, `countdowns`, `focus_sessions`, `rest_days`, `celebrations`, `settings` (one key/value JSON row).

Notes on the brief's fields:
- **`tasks`** has every field from the brief, plus `sectionId`, `recurrenceParentId`, `originalStart`, and a `durationMinutes` that stays in sync with `endAt`.
- **Subtask depth** is capped at 5. The cap is enforced in the domain layer.
- **Checklist items** are lightweight rows in `checklist_items`, separate from subtasks, which are full tasks.
- **Activity history** is an append-only log: `task_activity(taskId, at, kind, payload)`.
- **Inbox** is a built-in list with a fixed id `inbox` that can't be deleted.
- **Sort order** uses fractional ordering (a float `sortOrder` set to the midpoint of its neighbours, renormalised when the gap gets tiny), so drag-reordering writes one row.

---

## 3. Folder structure

```
momentum/
├─ PLAN.md · CLAUDE.md · README.md · LICENSE
├─ package.json · vite.config.ts · tsconfig.json · index.html
├─ .github/workflows/release.yml        # tauri-action, Win first + mac + linux, on v* tags
├─ src-tauri/
│  ├─ tauri.conf.json                   # productName Momentum, id com.momentum.planner, dragDropEnabled:false
│  ├─ capabilities/default.json
│  ├─ migrations/0001_init.sql …
│  ├─ icons/                            # generated by `npx tauri icon`
│  └─ src/{main.rs, lib.rs}             # plugins, backup-before-migrate, tray, global shortcut
├─ assets/logo.svg                      # source of the icon set
└─ src/
   ├─ main.tsx · App.tsx                # routes by ?window=main|quickadd
   ├─ styles/{tokens.css, globals.css}  # CSS variables, light/dark, radii, motion
   ├─ domain/                           # PURE logic + *.test.ts beside each file
   │  ├─ types.ts                       # Task, List, Habit … discriminated unions
   │  ├─ dates.ts  recurrence.ts  smartLists.ts  matrix.ts  habits.ts
   │  ├─ quickAdd.ts                    # chrono-node + !priority #tag ~list parsing → chips
   │  ├─ calendarLayout.ts              # overlap columns, snapping, month "+N more"
   │  └─ order.ts                       # fractional sortOrder
   ├─ db/                               # one repo per entity over plugin-sql, + seed.ts (dev flag)
   ├─ stores/                           # zustand: tasks, lists, habits, events, settings, ui
   ├─ components/ui/                    # Button, Popover, Drawer, Checkbox, Tooltip, Toast, Kbd …
   ├─ features/
   │  ├─ shell/        # TopBar, Sidebar, CommandPalette, ShortcutSheet
   │  ├─ tasks/        # QuickAdd, TaskList, TaskRow, Kanban, Timeline, TaskDrawer, BulkBar
   │  ├─ calendar/     # Day/ThreeDay/Week/Month/Agenda, TimeGrid, EventBlock, ArrangePanel
   │  ├─ matrix/       # MatrixView, Quadrant, RulesEditor
   │  ├─ habits/       # HabitList, HabitDetail, Heatmap, Review
   │  ├─ focus/  countdown/  stats/  settings/
   └─ lib/            # shortcuts, dnd sensors, platform (tauri wrappers)
```

---

## 4. Dependencies (each one earns its place)

- **Runtime:** `react`, `react-dom`, `zustand`, `@tauri-apps/api`, `@tauri-apps/plugin-sql`, `@dnd-kit/core`, `@dnd-kit/sortable`, `date-fns`, `rrule`, `chrono-node`, `lucide-react`, `@fontsource-variable/inter` (UI) and `@fontsource-variable/bricolage-grotesque` (24px+ titles and big numbers only), bundled so nothing loads from the network (D198), `@fontsource/jetbrains-mono` (the focus timer only).
- **Added in the phase that needs them:**
  - `@tanstack/react-virtual` for long lists.
  - `react-markdown` for safe Markdown rendering.
  - Tauri plugins: `notification`, `global-shortcut`, `autostart`, `dialog` and `fs` (export/import).
  - `ical.js` for .ics import, which needs correct TZID and RRULE handling.
  - `updater` and `process` Tauri plugins: signed in-app updates and the restart after one (D59).
  - `canvas-confetti` (about 6 KB, offline) for the celebration confetti, so we don't maintain a particle system (D63).
  - `@radix-ui/react-tooltip` (MIT, bundled) for tooltips on icon-only controls: hover/focus delay, Escape, collision and `aria-describedby` we'd otherwise hand-roll (D208).
  - `sonner` (MIT, bundled) for toasts: stacking, swipe and hover-pause, exit motion and an accessible live region we'd otherwise hand-roll (D207).
  - `sherpa-onnx` (Rust, statically linked; its build script fetches prebuilt libs in CI) runs Parakeet on-device, and `cpal` captures the microphone in Rust (D81; Linux CI needs `libasound2-dev`). The model download uses `reqwest` (already pulled in by the updater), `sha2` to verify, and `tar` + `bzip2` to unpack.
  - `tauri-plugin-window-state` (Rust) persists the main window's size, position and maximized state; the fit-to-work-area clamp runs after it restores (D76).
  - Tauri's `protocol-asset` feature serves attachments and backgrounds from app data (D78, D79). `zip` (Rust, deflate only) reads and writes the `.zip` backups, refusing entries outside `attachments/` with invalid names or over 10 MB.
- **Deliberately not added:**
  - Chart library: the stats charts and heatmaps are small hand-written SVGs.
  - Color library: accent presets are hand-tuned per theme in `tokens.css` (D198); the remaining mixes use CSS `color-mix(in oklch, …)`.
  - Color picker: native `<input type="color">`.
  - Router: views are a single `ui.view` state.
  - Form library, CSS-in-JS.
- **Dev:** `vite`, `typescript`, `tailwindcss`, `vitest`, `@tauri-apps/cli`, `playwright-core` (README screenshots on the installed Edge, no browser download; D61).

---

## 5. Phases (the app runs and tests pass at the end of each; one commit per phase)

1. **Foundation.**
   - Tauri + Vite scaffold and app identity.
   - Design tokens, light/dark/system themes, accent presets with derived variants (custom accent dropped in D55).
   - App shell: top bar, sidebar that collapses (and can sit left or right), drawer slot on the opposite side.
   - SQLite, migration 0001, backup-before-migrate, settings persistence.
   - Tests: `dates.ts` helpers.
2. **Tasks core.**
   - Lists, folders and tags.
   - Quick-add with live NL chips; Esc turns parsing off.
   - Task drawer: Markdown, subtasks, checklist, reminders data, activity.
   - Smart Lists with show/hide.
   - Drag reorder and drag between lists.
   - Multi-select bulk bar.
   - List, Kanban and Timeline views with group and sort.
   - Won't Do, completion animation, undo toast.
   - Ctrl+K palette.
   - Dev seed data.
   - Tests: quickAdd, smartLists, order.
3. **Calendar.**
   - Day, 3-Day, Week, Month and Agenda views.
   - Now-line, all-day row, mini month picker, keyboard shortcuts.
   - Drag on the grid to create, drag to move, drag edges to resize, 15-minute snap.
   - Overlap layout, "+N more" in month view.
   - Arrange Tasks panel, in and out.
   - Recurrence plus scope prompts ("this", "this and following", "all").
   - View options.
   - Tests: recurrence, DST, calendarLayout.
4. **Eisenhower Matrix.**
   - Quadrants with counts.
   - Drag between quadrants to apply rule patches; creating in a quadrant inherits the patch.
   - Rules editor.
   - Tests: matrix.
5. **Habits + statistics.**
   - Check-in controls, notes and mood.
   - Detail view with streaks, completion rate, month grid and year heatmap.
   - Weekly and monthly review; habits in Today and on the calendar.
   - Stats page.
   - Tests: habits/streaks.
6. **OS integration.**
   - Notifications with Snooze, Done and Open.
   - Tray, minimize to tray, autostart.
   - Global Ctrl+Shift+A quick-add window.
   - Focus timer (Pomodoro and stopwatch) with stats.
   - Countdowns.
7. **Ship.**
   - Settings polish: density, font size, list tints.
   - JSON export/import and .ics import.
   - Logo and icon set.
   - `release.yml`.
   - README with screenshots.
   - MIT license.

---

## 6. Decisions and risks (I'll keep adding to this as I go)

- **D1: npm, not pnpm.** pnpm isn't installed.
- **D2: Floating local time for recurrence.** A "9am daily" task means 9am wherever the user is, across DST changes. Fixed-zone events from .ics files are converted to local on import.
- **D3: Matrix quadrant derived, not stored.** It can never disagree with priority or due date.
- **D4: Virtual recurrence occurrences.** The DB doesn't fill up with generated rows, and editing a series edits one row.
- **D5: Reminder scheduler runs in the main window's JS.** It checks every 30s against the next due reminder. The tray keeps the window alive while hidden, so reminders still fire. Moving it to Rust waits until JS timers prove unreliable when the window is hidden.
- **D6: Backups trigger on schema version, not app version.** The schema-version marker also catches migrations added during development, while the app version stays `0.1.0`.
- **D7: Tailwind v4 with a CSS-first config.** The design tokens are CSS variables in `src/styles/tokens.css`, mapped to utilities through `@theme inline`. There's no `tailwind.config.ts`.
- **D8: Migrations are never edited after they're applied.** sqlx checksums each applied migration, so every schema change goes in a new `NNNN_*.sql` file, starting from `0001_settings.sql`.
- **D9: Plain-browser dev mode.** Running `npm run dev` without Tauri renders the full UI with default settings and no persistence (`isTauri` in `src/db/client.ts`), which makes quick UI checks easy.
- **D10: Each phase adds only its own dependencies.** For example, dnd-kit, rrule and chrono-node arrive in Phase 2 or 3.
- **D11: Small nested collections are JSON columns.** Tags, checklist, reminders and exdates are stored as JSON columns on `tasks` instead of separate tables. All queries run in memory over the store, so normalising them buys nothing. They're validated at the row boundary (`src/db/rows.ts`).
- **D12: A task's schedule is a discriminated union.** It's `none | day(date) | timed(start, end)`. The brief's `isAllDay` and `durationMinutes` are derived from it, not stored.
- **D13: Recurrence exceptions are exdates plus detached copies, with no exceptions table.**
  - Completing or editing one occurrence adds its key to the series' `exdates` and creates a standalone task with `recurrenceParentId` set.
  - Completed occurrences are therefore ordinary done tasks, so the Completed list, stats and calendar need no special case.
  - A series with no occurrences left is soft-deleted.
  - Occurrence keys are wall-clock strings, so they stay stable across DST and time-zone changes.
- **D14: Scope prompts are only for timing changes.** Changing a recurring task's schedule asks "this / following / all", and so does deleting it. Title, notes, priority and tags edits apply to the whole series without a prompt.
- **D15: Soft delete makes undo cheap.** `deletedAt` is set and the row is purged on the next launch. A generic `undoable(fn)` restores exactly the task objects `fn` touched, which covers delete, bulk edits and recurring completion. Ctrl+Z pops the last undo.
- **D16: Today includes overdue tasks**, and so does its badge count. Overdue is also its own smart list.
- **D17: Smart lists and tag views are flat. Custom lists and the Inbox show the subtask tree.** Completed tasks collapse into a "Completed" group in tree views.
- **D18: Quick-add syntax** is `!high`/`!2` for priority, `#tag`, `~ListName` (spaces ignored), repeat phrases, then chrono for dates. Only the English chrono locale is imported.
- **D19: One app-wide DndContext with a drop-handler registry** (`lib/dnd.tsx`). Each feature registers handlers for its own drop-target types: list, smart, task, kanban-column, and later slot, arrange and quadrant.
- **D20: Zustand selectors must return stable references.** `npm test` runs `scripts/check-selectors.mjs` first and fails if a selector builds a new array (that pattern caused a React render loop).
- **D21: Native date/time inputs.** The drawer uses `<input type="date|time">`, which WebView2 renders with locale formatting. The app's 12h/24h setting applies everywhere else.
- **D22: Calendar events are their own type** (`calendar_events`, migration 0003). They use the same `Schedule` encoding as tasks, plus `spanDays` for multi-day all-day events. The recurrence helpers (`detachOccurrence`, `splitSeries`) are generic over `Series`, so tasks and events share the exception logic.
- **D23: Calendar drop math uses the dragged element's translated rect**, not dnd-kit's `delta`, which folds in scroll-container offsets and was off by 90px or more. The column position is measured live from the DOM (`[data-cal-col]`), so scrolling doesn't skew it.
- **D24: Move uses dnd-kit; resize and drag-to-create use plain pointer events.** Moving goes through dnd-kit so blocks can travel to other days, the all-day row, month cells and the Arrange panel. Resizing and drag-to-create stay local to one column. `markDragged()` and `justDragged()` suppress the click that follows any of these gestures.
- **D25: Multi-day events appear as a chip in each day's cell** rather than as one bar spanning days. That's simpler, and it's readable at seven columns.
- **D26: The calendar anchor (which date is shown) lives only for the session.** The view type, colour-by, show/hide flags and density persist in `settings.calendar`.
- **D27: Matrix rules live in `settings.matrix`.** The editor, and the parser at the settings boundary, keep at least one priority level important and at least one not important. Otherwise a quadrant move could be impossible to satisfy.
- **D28: "Due within N days" includes today through today+N, plus anything overdue.** Undated tasks are never urgent. Making a task not urgent moves it to today+N+1. Recurring tasks whose date has to change go through the scope prompt; priority-only changes don't prompt.
- **D29: Habits get their own store and tables** (`stores/habits.ts`, migration 0004). Check-ins are keyed by `(habit_id, date)`. An empty check-in (value 0, no note, no mood) deletes its row, so the table only holds days that mean something.
- **D30: Streak semantics.**
  - Daily and weekday habits count consecutive *scheduled* days; unscheduled days are skipped.
  - Per-week habits count consecutive weeks that met their target.
  - An unfinished today, or an unfinished current week, never breaks a streak.
  - Days before `startDate` never count.
  - Completion rate excludes today until it's done.
- **D31: Habits on the calendar are read-only all-day markers**, controlled by the "Show habits" option. Checking in happens in Habits or in Today's habit strip.
- **D32: Charts are hand-made SVG with no chart library** (`components/ui/BarChart.tsx`, following the dataviz skill):
  - Single-series bars with rounded data-ends, a nice-number axis and a recessive grid.
  - A hover tooltip per bar, plus a screen-reader table.
  - The habit heatmap is a sequential single-hue scale in the habit's own colour.
- **R1 → resolved by D35.** `tauri-plugin-notification` doesn't expose action buttons on desktop, so Momentum sends a plain OS toast and also shows its own reminder popup.
- **D33: The main window is the only writer.** The quick-add and reminder popups are separate windows with their own capability (`capabilities/popups.json`) and no SQL access. They send `quickadd:create` and `reminder:action` events, and the main window applies them through the same code paths as in-app actions. Appearance reaches the popups through a localStorage snapshot that's validated with `parseSettings`.
- **D34: Reminders fire exactly once.** `remindersBetween(last, now]` runs every 30s over the current occurrence of each task plus habits that are still due.
  - Fired keys, including the fire time, go in `reminder_log`. Rescheduling therefore re-arms a reminder.
  - Reminders missed within the last 12h fire on launch.
  - Snoozes survive a restart.
  - "N minutes before" uses wall-clock arithmetic, so "1 day before" a 09:00 task is 09:00 the day before, even across a DST change.
- **D35: Reminder popup.** An always-on-top window in the bottom-right corner carries Done, Snooze (10 min, 1 h, tomorrow 9:00) and Open. It appears alongside the OS toast.
- **D36: Tray and close-to-tray are decided in Rust.** The frontend tells Rust the setting with `set_close_to_tray`. Closing the main window either hides it or quits, so hidden popups can never keep a windowless process alive. Tray menu: Open, Quick add, Quit. Single-instance focuses the running copy. Autostart passes `--minimized`, which starts hidden.
- **D37: The global shortcut is registered from JS** with the plugin, using the key combination set in Settings. A failure shows a toast instead of crashing (this resolves R2).
- **D38: The focus timer is a pure state machine driven by wall-clock timestamps.** A 1s tick in the main window ends Pomodoro phases even while the window is in the tray. Sessions under one minute aren't recorded, and Pomodoro sessions are capped at the focus length.
- **D39: JSON backups are table dumps.** Each backup holds one row-format array per table. Restore reuses the same row parsers as loading from SQLite (one boundary), then `repairReferences` fixes dangling foreign keys and parent cycles before inserting. A consistent `VACUUM INTO` snapshot is taken first. ponytail: restore is sequential writes rather than one transaction (plugin-sql pools connections), and the snapshot is the way back if it fails partway.
- **D40: File access goes through two Rust commands** (`read_text_file` / `write_text_file`), limited to `.json` and `.ics`, plus the dialog plugin. No fs plugin and no broad file scope.
- **D41: .ics import uses ical.js.** It handles VTIMEZONE, RRULE, EXDATE and RECURRENCE-ID. Events get ids `ics:<UID>[:<recurrence-id>]`, so re-importing is idempotent. Imported events are read-only.
- **D42: Icons** are generated from `assets/app-icon.svg` with `npx tauri icon`; mobile sets were removed. The in-app `Logo` uses the same geometry, tinted with the accent.
- **D43: Custom title bar.** The main window is undecorated (`decorations: false`). The view header is the drag region (`data-tauri-drag-region`; double-click maximizes) and holds minimize / maximize / close (`features/shell/WindowControls.tsx`). Close still goes through CloseRequested, so close-to-tray applies.
- **D44: One shared right-click menu.** `openContextMenu(e, items)` in `stores/ui.ts` feeds a single `<ContextMenu>`; items are data (`MenuEntry`), built by `taskMenu`, `habitMenu`, the sidebar and calendar blocks. "…" buttons open the same menu (`openMenuAt`). The webview's own menu is suppressed except in text fields.
- **D45: Calendar ranges.** "3 days" became "5 days" (old settings map over). Dragging across days on the mini month sets a session-only `calSpan` (2–14 days from the anchor) that overrides the view's range; longer drags open the month.
- **D46: Notifications are typed and filtered in the scheduler.** `settings.notify` holds a master switch, per-kind switches (task reminders, start alerts, habit reminders, daily summary, focus, quick add) and the look (popup / Windows toast / both, popup corner, chime). Start alerts only fire within 10 minutes of the start, so a long sleep doesn't replay a day of them; an explicit "at start" reminder and a start alert are deduped. The chime is Web Audio, so no sound file ships.
- **D47: Icons replace emoji** for lists, habits, countdowns and moods. A curated Lucide set (`components/ui/AppIcon.tsx`) is stored by key in the existing `emoji` / `icon` columns. Old emoji values map to the closest icon at render time, so no migration is needed. The domain fields are now `icon`.
- **D48: Welcome tour** shows while `settings.onboarded` is false (saved settings without the flag see it once), and can be reopened from Settings.
- **D49: Four smart lists.** Inbox, Today (includes overdue), Upcoming (any future date, grouped by date) and Logbook (done + won't do, off the sidebar; reached from Ctrl K and the view menu). Tomorrow, Next 7 Days, Overdue, Unscheduled and High Priority were dropped: Upcoming's date groups and the filter bar (D51) cover them. The `hiddenSmartLists` setting is gone; `parseSettings` maps old ids in `defaultView` and `viewOptions` to the new ones.
- **D50: "More" module group.** Calendar stays in the sidebar; Matrix, Habits, Focus, Countdown and Statistics sit under a collapsible More (`settings.sidebarMoreOpen`). The current view and a running focus timer stay visible when it's closed.
- **D51: Filters use the quick-add grammar.** `src/domain/filter.ts` reuses `parseQuickAdd` for `#tag !priority ~list <date>` and adds `overdue`, `nodate`, `done`, `wontdo`. Every task view has a filter bar (session-only query); a filter can be pinned as a sidebar row, stored as `settings.savedFilters` (a query string is config, not derived data, so no table). Tags left the sidebar: tag chips filter the current view, and rename/delete moved to Settings.
- **D52: Animations setting.** `settings.motion` is System / On / Off and lands on `html[data-motion]`; tokens.css zeroes motion for Off, or for System when the OS asks for reduced motion (Windows "Animation effects" off reaches WebView2 as `prefers-reduced-motion`). JS that waits on motion uses `lib/motion.ts`. Sidebar sections animate through `components/ui/Collapse`, which unmounts closed content so hidden rows can't catch drops.
- **D53: Keyboard.** `G` + letter jumps to a view, `J`/`K` (or arrows) move focus between task rows, and `1 2 3 0`, `T`/`Shift T`, `C`, `Delete` act on the selection or the focused row (rows carry `data-task-id`). `T` skips repeating tasks, which need the scope prompt. `/` focuses the filter, `[` toggles the sidebar, `Ctrl ,` opens Settings.
- **D54: Onboarding is hands-on.** Five steps: look and feel (applies live), add a real first task with the actual quick-add bar, the sidebar and filters, planning tools, and starter shortcuts.
- **D55: Accent presets only; the app icon follows the accent.** The custom accent picker is gone, so each of the nine presets has an icon. `parseSettings` maps an old custom accent to the default. `lib/os.ts` renders the mark from `assets/app-icon.svg` with the accent gradient to a PNG and sets it on the main window (taskbar button) and the tray. The installer/exe icon stays indigo: Windows reads it from the binary, and a pinned taskbar shortcut keeps it.
- **D56: The reminder popup fits its cards.** The main window emits `reminder:show` with the corner; the popup window sizes itself to its stack (max 560 logical px, then it scrolls) and places itself, instead of a fixed 380x440 window with empty space.
- **D57: Settings save as you change them.** There is no Save button: every change writes through, and a test round-trips every non-default setting through `parseSettings`. The quick-add shortcut used to reset after a restart because its validator was `/^[w+]+$/` (missing backslash).
- **R2: Global shortcut conflict.** If Ctrl+Shift+A is already taken by another app, registration fails. The app shows a toast and lets the user rebind it in Settings.
- **R3: Unsigned builds.** SmartScreen will show a warning, and the README says so.
- **R4: Project folder is inside OneDrive.** `node_modules` and `src-tauri/target` (several GB) would sync constantly and can hit file-lock errors during Rust builds. Recommended fix: move the project to `C:\dev\momentum`.
- **D58: Subtasks are part of their parent.** Like Todoist, a subtask is a real task (its own date, priority, reminders) that lives nested under its parent in list views, and a dated subtask still shows in Today/Upcoming. Like Things and Microsoft To Do, it never stands alone in the cross-cutting views: Matrix, Calendar (grid and Arrange panel) and the Focus picker show top-level tasks only (`Derived.roots`), with a done/total count on Matrix cards. Dragging a subtask to the calendar or a quadrant acts on its top-level task (`rootOf`). Focusing on a task lists its subtasks under the timer so they can be checked off there. Completing or won't-doing a parent finishes its open subtasks (undo restores them); reopening it leaves them as they were.
- **D59: In-app updates are the one network call.** `tauri-plugin-updater` checks `releases/latest/download/latest.json` on GitHub at launch (Settings → System → Updates turns it off, or "Check now"). A new version shows a toast with *Update and restart*; the download is verified against the public key in `tauri.conf.json`, and the Windows installer runs in passive mode. Release builds are signed by the `TAURI_SIGNING_PRIVATE_KEY` / `_PASSWORD` repository secrets; the key lives outside the repo. Only published (not draft) releases are offered.
- **D60: Ocean blue is the default accent and the shipped icon.** The bundled icons (`npx tauri icon assets/app-icon.svg`) are blue, so the installer, the exe and a pinned taskbar shortcut match the default. The window and tray still repaint in the chosen accent at runtime (D55); Windows keeps a pinned shortcut's own icon.
- **D61: README screenshots are generated.** `npm run screenshots` starts Vite, drives the seeded browser build through its stores with `playwright-core` on the installed Edge, and rewrites `docs/screenshots/`. Run it after any visible change.
- **D62: A focus phase ending is an alarm.** When a pomodoro phase runs out, the app plays the chime three times (if Chime is on), shows an in-app toast and flashes the taskbar button until the window gets focus (`requestUserAttention(Critical)`). This happens even with notifications off. The OS notification still follows Notifications → Focus.
- **D63: Sounds and celebrations.** Sound effects are synthesized with Web Audio (`src/lib/sounds.ts`): five sounds, one pick per event in Settings → Sounds, plus a master volume and an off switch. The reminder chime stays under Notifications. Completing a task or reaching a habit's goal plays its sound, and a small logo badge pops out of the checkbox. Big moments (perfect day, week, month or year, habit streaks of 7/30/100/365 days, the long break, a new trophy) show the logo animating in with bursting rings, popping dots and confetti (`canvas-confetti`), dismissed by any click. Each plays once: its key is stored in `celebrations`. With animations off (Settings → Animations, or the OS setting while that is "System") a toast replaces the overlay; with the window hidden only the sound plays. The long break's sound replaces the focus alarm.
- **D64: Perfect days are derived, not stored.** `src/domain/perfect.ts` computes them from tasks, habit check-ins, rest days and reschedules. That makes history count automatically (about a year back; reschedules only from v0.4).
  - A **perfect day** has at least 1 task due. Everything in Today is done or marked Won't do by the end of the day, including overdue tasks and repeats. No task was moved later on or after its due day ("pushed off"). Every daily and weekday habit reached its goal.
  - Days with nothing due, and rest days, are neutral.
  - A **very good week** (calendar week, from the week-start setting) has at least 3 active days, at least 90% of its due tasks and habit check-ins done, and every per-week habit at its count. An active day has a task due, a task completed and, when there are habits, a habit kept.
  - **Tiers:** every qualifying week is a perfect week, every 4th in a row a perfect month, every 52nd a perfect year. A week is celebrated when its last day becomes perfect, or else on the first visit after it ends.
  - **Rest day:** one per week, taken from Today until the day ends (`rest_days`).
  - **Trophies** are recomputed from history. The first run shelves them without a celebration (`init:v1`).
  - Rescheduling now logs `from → to` in `task_activity.detail`.
  - Rest days and played celebrations aren't part of JSON backups yet.
- **D65: Zoom is the webview's.** Settings → Appearance → Zoom (80–175%, Ctrl + / Ctrl − / Ctrl 0) uses `setZoom`, so every pixel scales, fixed sizes included. Text size has 5 steps (14–20px root font size). Popups keep zoom at 100%.
- **D66: Release notes come from CHANGELOG.md.** The release workflow puts the tag's `## vX.Y.Z` section above a `---` line in the release body. Settings → Updates shows the running version, the last check, the status, the notes above the line and download progress. After an update installs, a one-time "What's new" card shows those notes, which were saved to localStorage before installing, so no extra network call is needed.
- **D67: Updates ask in a dialog; "What's new" reads the bundled changelog.** The launch check opens an "Update available" dialog with the notes and download progress, instead of a toast that was easy to miss. "What's new" reads the `CHANGELOG.md` that ships inside the app (`?raw` import) and shows it once when the version differs from the last one seen (`momentum:seen-version`). A section whose bullets have screenshots (`public/whats-new/`) becomes a step-by-step tour. This supersedes saving the notes before installing (D66).
- **D68: Four layouts.** Settings → Layout (and the tour's first step) picks Classic (sidebar and a floating card, the original), Flat (edge to edge, one divider), Top bar or Dock. Top bar and Dock share `NavBar`: the sidebar's destinations in one row, with lists and pinned filters behind a Lists menu. Dropping tasks onto a list therefore needs the sidebar layouts; Inbox, Today and Upcoming still take drops everywhere. The Top bar holds the window controls.
- **D69: The guided tour spotlights the real app.** It replaces the welcome dialog. `Tour.tsx` dims everything with a box-shadow hole that glides to each `[data-tour]` anchor (or the whole content area), opening that view first. A card beside the hole explains it with tips. The quick-add step lets clicks through, using a clip-path hole in the click blocker, so you can try it. Missing anchors (e.g. a collapsed sidebar) fall back to a centered card. It runs on first launch (`settings.onboarded`), and Settings → System replays it and returns you where you were.
- **D70: "n" opens quick-add everywhere.** In list views "n" focuses the inline quick-add as before. Everywhere else (board, calendar, matrix, stats, focus) it opens the quick-add popup, pre-filled with the context: the current list (boards included; the task lands Unsectioned) or the calendar's selected day. Matrix and other views open it with the defaults, since nothing tracks a focused quadrant. Root cause of the old bug: the shortcut only dispatched an event that the inline `<QuickAdd>` listens for, and that is not mounted on boards or non-task views.
- **D71: Folders nest up to three levels.** Folders get a `parentId`. Folder rows show hover icons for "+ list" and "+ subfolder". Deleting a folder moves its lists and subfolders up one level into its parent. Drag a folder onto another to nest it; moves that exceed the depth or create a cycle are refused. Lists inside lists were rejected because they blur what a list is.
- **D72: Board sections reorder; Unsectioned hides when empty.** Columns drag by their header (dnd-kit), and the column menu has Move left / Move right for keyboard users. Reordering writes one `sortOrder` (fractional order). The Unsectioned column is hidden when it is empty and reappears during a task drag so it stays a drop target. It also stays while the list has no sections, so there's somewhere to type a task.
- **D73: The task drawer leads with chips.** Title, then one row of chips (priority, date/repeat, list, tags) that open popovers, then the note growing to fill the space, then subtasks and checklist. Activity is collapsed by default.
- **D74: Quadrants have fixed colours.** Q1 red, Q2 blue, Q3 violet, Q4 grey, as `--q1`..`--q4` tokens per theme, independent of the accent. Each quadrant gets a tinted background as well as the top border, and the text meets WCAG AA in both themes.
- **D75: Focus sessions have a cycle count.** A session runs a finite number of cycles or ∞ (the default, matching earlier behaviour), picked in the Focus view, which saves it as the default, and copied into the session at Start. A finite session ends after its last focus phase, with no final break: alarm, then a summary. The long-break interval is unchanged. The minute inputs keep a draft string while typing, and an empty or invalid field reverts to its default on blur.
- **D76: The window respects the taskbar.** On launch, and whenever the saved bounds don't fit, the main window is fitted to the monitor's work area and centered. Size and position persist. Maximize is verified not to cover the taskbar (frameless windows). Below about 760px of height, density switches to compact automatically.
- **D77: The dock is labelled and grouped.** Labels under icons by default (icons-only is a setting), three groups (smart lists | modules | lists, search, settings), a filled pill for the active item, styled tooltips showing the shortcut, and a "More" menu instead of horizontal scrolling. No magnification and no auto-hide.
- **D78: Notes hold image attachments.** Pasting, dropping or picking an image (PNG, JPG, GIF, WebP, up to 10 MB) copies it to `%APPDATA%\com.momentum.planner\attachments\<uuid>.<ext>` and inserts `![](attachment:<uuid>.<ext>)` into the note. Images are served via Tauri's asset protocol, scoped to that folder. Images the notes no longer reference are deleted at startup after 30 days (1 day since D100). Backups become a `.zip` (the JSON export plus the attachments); import accepts `.zip` or `.json`.
- **D79: Custom backgrounds.** Settings → Appearance offers 8 preset gradients or "Choose image…" (copied into app data, like attachments). One background serves both themes. The dim overlay follows the theme (toward black in dark, toward white in light), 40% by default, plus a blur of 0–20px (default 8). The sidebar and dock turn translucent only while a background is active.
- **D80: The mini window.** A third always-on-top window (`?window=mini`), at least 260×300, which remembers its bounds. It has three tabs: Task (the focused task, otherwise the top 5 Today tasks with checkboxes), Focus (start, pause, skip) and Matrix (counts and top 3 per quadrant, view only; clicking a task opens it in the main window). Toggled from the tray, the header or a changeable hotkey (default Ctrl+Alt+M). Like the other popups it has no SQL access and sends every action to the main window as an event (D33).
- **D81: Voice quick-add runs Parakeet on-device.** NVIDIA Parakeet TDT 0.6B v2 (English, int8 sherpa-onnx build: a 482 MB download, about 660 MB unpacked) runs in Rust. Microphone capture also happens in Rust, so the webview never needs a mic permission. The **voice model is an opt-in download** from Settings → Voice, verified with SHA-256. This is the second allowed network call, an explicit exception next to the update check (D59). Holding a changeable push-to-talk hotkey (default Ctrl+Alt+Space) opens the quick-add popup listening, and releasing it parses the text through quick-add. A mic button in quick-add does the same. A small fixed set of voice commands (start/stop focus, open today/matrix/calendar) is matched before falling back to quick-add. Without the model, the hotkey opens Settings → Voice.
- **D82: v0.6.0 is untagged.** v0.6.0 (D70–D77) gets its version bump and changelog section but no tag, so no build runs. v0.7.0 (D78–D81) is tagged and built. "What's new" shows both sections.

- **D83: Saved density always wins.** The forced compact density on windows shorter than 760px is gone; it made the Comfortable/Compact setting appear broken on laptop screens.
- **D84: A background frosts the whole window frame.** With a background on, the gaps around the content card get the same glass as the sidebar, so the raw gradient never shows as a hard border. Scrollbars are slim, have no arrow buttons and stop short of rounded corners.
- **D85: Matrix colours are a setting.** `settings.matrixColors` holds one optional swatch per quadrant (from the accent palette); unset means the theme default. Dark variants are derived in CSS. They set `--q1`…`--q4`, so every quadrant-coloured surface follows.
- **D86: Trophies are ladders.** Each trophy kind (tasks done, focus hours, habit streak, perfect days, perfect weeks) has rising levels, starting small (10 tasks, 1 focus hour, 3-day streak). Each level has its own material and badge shape; each kind has its own icon; all are SVG/CSS. Every new level celebrates; levels already earned when the ladders first load are recorded silently.
- **D87: The mini Matrix tab completes tasks.** Each top task gets the same checkbox as the Task tab and sends the existing `toggle` action.
- **D88: Unsectioned shows only when it holds tasks** (or the list has no sections), not during a drag.
- **D89: Quick-add accepts keyword phrases.** Besides `!high`, `#tag` and `~List`, the words `priority high|medium|low|none`, `tag <word>` and `list <name>` are tokens, so voice can say them. `list` prefers the longest existing list name. After a voice capture, the priority, list and tag chips are tappable to set or change them.
- **D90: Keyword tokens count only in spoken entries.** `priority high`, `tag x` and `list x` (D89) are tokens only when any of the entry's text came from voice; typed and pasted text uses only the symbol forms (`!high`, `#tag`, `~List`), so titles like "Grocery list" stay intact. An entry stays spoken after edits until it is cleared. The popup tracks this and sends it with `quickadd:create`.
- **D91: Quick-add pickers collapse into chips.** In the quick-add popup, a chosen priority or list (picked, typed or spoken) replaces its picker with a filled chip; clicking the chip reopens the picker, and "None" removes the token and brings the empty picker back. Closing the popup in any way (Esc, click away, a voice command, a cancelled recording) clears its text and pickers; opening it by hotkey starts empty; recording again while it holds text appends.
- **D92: Bulk import.** "Import tasks…" (list header menu and command palette) opens a dialog to paste text, split by new line (default) or a custom separator. Each item is read like a quick-add entry (typed rules, D90) unless "Treat each item as plain text" is ticked; bullets and numbering are stripped, blank items skipped. Tasks go to the current list or Inbox (changeable), a live preview shows the count and first items, and the whole import is one undo.
- **D93: The share card.** Statistics → Share renders a card for this week or this month: tasks done, focus hours, current streak, perfect days, a 7- or 30-day bar strip and the top trophy, in the current theme and accent with a small wordmark. Numbers and charts only, never task or list names. Save PNG (dialog + a Rust command that writes PNG bytes to the chosen path) or Copy image (webview clipboard). No network.
- **D94: Voice capture is cleaned and decoded better.** The microphone opens before the popup (no always-on mic) and keeps 0.3 s after release; silence is trimmed and quiet audio normalised (WER on quiet clips 4.1% → 2.7%); beam search and hotwords were measured and rejected: beam was never better than greedy, and Parakeet's token set can't encode hotwords (benchmark: ignored test `bench_decoding`); the microphone is selectable in Settings → Voice; common mis-transcriptions are normalised ("five p m" → "5pm"). Spoken list names are fuzzy-matched (spelling and sound-alike) to existing lists; below a threshold nothing is set and the words stay in the title.
- **D95: More voice commands.** Open inbox, today, upcoming, calendar, matrix, habits, focus, stats, settings or a list by name; start, stop, pause, resume or skip focus and start a break; open or close the mini window; "complete/done/finish/finished/mark … done/tick off <task>" fuzzy-matches open tasks (Today first) and always asks to confirm (top three when ambiguous; no match becomes a new task).
- **D96: The reminder popup is exactly its cards.** The window is transparent with no padding around the card stack, and its size follows the stack; past the height cap the list scrolls inside the card.
- **D97: Screenshots are light.** README and What's new images are taken in light mode (easier to read); one `today-dark` shot shows dark mode exists.
- **D98: What's new covers every missed update.** After an update, What's new shows every CHANGELOG section newer than the last version seen, newest first, as one walkthrough. The onboarding tour covers every feature through the current version and can be replayed from Settings and the command palette. No other hint system.
- **D99: Note images can be copied back out.** Hovering an image in a rendered note shows a Copy button that puts it on the clipboard as PNG.
- **D100: Note images are deleted with their last reference.** When a saved note drops an `attachment:` reference that no other task's note (soft-deleted ones included) still holds, the file is deleted at once. Soft-deleted tasks keep their images so Undo works; the startup sweep (D78, now 1 day old instead of 30) removes the files of tasks purged at launch. Images in notes are capped at 16rem tall and the drawer sections no longer shrink, so long notes scroll instead of overlapping.
- **D101: Subtasks are deleted from the parent's drawer.** A hover trash icon on each subtask row moves it (with its children) to the trash, with Undo.
- **D102: More motion, CSS only.** List rows animate in, popovers and menus scale in, dialogs and drawer content fade and slide; all use `--dur`/`--ease` and stop under reduced motion.
- **D103: v0.9.1 is a bug-fix release** for D96–D102.

## v0.7.0 release handoff (2026-11-04)

D78–D81 are merged on `main` and tested (241 frontend tests, 12 Rust tests). In the real app: a pasted image renders after commit 35179f4 (asset scope granted at runtime). The voice worker verified model download, resume, removal and a real transcription. Remaining, in order:
1. Real-app spot checks (dev build with a test identity: `npm run tauri dev -- --config '{"identifier":"com.momentum.v07test","build":{"devUrl":"http://localhost:1445","beforeDevCommand":"npx vite --port 1445 --strictPort"}}'` with `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9345`): background image via `importImage` + settings, zip export/import round trip (`write_backup_zip` / `read_backup_zip`), mini window (`invoke("toggle_mini")`, Task and Focus tabs), Settings → Voice shows "not installed".
2. `npm run screenshots`, commit the images.
3. CHANGELOG `## v0.7.0` (note images + zip backups, backgrounds, mini window, voice quick-add; mention the opt-in 482 MB model download), with What's new images in `public/whats-new/0.7.0/`.
4. Bump to 0.7.0: package.json, package-lock.json (first 2 occurrences), src-tauri/tauri.conf.json, src-tauri/Cargo.toml; `cargo check` refreshes Cargo.lock.
5. With the user's OK: `git push origin main`, then `git tag v0.7.0 && git push origin v0.7.0`. v0.6.0 stays untagged (D82).
6. Watch the release workflow. macOS and Linux have never built `sherpa-onnx`/`cpal` (Linux needs `libasound2-dev`, already added). Fix and re-tag if needed. The user publishes the draft.

## Online, simplification and UI redo (planning, 2026-11-06)

Grilled in rounds; ADRs in `docs/adr/`.
- **D104: Order of work.** (A) simplification + UI redo together, (B) accounts + sync, (C) list collaboration, (D) friends + leaderboards. Each ships as its own release. Mobile follows D.
- **D105: Local-first, accounts optional** (ADR 0001). Replaces the "no network" rule; online means sync between installed apps, and the web client is deferred until after mobile.
- **D106: Supabase hosted** (ADR 0002). **D107: Mobile is Tauri 2 mobile** (ADR 0003); the sync client is TypeScript.
- **D108: Pricing follows competitor research** (pending); attachment storage is capped per user from day one.
- **D109: Privacy is standard, not E2EE.** TLS, encryption at rest, a privacy policy, account deletion (removes all server data; local data stays) and data export. Leaderboards see aggregate numbers only, never task content.
- **D110: 13+ minimum,** stated at sign-up with Terms and a privacy policy. No per-region logic.
- **D111: Simplification.** Countdown becomes a calendar item and its page goes. Statistics and trophies merge into **Progress** (friends and leaderboards land there later). Matrix becomes a view mode, not a page. Logbook becomes a Completed filter. Of the layouts, Classic/Flat go and **the bar stays, placeable top or bottom**. List layouts stay. Habits, Focus, voice and the mini window stay.
- **D112: Help instead of a longer tour.** A searchable Help section in Settings (commands, shortcuts, quick-add tokens), a dismissable Getting started checklist, teaching empty states, and a tour cut to 4–5 slides. No analytics; ask the users who complained instead.
- **D113: UI redo is designed before it's coded.** A visual brief (2–3 reference apps, 3 adjectives), then mocks of Today, a list and Progress in Claude Design, approved before implementation. Background images get cut back or removed.
- **D114: Two layouts: sidebar, and a bar placed top or bottom.** Classic, Flat and Dock fold into these.
- **D115: Field-level merge, ordered by the server.** Clients push patches of changed fields; the server applies them in arrival order and assigns versions; clients pull changes since a cursor. Device clocks never order edits. Hand-rolled on Supabase (PowerSync/ElectricSQL have no Tauri SQLite client).
- **D116: Detached occurrences have deterministic ids** derived from (series id, original start), so two devices completing the same occurrence write the same row.
- **D117: Count-goal check-ins sync as summed increments.** Amount and once goals use last-writer-wins.
- **D118: First sign-in always merges.** Inboxes merge, tags merge by case-insensitive name, same-named lists/folders/habits stay separate; a backup is taken first and a summary shown after.
- **D119: Sign-out asks to keep a local copy or remove the data.** Deleting the account elsewhere triggers the same prompt on each device's next sync.
- **D120: Synced vs per-device.** All user data, per-user settings and celebrations sync. Layout, bar position, density, font size, window bounds, hotkeys, mic, voice model, notification toggle and mini window stay per device. Reminders fire on every running device; dismiss/snooze syncs. A running focus timer doesn't sync, only the finished session.
- **D121: Soft deletes everywhere synced.** Trash empties after 30 days; the server keeps tombstones 90 days; a device offline longer re-downloads fully and keeps its unsynced edits as new items.
- **D122: Import adds, Restore replaces.** Import gives backup items fresh ids. Restore replaces the account on every device, behind a typed confirmation and a server snapshot.
- **D123: Old clients stop syncing, not working.** The server records the minimum client schema; older clients prompt to update. Unknown fields are never dropped server-side.
- **D124: One account at a time per install; switching is sign out + sign in.** A kept copy remembers which account it came from; signing in to a *different* account asks "Add this data to <account>" or "Remove it", with Remove as the default, so work data never silently lands in a personal account.
- **D125: Free core plus an optional Supporter subscription** (~$4/mo, ~$30/yr: more storage, more collaborators, extra themes and trophy looks). Launch on Supabase Pro. AI features are coming, so pricing has to leave room for metered, per-use AI costs (AI can't be free and unlimited).
- **D126: Free limits.** Images 10 MB each, 200 MB total; 3 members per share free, 25 with Supporter; enforced server-side from day one; payments ship after phase D.
- **D127: Sign-in is email one-time code, Google or Apple.** No passwords. Desktop OAuth runs in the system browser and returns via a `momentum://` deep link or a loopback port.
- **D128: Identity.** A unique @handle (3–20 of `a-z0-9_`, reserved and profane words blocked, changeable every 30 days), a display name, and initials or a preset avatar. No photo uploads. Email is never shown.
- **D129: Lists and folders can be shared** (e.g. a "Momentum" folder holding UI, Backend and API lists). Habits, events and countdowns can't. Folder-sharing edge cases are being settled in round 4.
- **D130: Roles are Owner, Editor and Viewer.**
- **D131: Invites** go by @handle (must accept) or by a revocable link that expires in 7 days; they're rate-limited, and blocked users can't invite.
- **D132: Shared vs personal on shared tasks.** Shared: title, note, status, priority, schedule, recurrence, section, checklist, subtasks, attachments, assignee. Personal: reminders, tags, pinned, focus time, sidebar placement.
- **D133: Optional assignee.** Today/Upcoming show shared tasks assigned to me or unassigned.
- **D134: Credit goes to whoever completed the task** (`completed_by`).
- **D135: Moving into a share exposes the task and asks to confirm the first time; moving out removes it for everyone** (only the creator or the owner can); subtasks follow their parent.
- **D136: Leaving and removal.** A member who leaves loses the share from their devices, with no copy, and their assignments clear. An owner must transfer ownership before leaving, or the share is deleted for everyone. When an owner deletes their account, ownership goes to the longest-standing member. A deleted member's completions show as "Deleted user".
- **D137: Images count against the uploader's quota,** moving to the owner's when the uploader deletes their account.
- **D138: Activity feed and an unread dot on shares;** no push for collaborator edits until mobile.
- **D139: Lists inside a shared folder can have their own extra members** (an API dev joins only the API list). This supersedes the single-membership proposal. Access is additive: a list's members are its own direct members plus the members of every shared folder above it. Round 5 confirms the edge cases.
- **D140: Shared folders sit at the top level of each member's sidebar.** Shared lists can go in personal folders.
- **D141: Moving into or out of shared folders.** Moving a personal list in shares it, with a confirmation. Only the owner can move a list out. Personal folders can't be moved into a shared folder.
- **D142: Viewers** can't edit, complete or be assigned. They do get the personal layer (reminders, tags, pins, focus), and they count toward the member cap.
- **D143: AI is opt-in and only acts on what the user triggers.** The "nothing leaves your device" claim is retired (privacy copy changes with phase B).
- **D144: AI runs through a Supabase Edge Function** that holds the key and meters usage per account. Nothing AI-specific is built yet beyond room in the schema for usage counts.
- **D145: Friendship is mutual,** by @handle or invite link, and rate-limited. **D146: Leaderboards are friends only.**
- **D147: Weekly score** resets Monday in the viewer's timezone: +1 per task completed (≤20/day, task ≥10 min old), +1 per 5 focus minutes (≤8 h/day), +2 per habit check-in, +10 per perfect day. Lifetime totals stay on trophies.
- **D148: The server computes scores** from synced rows: completions count at server-receipt time, focus sessions can't overlap or exceed 24 h, and the caps are applied server-side.
- **D149: Friends see** handle, display name, avatar, weekly score, streak, trophy levels and perfect days, never task/list/habit names. Two switches: hide from leaderboards, hide profile stats.
- **D150: Block and report.** Block ends the friendship, cancels requests, stops invites and hides you; shared memberships are unaffected. Reports go to an admin table.
- **D151: Social notifications.** An in-app badge on Progress; native notifications only for friend requests and invites; "overtaken" is off by default.
- **D152: Local-only users** see "Sign in to add friends" on Progress; everything else is unchanged.
- **D153: Nested membership rules.** Roles add up and the highest one wins, so a folder member can't be hidden from a list inside it. List-only members see the list on its own ("in Momentum · @owner"). The folder owner owns everything inside it and alone manages membership and moves lists out. The member cap counts distinct people across the whole tree. Losing access clears that person's assignments and their personal layer. A list that already has direct members can move into a shared folder only if the same person owns both, and the confirmation names everyone who gains access (this amends D141).
- **D154: RLS is the only gate.** It's on for every table, through one `can_access(list, role)` function. The client ships only the anon key; the service key lives only in Edge Functions. A CI suite runs as owner, editor, viewer, list-only member, stranger and blocked user against a local Supabase.
- **D155: Postgres mirrors the domain rules** with constraints and triggers: field limits (title ≤500 characters, note ≤100 KB), enums, subtask depth 5, folder depth 3, immutable owner/created_by/completed_by, and no writes from viewers.
- **D156: Collaborator content is untrusted.** No raw HTML; links open in the system browser; notes render only `attachment:` images (no remote images); SVG is refused; image type is checked from the file's bytes; photo metadata is stripped before upload.
- **D157: Attachments live in a private bucket** under `share/<id>/` or `user/<id>/`, served by signed URLs that expire after 1 hour, with the same RLS function as the tables.
- **D158: Sign-in security.** Refresh tokens are kept in the OS keychain. OAuth uses PKCE. There's "Sign out everywhere" and a list of devices. The local SQLite stays unencrypted (protected by the OS account), and the privacy policy says so.
- **D159: Rate and size limits.** Invites and friend requests ≤20/day; a sync push ≤500 rows and ≤1 MB; Edge Functions are limited per account. Hitting a limit pauses sync and never drops data.
- **D160: Account deletion** signs out every device at once, then permanently deletes after a 7-day grace period; signing in during the grace period cancels it. Export reuses the zip backup.
- **D161: Server backups** are Supabase Pro's daily backups (7 days). Point-in-time recovery waits for paying users.
- **D162: Sync is proven by a simulation test.** 2–4 clients against a local Supabase do randomized offline edits, deletes, moves, membership changes and reconnects. The test asserts convergence and the permission rules. Failing seeds become fixed regression cases.
- **D163: Countdowns become calendar items.** "Until" countdowns become all-day events with a Show countdown switch; repeats become recurrence rules. "Since" countdowns become past all-day events shown as "since". Pinned ones are chips on Today. Migrated automatically and explained in What's new.
- **D164: One view-mode switch, List | Board | Matrix | Timeline,** on every task view, scoped to that view. The mini window keeps its global Matrix tab. No "All tasks" page.
- **D165: Logbook becomes a Show completed toggle** plus an `is:done` search filter.
- **D166: Progress, top to bottom:** weekly score, streaks/perfect days, trophies, charts, then friends and leaderboard (phase D). Share card sits in the header.
- **D167: Help is generated** from the command/shortcut/token registry; a test fails when a command has no help text.
- **D168: Getting started** is a dismissable card on Today whose items tick themselves when done and sync. It must also show the AI and other features (round 7 settles how).
- **D169: The tour is 4 slides** (quick-add, views/matrix, habits/focus, Progress + palette + Help). Upgraders get What's new only. Linked to D168.
- **D170: Settings sections:** Account, General, Appearance, Notifications & sounds, Voice, Data, Help, About & updates. The tag manager moves to the sidebar's tag menu.
- **D171: Background images are removed** (D79/D84 reversed); affected users are told in What's new.
- **D172: Visual brief.** References: Things 3, Linear, TickTick. Calm, precise, warm. A curated accent palette (~10, no free picker), emoji only from user content, one radius scale, one shadow level, motion only on state change, short celebrations, 44px touch targets and one narrow breakpoint.
- **D173: The redesign ships all at once.** Tokens and primitives come first, then screens one by one on a branch, released together with refreshed screenshots and What's new.
- **D174: Versions.** Phase A ships as v1.0.0, B as v1.1, C as v1.2, D as v1.3.
- **D175: Old voice commands map to the new places.** Stats → Progress, matrix → Matrix mode, countdown → Calendar, logbook → Show completed.
- **D176: One feature registry drives Help, Getting started and the tour.** Each entry has a title, a how-to line, a done-detector, the version it shipped in, and its requirements (signed in, AI on).
- **D177: Getting started has 6 core items plus a collapsible "More to try"** (voice, mini window, bulk import, .ics, Share card, Board/Timeline, habit goals, countdowns, and later sharing, friends and AI).
- **D178: Features added later appear as "New:" items** at the top of Getting started next to What's new. The tour gets at most one slide per major phase, 6 slides in all.
- **D179: Before opt-in, AI shows only as "Turn on AI features",** which explains what is sent and to whom and is the opt-in switch itself.


- **D180: Positioning.** Headline: "the planner you do with friends". Supporting line: "capture anything instantly, even offline". README, store copy, the tour and the Supporter pitch lead with these.
- **D181: Social ships before sharing** (amends D104 and D174). v1.1 is accounts and sync, v1.2 is friends and leaderboards, v1.3 is sharing.
- **D182: v1.0's Progress design already has a place for friends and the leaderboard,** shown as "Sign in to add friends" until v1.2.
- **D183: Not competing on** team project management or time-blocking calendars. Sharing stays small-group, with no workspaces, admins or per-seat billing.
- **D184: Inviting friends is effortless.** An invite link turns into a friendship at sign-up; the Share card carries the @handle and the link; new users' Getting started includes "Add a friend".


- **D185: (superseded by D192)** The app gets a new name, because the Momentum domain is too expensive. The name is still to be chosen (round 8).
- **D186: Terms and Privacy are hosted on GitHub** (Pages, from this repo) and linked from sign-up, Settings → About and the store listings.
- **D187: (superseded by D190)** The Supporter tier is paid through Stripe.


- **D188: (superseded by D192)** The rename includes the bundle identifier; testers move their data by zip export and import. Only testers use the app, so there is no migration code, no installer hook and no updater redirect. The renamed build is shared as a download link, not through the old updater. The name is picked during the build; the domain will be `get<name>.app` or `.com`.
- **D189: Invite links use GitHub Pages until the domain exists:** `<user>.github.io/<repo>/i/#<code>`, opening `<name>://`. The code stays in the fragment, so it never reaches server logs. Once the domain exists, the old page redirects to it.
- **D190: Supporter is sold through a merchant of record** (Paddle or Lemon Squeezy, ~5% + fee), which handles VAT and sales tax. Stripe was dropped because it leaves tax with us. Flow: hosted checkout in the system browser → signed webhook to a Supabase Edge Function → `profiles.supporter_until`. Managing and cancelling use the provider's customer portal. The app never sees card details and unlocks only on the server's word.
- **D191: Mobile billing.** The store's in-app billing is used where required and a link out where allowed. Every source sets the same `supporter_until`. The merchant of record doesn't change the app-store rules.


- **D192: The name stays Momentum** (supersedes D185, D188). The identifier, data folder and updater are unchanged, so there's no rename work or tester data move. The domain will be `usemomentum.<tld>`, bought later. On 2026-11-07, `usemomentum.app`, `.com` and `.io` already had active nameservers, while `.co`, `.org` and `.net` looked unregistered. Until the domain exists, invite links stay on GitHub Pages (D189), and the deep-link scheme is `momentum://`. Accepted risk: other productivity apps are called Momentum (Momentum Dash, Momentum Habit Tracker, Momentum AI), which hurts store search and could raise a trademark claim. Run a USPTO/EUIPO search before v1.2's public launch.

Planning frontier closed 2026-11-07.

### Build amendments (v1.0, 2026-11-07)

- **D193: Matrix mode is a per-view option, not a list layout** (amends D164 and the v1.0 spec §4). `lists.layout` has a `CHECK (layout IN ('list','kanban','timeline'))`, and rebuilding the `lists` table inside a migration isn't safe with foreign keys on. So every view stores `viewOptions[view].mode` (`list`, `matrix` or `timeline`). On a list, `matrix` overrides the list's own layout and `list` means "use the list's layout"; Board stays a list layout.
- **D194: What Show completed adds per view** (refines D165). Today adds tasks finished today; Upcoming, finished tasks dated after today; Inbox, lists, tags and filters, every finished task in them, in the collapsible Completed group. It's off by default on Today and Upcoming and on everywhere else, as before. Typing `done` or `wontdo`, or a saved filter with a status, ignores the toggle. Migrated countdowns keep a picked emoji as a title prefix; icon keys such as `plane` are dropped, since events have no icon.
- **D195: Tags stay in Settings → General, and the sidebar's "More" group goes** (amends the v1.0 spec §7 and §2). Tags haven't been in the sidebar since D51, so there's no tag menu to move them to. With Logbook, Matrix and Countdown gone, Calendar, Habits, Focus and Progress all fit at the top level, so the "More" group and its `sidebarMoreOpen` setting are removed. Progress's perfect-day streak replaces Statistics' "days with a completion" streak; the Share card keeps its own.
- **D196: One rule for where subtasks show** (amends D17 and D58). Every list view nests a subtask under its parent when both are in the view; when the parent isn't (a dated subtask in Today, a tagged one in its tag view), the subtask stands alone with its parent's name. Card views (Matrix, Board, Timeline's undated list) apply the same test through `topLevelIn`, folding subtasks into their parent's card. Date grids (calendar, Timeline bars) show every dated task, subtasks included, and dragging a subtask there or onto a quadrant moves the subtask itself; `rootOf` is gone. The Arrange panel and the focus picker still offer top-level tasks only (`Derived.roots`). Subtask counts on rows always count every subtask, not just the ones in the view. Subtasks and checklist items reorder in the task panel by a grip handle (pointer, or Space and arrows), in a DndContext of their own so those drags never reach the app's drop targets.
- **D197: Quick add autocompletes `#tag` and `~List`.** Typing `#` or `~` (with or without a few letters) shows matching tags or open lists as a row of pills under the input, prefix matches first. ↑/↓ pick, Tab or Enter accepts (Enter doesn't submit while suggestions are showing), Esc dismisses them until the token changes. A picked list is written without spaces, as the parser expects. It's a row, not a dropdown, because the global quick-add popup is only 170px tall. The popup gets tag names with `quickadd:focus` and now gets open lists only. Text logic is `src/domain/autocomplete.ts`; the shared hook is `useTokenSuggest` in `src/components/ui/TokenSuggest.tsx`. Off when smart parsing is off.
- **D198: v1.0 design tokens** (replaces the D74 quadrant colours, D85's dark lift and the Plus Jakarta type). The spec is `docs/design/momentum-tokens.css`, the mocks `docs/mocks/momentum.html`. `src/styles/tokens.css` now holds the token file's colours, type scale, spacing, sizes, radii and motion, mapped to utilities in `@theme inline`.
  - **Surfaces:** the old `surface-2` (elevated) is `raised`; `surface-2` is now the hover/chip/track fill that `--hover` was. A script renamed every use (`bg-surface-2` → `bg-raised`, then `bg-hover` → `bg-surface-2`), plus `--fg-muted` → `--muted`, `--p1..3` → `--prio-low/med/high` (shared as `PRIORITY_VAR`), `--q1..4` → `--q-do/schedule/delegate/drop` (`QUADRANT_VAR`), `--q-on` → `--on-strong`, `--ease` → `--ease-out`, `--row-h` → `--row`.
  - **Radii:** 8/12/18 become `rounded-control` 6, `rounded-card` 10 and `rounded-panel` 14, plus `rounded-xs` 4 (was Tailwind's bare `rounded`) and `rounded-full`. Arbitrary values such as `rounded-[6px]` are left to the visual pass.
  - **One shadow:** `shadow-float` (`--shadow`) for floating layers; the `shadow-sm` card shadows are gone.
  - **Accent:** `settings.accent` is a preset id (`indigo` default, `ocean`, `teal`, `fern`, `amber`, `coral`, `rose`, `violet`, `slate`, `graphite`) set as `html[data-accent]`, so each theme gets its hand-tuned values; nothing sets `--accent` inline any more. There never was a custom colour. `parseAccent` reads v0.9's stored preset hexes as their preset, so saved settings keep their colour without a migration; only an install that never picked one moves from Ocean to Indigo. `ACCENTS` in `src/domain/color.ts` repeats each preset's light/dark `--accent` for swatches, the app icon and quadrant colours, and `tokens.test.ts` fails if the two drift. Matrix quadrant colours (D85) store a preset id too and apply that preset's colour for the theme, which replaces the `color-mix` lift toward white. `ACCENT_PRESETS` stays as the list, habit and event colour palette (stored as hexes) until the visual pass moves those pickers to `--l-*`/`--h-*`.
  - **Type:** Inter (with `cv05`, `cv08`) for the UI; Bricolage Grotesque only through `.t-title`/`.t-display`; JetBrains Mono only for the focus and mini-window timers. Every other `font-mono` became `tabular-nums`, and the Progress stat is `t-display`. The text-size setting now centres on a 16px root (15/16/17.5/19/21px), because the tokens are rem at 16px.
  - **Focus ring:** kept as a 2px `--accent-text` outline with a 2px offset rather than the token file's box-shadow ring, so it can't collide with `shadow-float` or be clipped by `overflow`.
  - **Known token shortfalls** (values left as specified; the test checks text on `bg`, `surface` and `raised`): in light, `--success` and the teal, fern and coral `--accent-text` are 4.2–4.5:1 on `--surface-2`, and coral `--accent-text` is 4.49:1 on `--bg`.
- **D199: Momentum starts with the computer by default.** `launchAtStartup` defaults to on, so a fresh install registers the OS autostart entry on first run (the autostart plugin passes `--minimized`, so it opens to the tray). Settings → General → Launch at login turns it off. Settings saved before this change keep their stored value, so an existing install that had it off stays off.
- **D200: The phone layout (below 720px)** follows the mocks. The sidebar or bar hides and `PhoneBar` sits under the content: Today, Calendar, a round add button (`focusQuickAdd`, the same as N), Habits, and More, a menu with Inbox, Upcoming, Focus, Progress, the user's lists, Search and Settings. The mock's fifth slot is Progress; More replaces it so every destination stays reachable. Task rows become two lines (the title, then the due date and meta) at `--row-touch`, with hairlines between them. The drawer becomes a full-width sheet with its property rail under the body. Habits stacks its list over the detail. Tailwind's `text-xs/sm/base` now map to `--fs-xs/base/lg` (the same sizes on desktop), so all text steps up with the tokens; pages pad with `--gutter` (32px, 16px on phone); `--control-sm` is 36px on phone. Window controls show in the toolbar when the top bar is hidden.
- **D201: macOS and Linux builds that run (v1.0 pass).** The v0.9.1 macOS app said "Momentum is damaged and can't be opened". Lead by lead:
  - **Gatekeeper / no signing (the cause).** Evidence: the release's `Momentum_aarch64.app.tar.gz` has no `Contents/_CodeSignature` (x64 neither); its `Info.plist` has no usage strings; the arm64 Mach-O carries only the linker's code directory (flags `0x20002` = ad hoc + linker-signed, identifier `momentum-1e502d22…`, not `com.momentum.planner`, no Info.plist or resources bound) and the x64 binary has no `LC_CODE_SIGNATURE` at all; the Release run's macOS logs go from "Bundling Momentum.app" straight to the dmg with no signing step. A downloaded (quarantined) bundle whose signature doesn't seal its resources is what macOS reports as "damaged". Fix: `bundle.macOS.signingIdentity: "-"` (ad hoc) so the bundle is properly sealed; the README documents right-click → Open, Privacy & Security → Open Anyway, and `xattr -cr /Applications/Momentum.app`. Ad hoc signing doesn't remove the first-launch prompt; only notarization does. **Real signing needs** an Apple Developer Program account (99 USD/yr), a Developer ID Application certificate exported as .p12, and CI secrets `APPLE_CERTIFICATE` (base64 .p12), `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`, and for notarization either `APPLE_ID` + `APPLE_PASSWORD` (app-specific) + `APPLE_TEAM_ID` or an App Store Connect key (`APPLE_API_ISSUER`, `APPLE_API_KEY`, `APPLE_API_KEY_PATH`). `tauri-action` picks them up; then `signingIdentity` comes from the secret. Not set up.
  - **Microphone.** Confirmed gap: no `NSMicrophoneUsageDescription`, so macOS terminates the app when cpal opens the mic. Added `src-tauri/Info.plist` (Tauri merges it) and `src-tauri/Entitlements.plist` with `com.apple.security.device.audio-input`, wired through `bundle.macOS.entitlements`. No sandbox, so no other entitlements.
  - **sherpa-onnx static libs.** Ruled out as a cause: the v0.9.1 macOS (both targets) and Linux jobs compiled and linked `sherpa-onnx-sys`, and the model lives in `app_config_dir()/voice`, which is per-OS. The new CI `rust` job runs `cargo test` on macOS and Linux; actually loading the model on a Mac is untested.
  - **Windows assumptions.** Key handling already accepts `metaKey`, global shortcuts use `CommandOrControl`, autostart uses `MacosLauncher::LaunchAgent`. Fixed: shortcut labels show ⌘ ⌥ ⇧ on macOS (`src/lib/platform.ts`, `macKeys` in `domain/keys.ts`; Windows text is unchanged), the Settings data-folder text is per OS, and clicking the Dock icon while the window is hidden in the tray reopens it (`RunEvent::Reopen`). Not changed, only flagged: the window is undecorated with its own controls (no traffic lights), and the default voice hotkey ⌘⌥Space may collide with Finder search on macOS.
  - **Linux.** `WEBKIT_DISABLE_DMABUF_RENDERER=1` is set at startup (unless already set) for the blank-window bug on newer GPU stacks. The v0.9.1 `.deb` declared only `libappindicator3-1, libwebkit2gtk-4.1-0, libgtk-3-0`; cpal needs ALSA, so `libasound2` (deb) and `alsa-lib` (rpm) are added. The bundler hard-codes `libappindicator3-1`, which Ubuntu 24.04 no longer ships, so the `.deb` may not install there; the AppImage is the fallback.
  - **Updater.** Ruled out: `latest.json` lists `darwin-aarch64`, `darwin-x86_64`, `linux-x86_64` and `windows-x86_64` (plus the `-app`, `-deb`, `-rpm`, `-appimage`, `-msi`, `-nsis` variants), each with a signature, and the URLs point at assets that exist.
  - **CI.** `.github/workflows/ci.yml` gains a `rust` job on macos-latest and ubuntu-22.04: `npm ci`, `npm test`, `npm run build`, `cargo test`; on Linux it also builds the release binary and runs it under xvfb for 20 s, requiring a visible "Momentum" window and no panic in the log.
- **D202: Shell, Scale and Settings (v1.1 polish).** Zoom and Text size merge into one **Scale** setting (80–175%), applied as the webview zoom so every px and rem size scales together and the CSS breakpoints still reflow; Ctrl +/−/0 step it. `parseSettings` migrates old values as zoom × text-size factor, snapped to the nearest step. The toolbar slot takes what the page title and the window controls leave and scrolls when wider, so the controls are never pushed off; the title truncates last. The sidebar's top (logo, Search) and bottom (Settings, Collapse) are matching two-row blocks; nav icons are 1.125rem. Settings is a drill-in list of categories with a Back button (Escape, Alt+Left) and a search that jumps to and highlights a setting; `openSettingsPage(id)` deep-links. The Dialog scrim (palette and modals) gets a 6px backdrop blur, the one exception to "no blur" (D172).
- **D203: Layouts that fit small windows.** The task drawer is a single column (`clamp(340px, 36vw, 440px)`) with List, Due, Priority and Tags as wrapping chips under the title; it sits inside `main` below the toolbar, so the window controls stay reachable while it's open. The list filter is a compact field in the page head; quick add is the only full-width input. Row meta sits at the row's right edge and the subtask chevron in a fixed gutter centred on the checkbox. Below 960px the sidebar shows its icon rail regardless of the setting. The calendar: 64px hours (44 compact), the view switcher becomes a menu at 1100px and below, the range title hides below 800px, weekday labels hide when a column is too narrow, and the Arrange count is its own pill. Habits stack list over detail below 1024px; stat grids use `auto-fit`. The toolbar slot is a container (`@container/tb`), so list-view toolbar labels become icons (with tooltips) when the slot itself runs short, not at a window breakpoint.
- **D204: Focus targets a task or chosen subtasks.** The Focus page's native select becomes a picker (search, a subtask flyout on hover or →, multi-select by click, Shift+click or drag, and a keyboard path). The timer stores `subIds`; sessions are still credited to the top-level task. The mini window's Focus tab shows the real length with a −/+ stepper (5-minute steps, 5–180) and 15/25/45/60 presets; `start` carries `minutes`, which the main window saves as `pomodoro.focusMin`.
- **D205: Progress can't be farmed.** `countsForProgress` (domain/perfect.ts): a task finished less than 2 minutes after it was created doesn't count toward trophies, perfect days or the completed charts, and is ignored as if it didn't exist. Series occurrences and negative ages (imports, seed) count. Big celebrations fire 5 s after the last completion and re-check first, so a quick uncheck cancels them; the tick sound stays immediate.
- **D206: Consistent controls (design pass A).** Every `<select>` uses Chromium's customizable select (`appearance: base-select`, one rule in `components.css`): the closed control keeps its field class, and the open list is a raised menu with the accent check and a Lucide chevron, in both themes. WebKit (macOS, Linux) keeps its native list. No select component exists on purpose; the platform covers it. In the drawer, set properties are filled chips while tags and unset properties have no fill until hovered, as rows show tags as plain text. Narrow calendar chips drop their check so the title has room, and every chip has its title as a tooltip. The focus picker shows a hint instead of a disabled button until a subtask is ticked, and its flyout stays inside the window (right, left, else overlapping the picker). Arrange items follow `--row` (and the Density setting).
- **D207: Motion that also leaves (design pass, libraries).** Toasts go through Sonner (unstyled, keeping `.toast`; `toast()` in `stores/ui.ts` keeps its signature, so callers are unchanged; the toast state is gone). Exits and reflow use the browser's View Transitions API instead of a motion library: `withTransition(change, scope?)` in `lib/motion.ts` wraps a store change in `startViewTransition` + `flushSync`, and is instant under reduced motion or where the API is missing (older WebKit). The drawer slides in and out (`vt-drawer-*` names; switching tasks in an open drawer stays instant), and completing a row lets the others glide up (`html.vt-rows` names rows with `match-element` only during that transition). Motion (motion.dev) was considered and not added: the platform covers these cases. transitions.dev is a reference only; its license restricts copying recipes wholesale.
- **D208: transitions.dev recipes and a tooltip primitive.** The free transitions.dev recipes (licence: use and modify in our product, don't redistribute the collection) are adapted to our tokens, with a new `--ease-smooth` (their `cubic-bezier(.22,1,.36,1)`): menus and popovers grow from the corner nearest their anchor (scale .97, 250ms) and shrink away (.99, 150ms); dialogs and the palette scale in and out (.96); settings pages slide 8px in from the side they come from; the task checkbox draws its tick; changed counts (sidebar, "N open") slide in; collapsing sections fade their content with the height; every `.seg` gets a pill that slides to the chosen option, done in CSS with anchor positioning (`anchor-scope` per control, so the 32 segmented controls needed no JS; WebKit without it keeps the per-item background). Exits need no caller changes: `exitGhost` (lib/motion.ts) leaves an inert copy of a Popover or Dialog when it unmounts, `is-closing` animates it, and it's removed after 150ms; nothing is left under reduced motion. Tooltips for icon-only controls (window controls, the sidebar rail, the drawer's `IconButton`s, the calendar's icon buttons) use Radix Tooltip in a `<Tip>` wrapper with a provider in App.tsx (`disableHoverableContent`, so they close the moment the pointer leaves); popup windows have no provider and keep `title`. Considered and not added from the design skill's catalog: cmdk (the palette already has an action model and tested fuzzy ranking), shadcn/ui (a second visual kit over our tokens), Vaul (unmaintained per its repo), TanStack Table and React Hook Form (no tables, small forms), Motion (CSS and View Transitions cover it).
- **D209: Day mode is a column, not a slab.** Day was the Week grid with one column, so the time grid, the all-day strip and every block stretched across the whole window, and the 64px header centred a lone "Tue 10" in a page-wide cell. Considered: (a) Google/Apple style, full-width single column (what we had; long, hard-to-scan event bars); (b) a capped column (about 44rem) centred, with a compact left-aligned date header (Fantastical and Notion Calendar keep the day narrow); (c) column plus an always-on agenda panel (duplicates the side panel, which already lists unscheduled tasks). Chose (b): the `TimeGrid` with one day gets `max-w-[44rem]`, side borders, and a 48px header with the weekday label always shown. Hour height, all-day strip, now-line, scroll-to-now, drag and create are unchanged and shared with Week; the Arrange side panel remains the use of extra width. Week, 5-day, Month and Agenda are untouched.
- **D218: Progress grid and Friends placeholder.** The page grid is one column below 720px and four columns from 720px up (stat tiles 1 each; Tasks completed, Activity, Habit consistency and Friends span 2; Trophies and contributed sections span 4), replacing auto-fit tracks that the fixed spans didn't line up with. Friends is Coming soon (no sign-in button, accounts don't exist); it spans the full row when there are no habits so the last row is never half empty.
- **D212: Toast and What's new polish.** The toast is one flex row with equal 8px padding, a 44px minimum height and everything centred: the title (padded 4px) fills the row, and the action and close buttons are both 28px (`btn-sm`) so the ends balance; it is still `.layer .layer-raised`. `Dialog` takes `modal`, which turns off the click-outside close (Escape still closes); only What's new sets it, so it stays until the user presses its button or Escape.
- **D221: Mini window lists every matrix task and can start a stopwatch.** The Matrix tab was cut by `MINI_MATRIX_TOP = 3` in `buildSnapshot` (and the quadrant `ul` had no overflow); the snapshot now carries every open task per quadrant and each quadrant list scrolls inside two equal rows, with its count in the header. The Focus tab gets a Timer / Stopwatch switch; `mini:action` start carries `mode` (default pomodoro, validated), the main window starts that mode and only stores the chosen length for the timer (D33).
- **D216: Quadrant colour picker.** Matrix settings, Colours: each quadrant is its name plus one swatch (the label dot is gone); the swatch expands an inline panel with `ui/ColorPicker` (saturation/brightness area, hue slider, hex field; pointer and arrow keys, Shift = bigger steps) and the ten presets as quick picks, spaced so the selected ring never touches a neighbour. `matrixColors` entries are a preset id or a custom `#rrggbb` (`QuadrantColor`, `parseQuadrantColor` at the settings boundary; old preset ids and v0.9 hexes still map to presets). HSV/hex math is in `domain/color.ts`. Nothing is drawn as text on a quadrant colour (bars and marks only), so no foreground pick is needed; a custom hex is used as is in both themes. No new dependency.
- **D213: Show completed is one setting; view switcher tooltips.** `showCompleted` moves from the per-view `viewOptions` to a global `Settings.showCompleted` (default on; Settings > General "Completed tasks", palette "Toggle completed tasks"; voice "show completed" turns it on). Old per-view values are dropped by `parseViewOptions`, and the toolbar button is gone. The calendar keeps `calendar.showCompleted`. The List/Board/Timeline/Matrix switcher icons get `Tip` tooltips (name, short description, `G M` for Matrix) and an `aria-label`; `Tip` takes optional `desc` and `keys`.
- **D210: Navigation chrome.** The sidebar header is the 30px logo, a larger "Momentum" wordmark and the collapse toggle (an icon button with a `<Tip>` showing the `[` shortcut; on the rail it sits under the logo). Only Settings stays at the bottom. A hint in a nav row (Search's Ctrl K) is quiet text in the count column, not a keycap; the bar's Search is a plain nav item with the same hint. The bar is 56px with the destinations centred between the brand and Search/Settings. New `barStyle: "flat" | "floating"` (default flat, parsed with a safe default): floating detaches the bar from the window edges (8px margin, centred, max 1100px, `rounded-panel bg-raised shadow-float`, no blur). It stays in the layout flow, so content never sits under it, and the window controls move to the page header. The Layout picker has a fourth card for it (a floating bar is positioned at the bottom by that card; a hand-edited top position still renders).
- **D211: Scale is a slider.** `scale` is any number from 0.8 to 1.5 in 0.05 steps (`SCALE_MIN/MAX/STEP`, `clampScale` in domain/settings.ts); `parseSettings` clamps instead of snapping to presets (old out-of-range values go to the nearest end, legacy zoom x text size is clamped). Ctrl +/- step by 10%. It is applied through the same webview zoom as before (D202). The shortcut hint left the row; shortcuts live in Help. The Layout label got the other rows' spacing.
- **D214: Note image viewer, and attachments are no longer deleted on save.** A note image gets an Enlarge button next to Copy (clicking the image does the same) that opens `ImageLightbox` in a `Dialog`: zoom buttons, + / - / 0, Ctrl + wheel, drag to pan when zoomed, double-click or the fit button to reset, the percentage shown (100% is the fitted size). `Dialog` now lets only the top-most dialog handle Esc and Tab, so the viewer can sit over a centred task window. Bug: saving a note deleted every image it no longer referenced (D100), so cutting an image's Markdown from task A and pasting it into task B left B pointing at a deleted file. Root cause was deleting on save; `dropAttachments`/`droppedAttachments` are removed and only the startup sweep (1-day grace) deletes, so a moved or shared reference survives. Cost: an image removed from a note lingers until the next launch after its day is up.
- **D215: "Open tasks in" setting.** `taskOpen` (`side` default, `center`) in Settings → Appearance. `center` renders the same `DrawerBody` inside a `Dialog` (6px scrim blur, `rounded-panel`, Esc/close button). The global single-key shortcuts (j/k, priority digits, etc.) pause while a centred task is open, like any other modal; the side panel is unchanged.
- **D219: Quick add reads each token once, and says what it heard.** (a) Priority and list are single-valued and a tag only counts once (case-insensitive): the first of each wins and a repeat ("high priority, high priority", `!high !high`, `#a #A`) is blanked out of the title but gets no chip. (b) A tag chip shows the tag (`Chip.value`), not the spoken words, so "tag economics" reads as #economics; spoken forms now include "hashtag X", "tag: X" and "in list X" next to "tag X", "list X" and "high/medium/low priority". (c) The quick-add popup is 160px tall with a 64px input row at `--fs-xl` and a 20px plus icon, so the box fits input, chip row and footer without a gap.
- **D220: Natural-language tokens in every add box.** Board columns, Matrix quadrants, the calendar create popover (tasks only; events stay plain) and the drawer's subtask field parse the same grammar as the main bar and submit through `createFromText`, with the view's context as `defaults` (column list and section, quadrant priority and date, the clicked calendar slot, the parent's list). `withDefaults` (domain/quickAdd.ts) is the rule: a typed date, priority or repeat beats the context, tags merge, and a repeat with no date of its own keeps the context date instead of today. `InlineAdd` is the shared compact field with `#`/`~` autocomplete; Timeline has no add box.
- **D217: Habit kinds (build / limit / quit) and the past-year heatmap.** `HabitGoal` gains `{ kind: "limit"; cap; unit }` and `{ kind: "quit" }` beside once/count/amount, so no migration (the goal is already a validated JSON blob; legacy rows parse as build, `parseGoal`). `isDone(h, value)` now means "the day succeeded": target reached (build), value <= cap (limit), no slip (quit); unlogged days of limit/quit succeed. Streaks, best streak and completion rate go through it, with one difference: an unfinished build day is forgiven until tomorrow, but an over-limit or slipped day today breaks at once. Avoid-habits are daily or set weekdays only (`parseHabit` coerces perWeek to daily), have no reminders, don't appear as calendar markers, don't play the check-in sound or count as "kept" for an active day. Cells are habit-colour while fine and `--danger` once over. Check-in: limit opens a popover (+1, +5, typed total), quit a popover with "Log a slip" and "Undo slip". Heatmap bug: the Habits "Past year" grid was an SVG at a fixed 689px width (it scrolled sideways, and the empty cells did not paint, probably the `var()` fills in SVG attributes; unverified in the app); it is now a fluid HTML grid like the Progress heatmap, with CSS fills and no fixed width.
