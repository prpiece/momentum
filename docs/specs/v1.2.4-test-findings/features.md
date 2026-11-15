# Feature gaps (FEAT)

Scope: new work. Part of the [v1.2.4 test findings](README.md). Each entry says whether a probe test proved it or it rests on reading the code; prove it with a failing test before fixing (the v1.2.1 rule).

Direction update applied: Momentum is moving away from offline-first, so network/server features are ranked on user value alone. Each Conflicts line says where the offline-first rule would need amending. The rule lives in: CLAUDE.md "Offline first" bullet and the one-line description ("Offline, local-first desktop planner"), PLAN.md D268 (positioning, privacy promise "no account required"), D259 ($0 hosting until done), D263 (connector order), D266 (Pro limits), Settings -> About PRIVACY_PROMISE (src/features/settings/DataSection.tsx), README positioning.

Already present, so NOT proposed: saved/pinned filters (settings.savedFilters), week start and 12/24h (weekStart/timeFormat), pomodoro lengths, Trash 30 days, Someday/Waiting/Deadline/Duration, One thing, undo, habit Review, pre-migration auto backups (KEEP_BACKUPS=10 in lib.rs), manual .zip backup, Todoist/TickTick import, ICS import and read-only subscriptions, voice, bulk paste, tray and mini window, launch at startup, quick-add tokens, sync, friends/shares, bots/webhook, CLI/MCP. Gamification stays out (D256).

### FEAT-01 · high · feature · Two-way Google and Outlook calendar sync
- [ ] Status: open
- Where: new connector in Settings -> Connections, server-side OAuth + sync worker (supabase/functions), src/domain/calendar.ts mapping, calendar views.
- Evidence it's missing: only read-only .ics subscriptions exist (D281, src/domain/subscriptions.ts). D263/D266 list two-way Google as "later, Pro, needs verification"; Outlook blocked by Microsoft outage. No oauth/google code in src.
- What & why: The number-one expectation of Akiflow, Sunsama and TickTick users: time-blocked tasks appear in the real calendar on every device, and meetings land in Momentum editable. Without it the calendar is a view of read-only feeds. Server-side sync is now fair game and is the only reliable way (webhooks/push channels).
- Scope: Google first: connect account, pick calendars, pull events (read/write own events), push time-blocked tasks as events to one chosen calendar; incremental sync tokens. Leave out: attendees/invites, Meet links, multiple write targets, Outlook until Google works.
- Conflicts/risks: Amend D259 (needs verified Google app, domain), D263 ordering, CLAUDE.md "Offline first" (network call list). Privacy promise (D268) must state what tokens the server stores. Pro gating per D266. Conflict handling for recurring exceptions (exdates, D13) is the hard part.

### FEAT-02 · high · feature · Task templates (reusable checklists and task trees)
- [ ] Status: open
- Where: src/domain/templates.ts (pure), `templates` table + migration, src/stores/data.ts, taskMenu.tsx "Save as template", palette command.
- Evidence it's missing: grep "template" in src/stores and src/domain returns nothing task-related; taskMenu.tsx offers Duplicate only; no templates table in src-tauri/migrations; not in FEATURES or any spec.
- What & why: Save a task (subtasks, checklist, tags, relative dates) or whole list as a template and insert it with one command ("Packing list", "Client onboarding"). TickTick, Todoist, Things and Structured all have it; routine multi-step work is a weekly need.
- Scope: "Save as template" on a task subtree; "New from template..." palette command with fuzzy pick; dates stored as offsets from a chosen anchor. Leave out: list-level templates, gallery, variables.
- Conflicts/risks: New synced table: add to SYNC_TABLES, regenerate triggers (scripts/sync-triggers.mjs), shared.test.ts mapping, phone ships in the same release (D257). No offline-first conflict.

### FEAT-03 · high · feature · Daily planning ritual and shutdown review
- [ ] Status: open
- Where: src/features/tasks (PlanDay panel), src/domain/planDay.ts, palette command, optional notification in NotificationSection.tsx.
- Evidence it's missing: grep "shutdown|planning ritual|weekly review" hits only src/dev/seed.ts; digest notification just lists tasks; HabitReview exists for habits only.
- What & why: The core loop of Sunsama/Akiflow/Structured: a morning step (yesterday leftovers -> keep / tomorrow / someday / drop, pick today, see planned duration vs available time) and an evening step (what got done, sweep the rest). Momentum has overdue, durations, day total, snooze and day-end hour; the guided flow is missing.
- Scope: one dialog: "Plan today" with Keep/Tomorrow/Someday/Drop keys and a live "5h20 planned" line; "Shut down" with done count, focus time and a sweep. Leave out: AI suggestions, forced prompts, scoring (D256).
- Conflicts/risks: None with offline-first. Keep optional; pure logic in src/domain with tests so the phone shares it.

