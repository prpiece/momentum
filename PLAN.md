# Momentum — Implementation Plan

Offline, local-first desktop planner (tasks + calendar + habits + Eisenhower Matrix).
Tauri 2 + React/TS/Vite + Tailwind + Zustand + SQLite. Windows is the primary target.

Status: **Phase 2 done.** Next: Phase 3, the calendar.

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

`folders`, `lists`, `sections` (Kanban columns per list), `tasks`, `task_tags`, `tags`, `checklist_items`, `reminders`, `recurrence_exceptions`, `task_activity`, `calendar_events`, `habits`, `habit_groups`, `habit_checkins`, `countdowns`, `focus_sessions`, `settings` (one key/value JSON row).

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

- **Runtime:** `react`, `react-dom`, `zustand`, `@tauri-apps/api`, `@tauri-apps/plugin-sql`, `@dnd-kit/core`, `@dnd-kit/sortable`, `date-fns`, `rrule`, `chrono-node`, `lucide-react`, `@fontsource-variable/plus-jakarta-sans`, `@fontsource/jetbrains-mono` (tabular numerals).
- **Added in the phase that needs them:**
  - `@tanstack/react-virtual` for long lists.
  - `react-markdown` for safe Markdown rendering.
  - Tauri plugins: `notification`, `global-shortcut`, `autostart`, `dialog` and `fs` (export/import).
  - `ical.js` for .ics import, which needs correct TZID and RRULE handling.
- **Deliberately not added:**
  - Chart library: the stats charts and heatmaps are small hand-written SVGs.
  - Color library: accent variants come from CSS `color-mix(in oklch, …)`, which WebView2 supports.
  - Color picker: native `<input type="color">`.
  - Router: views are a single `ui.view` state.
  - Form library, CSS-in-JS.
- **Dev:** `vite`, `typescript`, `tailwindcss`, `vitest`, `@tauri-apps/cli`.

---

## 5. Phases (the app runs and tests pass at the end of each; one commit per phase)

1. **Foundation.**
   - Tauri + Vite scaffold and app identity.
   - Design tokens, light/dark/system themes, accent presets plus a custom accent with derived variants.
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
- **R1: Notification action buttons on Windows.** `tauri-plugin-notification` action support on desktop is limited. If Snooze and Done buttons aren't available natively, the fallback is a click that opens a small in-app reminder popup with those actions. This gets verified in Phase 6.
- **R2: Global shortcut conflict.** If Ctrl+Shift+A is already taken by another app, registration fails. The app shows a toast and lets the user rebind it in Settings.
- **R3: Unsigned builds.** SmartScreen will show a warning, and the README says so.
- **R4: Project folder is inside OneDrive.** `node_modules` and `src-tauri/target` (several GB) would sync constantly and can hit file-lock errors during Rust builds. Recommended fix: move the project to `C:\dev\momentum`.