### FEAT-04 · high · feature · Weekly review
- [ ] Status: open
- Where: src/features/review (new), src/domain/stats.ts and filter.ts for the sections.
- Evidence it's missing: PLAN.md line 194 planned "weekly and monthly review" for habits only; no task review exists; Progress is charts only.
- What & why: GTD-style review: stale Inbox items, undated tasks older than N days, Waiting follow-ups due, Someday sweep, lists with no next action, last week completions. Data already exists (Waiting follow-up dates, Someday, Inbox).
- Scope: a page of 5 filtered sections with inline Done/Reschedule/Someday/Delete; "last reviewed" in sync_state; optional Monday nudge (off by default).
- Conflicts/risks: None. Reuse the filter language.

### FEAT-05 · high · feature · Export tasks as CSV / JSON / ICS (beyond the zip backup)
- [ ] Status: open
- Where: src/domain/exportTasks.ts (pure writer next to csv.ts parser), DataSection.tsx, list and view menus.
- Evidence it's missing: DataSection offers only "Export backup (.zip)", Restore and Import .ics; csv.ts only parses; ics.ts has no export function; no exportCsv/toIcs symbols.
- What & why: The privacy promise says "full export", but the zip is not usable elsewhere. People want a spreadsheet, a list handed to a colleague, or time-blocked tasks in another calendar app. Also a trust feature for a data-holding app.
- Scope: export a list / current view / everything to CSV (title, list, status, planned, deadline, priority, tags, duration, notes) and an .ics of dated tasks and events. Leave out: round-trip import mapping, scheduled export.
- Conflicts/risks: None; works offline. Needs the Tauri save-dialog path used by exportBackup; phone via share sheet.

### FEAT-06 · high · feature · Automatic backups: scheduled local folder and cloud copy, optionally encrypted
- [ ] Status: open
- Where: src-tauri/src/lib.rs (prune_backups, KEEP_BACKUPS), DataSection.tsx, settings.ts, optionally a Supabase storage bucket.
- Evidence it's missing: backups run only before migrations (lib.rs 93-126, hard-coded 10); manual zip otherwise; grep "encrypt" returns nothing. Sync is not a backup (deletes propagate; Trash is 30 days only).
- What & why: Users expect their planner to protect them from disk loss, bad restores and accidental bulk deletes without remembering to export. Daily snapshot to a chosen folder (cloud-synced folder works today), with rotation, plus a server-side version history for signed-in users, restorable per day.
- Scope: v1: "Back up automatically" daily to a folder with keep-N and "Back up now"; show last backup. v2: server snapshots for accounts (Pro-eligible), passphrase-encrypted zip. Leave out: per-record history.
- Conflicts/risks: Cloud copy amends D259 ($0), D268 privacy copy ("everything lives on this computer", DataSection line 73) and CLAUDE.md offline-first. Client-side encryption must happen before upload. Attachments inflate size.

### FEAT-07 · high · feature · Edit existing tasks with the natural-language tokens
- [ ] Status: open
- Where: src/features/tasks/TaskDrawer.tsx title field, TaskRow rename, src/domain/quickAdd.ts.
- Evidence it's missing: quickAdd.ts parsing is used in InlineAdd, QuickAdd, bulkImport, agentParse; no use on rename or drawer title commits.
- What & why: Todoist and Things let you retype "Call Sam tomorrow 3pm p1" over an existing title to reschedule. Today a date change needs the picker; typing is the keyboard-first identity.
- Scope: on rename commit with smartParse on and tokens present, show an "Apply: tomorrow 15:00, p1" chip (accept or keep literal). Leave out: live highlighting beyond quick add.
- Conflicts/risks: Titles legitimately containing "May" or "p1" need the confirm chip. No offline-first conflict.

### FEAT-08 · high · feature · Web app (browser access to the same account)
- [ ] Status: open
- Where: new web build of src/ on the same Supabase backend (the Vite UI already runs via npm run dev with isTauri false), src/db/client.ts driver, hosting.
- Evidence it's missing: isTauri gate in src/db/client.ts means the browser build has no persistence; there is no hosted client. Desktop (Win/mac/Linux) and Phone exist, nothing for a borrowed or locked-down computer (work PCs, Chromebooks).
- What & why: Todoist, TickTick and Sunsama all work from any browser; users hit this when they cannot install software. Shared code (src/domain, stores, sync) is already platform-neutral (the phone proves it), so a web driver (IndexedDB or sqlite wasm) plus sync is mostly plumbing.
- Scope: signed-in web client using the existing sync with a wasm SQLite or IndexedDB driver; Pages/static hosting; no popups, voice, tray, agent API. Leave out: offline web, notifications beyond web push.
- Conflicts/risks: Amend CLAUDE.md ("Offline first", Commands "npm run dev: no persistence"), D259 hosting, D268 positioning "no account required" (web requires an account), D14-style Tauri-only features gated by isTauri.

### FEAT-09 · medium · feature · Email a task in (personal inbox address and forwarding)
- [ ] Status: open
- Where: supabase/functions/inbound (already parses text with quickAdd.ts), Settings -> Connections.
- Evidence it's missing: D263 lists "email a task in" as later, blocked on D259 (no domain, no paid email); no email route in inbound.
- What & why: Forwarding an email to a personal address is a top capture path in Todoist, TickTick and Things. Subject becomes the title, body the note, attachments optional.
- Scope: one address per account via an inbound-mail provider webhook into the existing inbound function; subject parsed with quick-add tokens; sender allow-list. Leave out: threading, reply-to-complete.
- Conflicts/risks: Needs a domain and mail provider (D259, D192); spam and abuse limits (rate_counts exist); privacy copy about email bodies. Amend D268/CLAUDE.md network list.

### FEAT-10 · medium · feature · Push notifications from the server (reminders when the app is closed on all devices)
- [ ] Status: open
- Where: supabase edge function + FCM/APNs/Web Push, devices table (exists), src/domain/reminders.ts.
- Evidence it's missing: reminders are scheduled locally (D230 phone OS notifications, desktop fires only while the app/tray runs); Realtime pings only wake open apps; no push token fields were found in src.
- What & why: A reminder set on desktop should ring on the phone even if the phone app has not synced recently, and a task sent or shared by a friend should notify immediately. Local scheduling misses changes made elsewhere until the next sync.
- Scope: register push tokens per device; server sends push for reminder fires, sent tasks, share invites, nudges; client dedupes with local schedule. Leave out: marketing pushes.
- Conflicts/risks: Amend D230 (local-only scheduling) and offline-first rule; needs Apple/Google credentials (store accounts deferred). Dedupe with local alarms (D271).

### FEAT-11 · medium · feature · Time tracking reports: focus by list/tag, estimates vs actuals
- [ ] Status: open
- Where: src/domain/stats.ts, src/features/progress/, Task.durationMin, focus sessions.
- Evidence it's missing: durationMin and task-linked focus sessions exist, but stats.ts and progress components have no byList/byTag or estimate comparison (grep durationMin in stats.ts empty).
- What & why: Users who estimate and run the timer cannot see where the week went or how accurate they are. Structured/Akiflow/Sunsama show planned vs actual. Mostly a selector plus one chart.
- Scope: Progress "Time": focus hours by list and tag for a range, and a median actual/estimate on finished tasks; actual vs estimate in the drawer. Leave out: manual entries, billing.
- Conflicts/risks: Keep plain numbers (D256). Hand-written SVG chart (no chart lib, PLAN section 4).

### FEAT-12 · medium · feature · Date format and language settings (DD/MM, locale, translations)
- [ ] Status: open
- Where: src/domain/dates.ts, settings.ts (dateFormat), shared formatter, chrono locale in quickAdd.ts, i18n catalogue.
- Evidence it's missing: settings has weekStart and timeFormat but no dateFormat; grep dateFormat/DD/MM empty; no string catalogue; Intl used only in importTickTick, AccountSection and mobile screens; NL parsing is English.
- What & why: Non-US users expect 15/11 and localized names; numeric dates like "3/4" are ambiguous. Phase 1 cheap (format + parse order), phase 2 translations for the largest markets.
- Scope: dateFormat setting (OS default / DMY / MDY / ISO) used by every rendered date and by parser numeric ordering. Leave out: translated UI until a string-extraction pass.
- Conflicts/risks: Server inbound bundles quickAdd.ts (D304) so the setting must be passed for chats/webhook too. Synced setting.

### FEAT-13 · medium · feature · Recurring checklists that reset each occurrence
- [ ] Status: open
- Where: src/domain/recurrence.ts, completion path in src/stores/data.ts, ChecklistItem.
- Evidence it's missing: recurrence.ts has no checklist handling; occurrences are virtual with detached copies on completion (D13), so reset behaviour is undocumented/untested.
- What & why: "Weekly cleaning" or "Month-end close" must start unchecked each time (TickTick, Todoist). May already be correct via D13; verify first.
- Scope: add test and registry line; fix reset only if broken.
- Conflicts/risks: None; verify before building.

### FEAT-14 · medium · feature · Shared workspaces: team spaces, assignment and comments
- [ ] Status: open
- Where: existing shares (ADR 0004), supabase tables, TaskDrawer comments.
- Evidence it's missing: shares support roles, assignees and activity (D262), but grep finds no task comments/discussion; shares cap at 3 free / 25 Pro members; no workspace-level concept above lists.
- What & why: Couples, small teams and families expect comments on a shared task, @mentions, and a workspace grouping lists/members. Todoist/TickTick team plans do this.
- Scope: per-task comment thread with Realtime delivery and @mention notifications. Leave out: workspaces, permissions beyond current roles, file comments.
- Conflicts/risks: Content-safety rules (D262 carries over). Server cost under D259; no offline-first conflict as shares are already online.

### FEAT-15 · medium · feature · Accessibility pass: screen reader, high contrast, text size
- [ ] Status: open
- Where: src/styles/tokens.css, components/ui (Dialog, Menu), settings.ts (contrast), drag and drop alternatives.
- Evidence it's missing: about 300 aria usages and prefers-reduced-motion exist; no forced-colors or prefers-contrast rules in CSS; Scale is webview zoom only (D202), no text-only size; no documented NVDA/VoiceOver desktop pass; dnd-kit pointer-only drag needs keyboard equivalent audit.
- What & why: Low-vision and screen-reader users cannot adopt a planner that fails here; tokens.test.ts already enforces AA so the base is good.
- Scope: `html[data-contrast=high]` token set auto from prefers-contrast; forced-colors fallbacks for focus ring and checkbox; live-region announcements for complete/undo; audit of drag actions. Leave out: per-accent high contrast variants.
- Conflicts/risks: Accent presets are hand-tuned per theme (D198), so ship one extra theme only. Visual rules (no glow/gradient) are compatible.

### FEAT-16 · medium · feature · Import from Apple Reminders, Google Tasks, Microsoft To Do and Things
- [ ] Status: open
- Where: src/domain/importExternal.ts, new importReminders.ts (VTODO) and importGoogleTasks.ts.
- Evidence it's missing: importExternal.ts detects Todoist and TickTick only; no VTODO parsing in ics.ts; grep importThings empty.
- What & why: Switchers from the Apple and Google ecosystems are the largest pool. VTODO .ics covers Apple Reminders and Outlook tasks; Google Tasks via Takeout JSON; with online sync later, direct API import is possible.
- Scope: VTODO import in ics.ts into ImportPlan, and Google Tasks Takeout JSON. Leave out: Things (no official export) and live API migration.
- Conflicts/risks: Fixture per format; repeating rules mapping. No offline-first conflict.

### FEAT-17 · medium · feature · Archive completed tasks and Logbook retention
- [ ] Status: open
- Where: stores/data.ts, Logbook view, settings (hide completed after N days).
- Evidence it's missing: Logbook is off the sidebar (D49/D195); only lists and habits have `archived`; no retention setting, so completed tasks accumulate in every show-completed view and search.
- What & why: After years, tens of thousands of done tasks clutter and slow views. Todoist/TickTick hide completed history.
- Scope: setting "Hide completed after N days" (view filter only) and an Archive/Logbook search entry. Leave out: auto purge.
- Conflicts/risks: Progress stats must not change; sync-safe because it is a filter.

### FEAT-18 · medium · feature · Tray / menubar quick view
- [ ] Status: open
- Where: src-tauri/src/lib.rs (tray exists), mini window.
- Evidence it's missing: tray click only restores the window; no count or next task in tooltip/menubar title; mini window exists (Ctrl Alt M).
- What & why: Things/Todoist/Structured show remaining today count and next task in the menubar. Data and mini window exist; wire them up.
- Scope: tray tooltip/macOS title "3 left, next Standup 10:00"; click toggles mini window; menu with Quick add, Start focus, Open.
- Conflicts/risks: Popups have no SQL permission (D33), feed via events. Linux needs appindicator.

### FEAT-19 · medium · feature · Default reminder and default task settings
- [ ] Status: open
- Where: settings.ts, stores/data.ts addTask defaults, NotificationSection.tsx.
- Evidence it's missing: no defaultReminder/defaultDuration/defaultPriority in settings.
- What & why: People who always want "10 minutes before" or "9:00 for all-day tasks" must set it each time (Todoist, TickTick, Apple all offer this).
- Scope: default reminder for timed tasks and a default time for all-day tasks, applied on create only; tokens override.
- Conflicts/risks: Synced setting; phone schedules OS notifications from reminders, keep parity.

### FEAT-20 · medium · feature · Location-based reminders (phone)
- [ ] Status: open
- Where: mobile/src (expo-location geofencing), Reminder union in src/domain/types.ts.
- Evidence it's missing: Reminder type has time-based kinds only; grep "geofence" empty.
- What & why: Apple Reminders and Todoist Pro users use "when I arrive at the pharmacy"; a phone-native capability desktop planners lack.
- Scope: phone only, one saved place per reminder, arrive/leave; desktop shows it read-only.
- Conflicts/risks: Background location permission and store review (store accounts deferred); privacy copy (location stays on device; no server needed).

### FEAT-21 · low · feature · Dependencies polish: blocked-by chip and Blocking list
- [ ] Status: open
- Where: src/domain/waiting.ts (D284), TaskRow, TaskDrawer.
- Evidence it's missing: grep dependsOn/blockedBy empty; only Waiting {task} exists, hiding from Today until the other finishes.
- What & why: Waiting-on-task covers most cases; missing is a visible "blocked by X" chip, and a "blocking N" list on the parent.
- Scope: surface the existing link; do not add a second model.
- Conflicts/risks: D284 stores one validated JSON with loop refusal.

### FEAT-22 · low · feature · Search across habits, events and note snippets
- [ ] Status: open
- Where: src/features/shell/CommandPalette.tsx, src/domain/fuzzy.ts.
- Evidence it's missing: palette indexes task title plus description (CommandPalette.tsx:104), lists, tags and commands; not habits or events; no snippet on note hits.
- What & why: One search box should find habits and events and show where a note matched.
- Scope: habits and events as result kinds, snippet line for description hits. Leave out: full-text index tables.
- Conflicts/risks: Ranking tests; cap result count.

### FEAT-23 · low · feature · Print or PDF of a list or the day
- [ ] Status: open
- Where: src/styles (print stylesheet), list menu "Print...".
- Evidence it's missing: no window.print use and no @media print rules.
- What & why: Printing a daily plan or shopping list is a classic expectation.
- Scope: print stylesheet plus palette command for the current view.
- Conflicts/risks: Check webview print on Linux.

### FEAT-24 · low · feature · Undo history panel with change source
- [ ] Status: open
- Where: undo stack in src/stores, palette command.
- Evidence it's missing: undo is step by step; no list of recent changes; Activity per task exists.
- What & why: After bulk edits or agent/CLI/bot changes, users ask "what just changed?". Show last N changes with Undo-to-here and source label.
- Scope: in-memory list, label agent/bot sources.
- Conflicts/risks: Undo is in memory only; API changes must be labelled.

### FEAT-25 · low · feature · Attachment preview for PDFs and text
- [ ] Status: open
- Where: src/features/tasks (ImageLightbox), src/domain/attachments.ts.
- Evidence it's missing: lightbox handles images only.
- What & why: Receipts and PDFs open externally each time; inline preview via the asset protocol is cheap.
- Scope: PDF and text preview in the lightbox. Leave out: Office docs, row thumbnails.
- Conflicts/risks: Phone needs a separate viewer; size caps (D266).

### FEAT-26 · low · feature · Sample data in onboarding
- [ ] Status: open
- Where: onboarding (D54), src/dev/seed.ts.
- Evidence it's missing: seed is dev-only; onboarding creates only a real first task.
- What & why: Empty states hide Matrix/Board/Timeline value; opt-in sample data helps evaluators.
- Scope: one button to insert marked sample data plus "Remove sample data".
- Conflicts/risks: Rows sync to other devices; must not pollute stats.

### FEAT-27 · low · feature · Multi-window (pop out a list or calendar)
- [ ] Status: open
- Where: src-tauri windows, main-window-only writes (D33).
- Evidence it's missing: only popups and mini window.
- What & why: Second-monitor use of a list next to the calendar.
- Scope: read-only pop-out mirrored by events.
- Conflicts/risks: Contradicts D33 simplicity.

### FEAT-28 · low · feature · Desktop widgets
- [ ] Status: open
- Where: platform widgets; phone widgets exist (D271).
- Evidence it's missing: none on desktop; Tauri has weak support.
- What & why: Low payoff versus tray quick view; improve Android widget interactivity first.
- Scope: skip for now.
- Conflicts/risks: High effort.
