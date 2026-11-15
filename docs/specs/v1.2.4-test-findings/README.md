# Spec: v1.2.4 test findings

A full test pass over v1.2.3 on 2026-11-15. Thirteen agents each took one area of the app, read it end to end, and attacked it with throwaway Vitest probes (real SQLite and the shipped migrations where it mattered; Supabase mocked; no Docker). They found **244 entries: 24 high, 96 medium, 124 low**. Of these, 181 are bugs and 63 are feature gaps. Baseline before the pass: `npm test` green (62 files, 590 tests) and `tsc` clean, so none of these are caught by the current suite.

How to use this:
- Each entry has a stable ID (`SYNC-03`), a `- [ ] Status: open` line to tick, and says whether it was **proven** by a probe (with the exact input and the actual vs expected output) or rests on **reading the code only**. Treat the second kind as a lead, not a fact.
- Follow the v1.2.1 rule: every fix starts with a failing test that reproduces the bug. If the code shows a finding is wrong, record it as "not a bug" with the reason.
- The probes were deleted. Rebuild them from the "Proven" line when you start a fix.
- Each file ends with a "Verified OK" list of what was checked and held up, so it isn't re-checked.

**Direction change (2026-11-15):** Momentum is moving away from offline-first. Findings that called a network call a defect for that reason alone were re-graded (see MOB-01). The feature entries rank online features (calendar sync, web app, cloud backup) on value, and say where CLAUDE.md "Offline first", ADR 0001 and PLAN D259/D263/D266/D268 would need amending. No decision has been recorded in PLAN.md yet.

## Areas

| Area | File | High | Medium | Low | Of which features |
|---|---|---|---|---|---|
| Sync engine | [sync.md](sync.md) | 5 | 9 | 5 | 3 |
| Dates, recurrence, calendar, reminders | [time.md](time.md) | 4 | 8 | 8 | 3 |
| Stores, persistence, backup, import | [stores.md](stores.md) | 1 | 5 | 9 | 2 |
| Friends, shares, server security | [social.md](social.md) | 0 | 12 | 10 | 8 |
| Agent API, MCP, CLI | [agent.md](agent.md) | 1 | 7 | 13 | 5 |
| Rust/Tauri backend | [rust.md](rust.md) | 1 | 5 | 7 | 0 |
| Quick-add parser, filters, search | [quickadd.md](quickadd.md) | 1 | 12 | 5 | 2 |
| Habits, focus, matrix, smart lists | [habits.md](habits.md) | 1 | 8 | 16 | 5 |
| Desktop UI | [ui.md](ui.md) | 2 | 6 | 9 | 3 |
| Phone app | [mobile.md](mobile.md) | 0 | 6 | 13 | 3 |
| Design-rule compliance | [design.md](design.md) | 0 | 1 | 13 | 0 |
| Help, docs, shortcuts | [docs.md](docs.md) | 0 | 5 | 8 | 1 |
| Feature gaps | [features.md](features.md) | 8 | 12 | 8 | 28 |

## Fix first

These lose or leak data, or silently break a core promise. Sync and recurrence carry most of the risk, so give them the strongest reviewers.

1. **Data loss across devices:** SYNC-01 (Trash becomes a hard delete elsewhere), SYNC-02 (a crash mid-pull stops syncing for good while the status says "Synced"), SYNC-03 (same-name tags), SYNC-05 (upgrades never backfill new columns), DATA-01 (backup restore empties the DB and reports success).
2. **Account isolation:** SYNC-04 (sign-out during a sync uploads the old account's rows into the next account).
3. **Recurrence correctness:** TIME-01 (reminders stop after one missed occurrence), TIME-02 (an "all occurrences" edit brings back every completed one), TIME-03 (changing time zone un-completes occurrences), TIME-04 (imported events an hour off across DST), AGENT-02 (an agent duration edit moves a series to its first date).
4. **Everyday UX breakage:** QA-01 ("fri" typed after noon on a Friday means next week), UI-01 (dialogs steal focus on every keystroke), UI-02 (popover editors have no keyboard path), RUST-01 (a link in a note navigates the app window away), HAB-01 (a running focus session is lost on quit or update).

## Not reproduced

During setup, `get_task` through the live MCP server returned "No task with id" for a task that `list_tasks` had just returned (full id and prefixes). The agent-API agent found the code path consistent and couldn't reproduce it. The likely causes are the answering app instance being replaced between calls (a second `momentum.exe` was auto-launched by the MCP process) or the task changing in between. AGENT-01 covers making `find` say why (trashed, finished series, different instance).

## All entries

| ID | Severity | Kind | Title |
|---|---|---|---|
| [SYNC-01](sync.md) | high | bug | A task moved to Trash on one device is hard-deleted on the others, taking its activity and focus links with it |
| [SYNC-02](sync.md) | high | bug | If the app dies while a pull is applying, recording stays off for good and local edits stop syncing without any sign |
| [SYNC-03](sync.md) | high | bug | Same-name tags made on two devices: the losing tag id is deleted, and tasks that use it lose the tag |
| [SYNC-04](sync.md) | high | bug | "Sign out and remove data" during a sync lets the old account's rows land after the wipe, and the next account's sign-in uploads them |
| [SYNC-05](sync.md) | high | bug | A device that upgrades across a schema migration never receives the new columns and tables already synced |
| [TIME-01](time.md) | high | bug | Recurring task reminders stop firing once one occurrence is missed |
| [TIME-02](time.md) | high | bug | Editing a series "all occurrences" (time, day, or rule) resurrects every completed occurrence |
| [TIME-03](time.md) | high | bug | Time-zone change (travel, or phone in another zone via sync) un-completes timed recurring occurrences |
| [TIME-04](time.md) | high | bug | Imported/subscribed recurring events are an hour off across DST when the event's zone differs from the user's (UTC feeds always) |
| [DATA-01](stores.md) | high | bug | Backup restore can fail halfway (duplicate tag names) and still reports success |
| [AGENT-02](agent.md) | high | bug | update on a recurring timed task with durationMin (or planned time change) moves the series/occurrence back to the series' first date |
| [RUST-01](rust.md) | high | bug | Clicking an external link in a task note navigates the whole app window away |
| [QA-01](quickadd.md) | high | bug | Date-only words roll to next week/year after 12:00 noon |
| [HAB-01](habits.md) | high | bug | Running focus timer is lost on quit, crash or update restart |
| [UI-01](ui.md) | high | bug | Dialog re-runs its focus effect whenever the parent passes a new onClose, stealing focus and breaking IME |
| [UI-02](ui.md) | high | bug | Popover menus and editors have no keyboard path, and in the centred task window they are unreachable |
| [FEAT-01](features.md) | high | feature | Two-way Google and Outlook calendar sync |
| [FEAT-02](features.md) | high | feature | Task templates (reusable checklists and task trees) |
| [FEAT-03](features.md) | high | feature | Daily planning ritual and shutdown review |
| [FEAT-04](features.md) | high | feature | Weekly review |
| [FEAT-05](features.md) | high | feature | Export tasks as CSV / JSON / ICS (beyond the zip backup) |
| [FEAT-06](features.md) | high | feature | Automatic backups: scheduled local folder and cloud copy, optionally encrypted |
| [FEAT-07](features.md) | high | feature | Edit existing tasks with the natural-language tokens |
| [FEAT-08](features.md) | high | feature | Web app (browser access to the same account) |
| [SYNC-06](sync.md) | medium | bug | A copied or restored database file reuses the device id, so the server silently drops that copy's new edits and the client deletes them |
| [SYNC-07](sync.md) | medium | bug | A remote list or parent delete cascades away a local task that hasn't been pushed yet; the task survives on the server and turns up in other devices' Inbox |
| [SYNC-08](sync.md) | medium | bug | Concurrent edits to JSON columns (exdates, checklist, reminders, tags) keep only one device's change; skipped recurring occurrences come back |
| [SYNC-09](sync.md) | medium | bug | Instant sync wake-ups are ignored on accounts with only one device |
| [SYNC-10](sync.md) | medium | bug | A task whose list or parent hasn't arrived is moved to the Inbox (or loses its parent) for good |
| [SYNC-11](sync.md) | medium | bug | Offline edits overwrite newer edits from other devices because the server merges in arrival order; there's no way to see the conflict |
| [SYNC-12](sync.md) | medium | bug | CLIENT_SCHEMA is stuck at 9 although the client ships migration 0010 |
| [TIME-05](time.md) | medium | bug | RRULE UNTIL in UTC is compared as floating time: last occurrence dropped east of UTC (or extra one west) |
| [TIME-06](time.md) | medium | bug | TZID without a VTIMEZONE block is treated as the viewer's local time |
| [TIME-07](time.md) | medium | bug | "30 min before" reminder fires after the task starts on spring-forward day |
| [TIME-08](time.md) | medium | bug | Moving an occurrence of a BYDAY weekly series with "All occurrences" drops a weekday and does not move anything |
| [TIME-09](time.md) | medium | bug | "Every 2 weeks on Sun, Mon" pairs the wrong days (WKST never set from the week-start setting) |
| [TIME-10](time.md) | medium | bug | With "Day ends at" > 0, a timed task just after midnight is Upcoming while it is happening |
| [DATA-02](stores.md) | medium | bug | Renaming a tag to an existing name desyncs store from DB |
| [DATA-03](stores.md) | medium | bug | Subtask depth limit off by one in bulk text import and Todoist/TickTick import (6 levels created, limit is 5) |
| [DATA-04](stores.md) | medium | bug | Live subtask can be permanently destroyed when its trashed parent is purged (setParent accepts a trashed parent) |
| [DATA-05](stores.md) | medium | bug | updateTask/addTask accept any parentId: cycles and depth bypass possible |
| [DATA-06](stores.md) | medium | bug | removeList leaves its sections (and cross-list subtasks) in the store |
| [SOC-01](social.md) | medium | bug | Mobile deep link `momentum://invite/<code>` redeems with no preview or confirmation |
| [SOC-02](social.md) | medium | bug | Accepting a share invitation still works after the owner is unfriended or blocked |
| [SOC-04](social.md) | medium | bug | Removed or blocked members can rejoin through a still-live share link, and links cannot be revoked from either app |
| [SOC-05](social.md) | medium | bug | A friend link auto-befriends any redeemer, with no use limit |
| [SOC-06](social.md) | medium | bug | The 6-digit chat link code is guessable by many throwaway chat identities |
| [SOC-08](social.md) | medium | bug | One global advisory lock is taken by every `sync_push`, including pushes with no shared records |
| [SOC-09](social.md) | medium | bug | No server-side field validation: one editor or sender can make a shared or sent task unsyncable on other devices |
| [SOC-10](social.md) | medium | bug | Anonymous report endpoint and `reports` bucket allow unlimited spam and storage exhaustion |
| [AGENT-01](agent.md) | medium | bug | get_task "No task with id" right after list_tasks listed it (live bug): not a code-path bug; state or instance changed, and the error hides why |
| [AGENT-03](agent.md) | medium | bug | Exhausted recurring series (and tasks in the Trash) are unreachable by id: get/update/complete/delete all say "No task with id", while the row still exists |
| [AGENT-04](agent.md) | medium | bug | delete_task on a recurring task deletes the entire series, but the response and tool text imply one task |
| [AGENT-06](agent.md) | medium | bug | Windows PATH edit decodes `reg query` output as UTF-8 and writes it back (non-ASCII PATH entries can be corrupted on legacy-codepage systems) |
| [AGENT-07](agent.md) | medium | bug | CLI sends the bearer token to whatever listens on the port in a stale agent.json; pid in agent.json is never checked |
| [RUST-02](rust.md) | medium | bug | A failed pre-migration backup (or missing tray library) makes the app impossible to launch, silently |
| [RUST-03](rust.md) | medium | bug | Alt+F4 (Windows/Linux) or Cmd+W (macOS) on a popup destroys it; quick add, mini and reminders then silently stop working until restart |
| [RUST-04](rust.md) | medium | bug | Dev and sync-test runs share (and can delete) the installed app's refresh token |
| [RUST-05](rust.md) | medium | bug | Voice model download has no timeout; if the connection stalls, Cancel does nothing and the state is stuck |
| [RUST-06](rust.md) | medium | bug | A database that fails to open or migrate (or a downgrade) gives a blank window with no message |
| [QA-02](quickadd.md) | medium | bug | Bare hour 1-7 is read as AM ("at 5", "dinner at 7") |
| [QA-03](quickadd.md) | medium | bug | "9 to 5" / "tomorrow 9 to 5" create a 20-hour task spanning to next day |
| [QA-04](quickadd.md) | medium | bug | "in 90 minutes / in 2 hours / in 30 min" are eaten as a duration |
| [QA-05](quickadd.md) | medium | bug | Decimal and parenthesised durations become bogus times |
| [QA-06](quickadd.md) | medium | bug | Ordinal repeat phrases silently mis-parse |
| [QA-07](quickadd.md) | medium | bug | "every weekend", "bi-weekly", "until", counts mis-parse |
| [QA-08](quickadd.md) | medium | bug | Bare day/month words become dates even as ordinary words |
| [QA-09](quickadd.md) | medium | bug | Possessive/brackets left behind when a date is removed from the title |
| [QA-10](quickadd.md) | medium | bug | Non-Latin tags with combining marks are truncated |
| [QA-12](quickadd.md) | medium | bug | Search is not accent-insensitive nor Unicode-normalised |
| [QA-14](quickadd.md) | medium | bug | Filter: planning tokens show chips but do nothing; weekday words can't be searched |
| [HAB-02](habits.md) | medium | bug | Decimal amount/count target below 1 is silently treated as 1 |
| [HAB-03](habits.md) | medium | bug | Focus time is bucketed by calendar day, ignoring End-of-day hour |
| [HAB-04](habits.md) | medium | bug | Switching the task mid-session credits the whole session to the new task |
| [HAB-05](habits.md) | medium | bug | Stopwatch keeps counting through sleep/hibernate and inflates focus time |
| [HAB-07](habits.md) | medium | bug | Habit check-ins before the start date are impossible; no way to backfill |
| [HAB-08](habits.md) | medium | bug | Per-week / weekly-total habits: partial first week counts as a failed week |
| [HAB-09](habits.md) | medium | bug | Weekly-total / per-week habits are counted inconsistently on Today and Habits headers |
| [HAB-11](habits.md) | medium | bug | Task with future date but deadline today (or a due person follow-up) appears in both Today and Upcoming |
| [UI-03](ui.md) | medium | bug | Bulk Date actions on recurring tasks skip the scope prompt and can destroy the series |
| [UI-04](ui.md) | medium | bug | Enter or Space on a button inside a task row or board card also triggers the row/card action |
| [UI-05](ui.md) | medium | bug | Command palette: the highlighted result never scrolls into view |
| [UI-06](ui.md) | medium | bug | Escape in the centred task window may discard unsaved title, description and checklist edits |
| [MOB-01](mobile.md) | medium | bug | Uncommitted app.json adds expo-updates / EAS Update, is half-configured (duplicate runtimeVersion policies, no update signing) |
| [MOB-03](mobile.md) | medium | bug | Task sheet notes never resync, and a blur overwrites newer remote notes with stale text |
| [MOB-04](mobile.md) | medium | bug | Typed text can be lost when the form sheet is swiped away with the keyboard open |
| [MOB-05](mobile.md) | medium | bug | Habit target/amount fields reject decimal commas (locale) |
| [MOB-06](mobile.md) | medium | bug | A second `choose()`/`askText()` while one is open leaves the first promise unresolved |
| [MOB-07](mobile.md) | medium | bug | Android alarm rings indefinitely and is lost on reboot |
| [DES-01](design.md) | medium | bug | Rule 1: Hard-coded white text on accent or event fills, including where the fill is light |
| [DOC-01](docs.md) | medium | bug | Priority keys 1 and 3 are reversed in the shortcut sheet and Help |
| [DOC-02](docs.md) | medium | bug | Help sheet and Tour show the default global shortcuts even after the user rebinds them |
| [DOC-03](docs.md) | medium | bug | Shortcut recorder accepts any Ctrl/Alt/Meta combo and registers it system-wide |
| [DOC-04](docs.md) | medium | bug | CHANGELOG promises per-connection add-only mode that the app cannot set |
| [DOC-05](docs.md) | medium | bug | Privacy policy understates the network calls the app makes without an account |
| [SYNC-17](sync.md) | medium | feature | Failed applies should be retried, not skipped past by the cursor |
| [SYNC-18](sync.md) | medium | feature | Show conflicts and sync health to the user |
| [TIME-18](time.md) | medium | feature | Month-end and leap-day recurrence: "Monthly on the 31st" skips short months, "Yearly on Feb 29" only every 4 years |
| [TIME-19](time.md) | medium | feature | Custom repeat lacks end conditions and monthly-by-weekday |
| [SOC-03](social.md) | medium | feature | Block does not cut shared access, and "hides each account from the other" is not true inside shares |
| [SOC-07](social.md) | medium | feature | The apps have no control for connection permissions (add-only vs full) |
| [SOC-11](social.md) | medium | feature | No Block / Report on incoming friend requests, sent tasks or share invitations, and no unblock |
| [SOC-12](social.md) | medium | feature | No privacy control for who can send friend requests or tasks, no lookup rate limit, no cap on inbound requests |
| [AGENT-17](agent.md) | medium | feature | Recurring awareness: expose `repeats` / series info and recurrence scope on delete/complete |
| [AGENT-18](agent.md) | medium | feature | Lookup tools agents need: list_lists, list_tags, list_completed / `status` filter, get_trash_task |
| [QA-13](quickadd.md) | medium | feature | Filter has no negation / OR |
| [UI-07](ui.md) | medium | feature | Multi-select, and therefore all bulk actions, are mouse-only and not available on phone widths |
| [UI-08](ui.md) | medium | feature | Board cards can't be reordered within a column, and drops onto a column aren't undoable |
| [FEAT-09](features.md) | medium | feature | Email a task in (personal inbox address and forwarding) |
| [FEAT-10](features.md) | medium | feature | Push notifications from the server (reminders when the app is closed on all devices) |
| [FEAT-11](features.md) | medium | feature | Time tracking reports: focus by list/tag, estimates vs actuals |
| [FEAT-12](features.md) | medium | feature | Date format and language settings (DD/MM, locale, translations) |
| [FEAT-13](features.md) | medium | feature | Recurring checklists that reset each occurrence |
| [FEAT-14](features.md) | medium | feature | Shared workspaces: team spaces, assignment and comments |
| [FEAT-15](features.md) | medium | feature | Accessibility pass: screen reader, high contrast, text size |
| [FEAT-16](features.md) | medium | feature | Import from Apple Reminders, Google Tasks, Microsoft To Do and Things |
| [FEAT-17](features.md) | medium | feature | Archive completed tasks and Logbook retention |
| [FEAT-18](features.md) | medium | feature | Tray / menubar quick view |
| [FEAT-19](features.md) | medium | feature | Default reminder and default task settings |
| [FEAT-20](features.md) | medium | feature | Location-based reminders (phone) |
| [SYNC-13](sync.md) | low | bug | A remote settings pull can undo a settings change made in the last 250 ms |
| [SYNC-14](sync.md) | low | bug | The post-pull hydrate reads outside the write chain and can briefly undo an edit made during it |
| [SYNC-15](sync.md) | low | bug | Realtime DELETE events on `devices` reach every user and wake every client |
| [SYNC-16](sync.md) | low | bug | A refused non-shared patch leaves the device permanently ahead of the server |
| [TIME-11](time.md) | low | bug | After sleep/long gap, every missed digest and habit reminder fires at once |
| [TIME-12](time.md) | low | bug | One malformed RRULE in a feed makes the whole .ics import / subscription fail; isValidRule accepts rules that crash expansion |
| [TIME-13](time.md) | low | bug | EXDATE;VALUE=DATE on a timed series is ignored |
| [TIME-14](time.md) | low | bug | Monthly countdown counts to Feb 28 while the calendar has no February occurrence |
| [TIME-15](time.md) | low | bug | Short adjacent events overlap visually in the day grid |
| [TIME-16](time.md) | low | bug | Event in the repeated fall-back hour has zero height and 0 booked minutes |
| [TIME-17](time.md) | low | bug | RDATE ignored on import |
| [DATA-07](stores.md) | low | bug | removeTag skips trashed tasks, leaving dangling tag ids |
| [DATA-08](stores.md) | low | bug | duplicateTask gives copies identical sortOrder |
| [DATA-09](stores.md) | low | bug | CSV priority cell like "constructor"/"__proto__" yields a non-number priority |
| [DATA-10](stores.md) | low | bug | Todoist JSON import ignores child_order and maps the Inbox project to a second list |
| [DATA-11](stores.md) | low | bug | No rollback for failed DB writes: store actions are optimistic fire-and-forget |
| [DATA-12](stores.md) | low | bug | askScope / confirm / askSave overwrite a pending prompt, leaving the first promise unresolved |
| [DATA-13](stores.md) | low | bug | LATEST_SCHEMA in backup.ts is a hard-coded 10 |
| [SOC-13](social.md) | low | bug | `profiles` rows are fully readable by anyone with a pending request or share link, including `time_zone` |
| [SOC-14](social.md) | low | bug | The 30-day handle-change limit can be bypassed |
| [SOC-15](social.md) | low | bug | `task_activity` edits are authorised against the new `task_id`, not the old one |
| [SOC-16](social.md) | low | bug | `refreshSocial` coalescing can leave Friends stale after an action |
| [SOC-17](social.md) | low | bug | Edit guard allows edits to view-only shares until `useSocial.shares` loads |
| [SOC-18](social.md) | low | bug | Published focus status is not cleared on sign-out; stale "focusing until" persists |
| [AGENT-05](agent.md) | low | bug | `list` with view `__proto__` throws a TypeError; `constructor` silently matches everything (KEYWORDS is a plain object) |
| [AGENT-08](agent.md) | low | bug | `ready` is never reset: a webview reload or renderer crash makes every call hang 10 s and fail with 504 (not retried) |
| [AGENT-09](agent.md) | low | bug | CLI relaunches (and pops up) the app on any transient connect failure; agent.json write is not atomic |
| [AGENT-10](agent.md) | low | bug | `--duration m` or `--duration 0` silently CLEARS the duration; `h*60` can overflow |
| [AGENT-11](agent.md) | low | bug | CLI cannot take text starting with `--`, no `--` terminator; `--json` anywhere in text is swallowed |
| [AGENT-12](agent.md) | low | bug | MCP JSON-RPC gaps |
| [AGENT-13](agent.md) | low | bug | Server robustness: unauthenticated body read, thread per connection, per-read (not total) timeout |
| [AGENT-14](agent.md) | low | bug | `listen("agent:request")` has no idempotence guard; a second initAgentApi would run every write twice |
| [AGENT-15](agent.md) | low | bug | Inconsistent visibility: search/list hide tasks in archived lists, get/delete/update do not; list_tasks named-list view hides done and subtask context |
| [AGENT-16](agent.md) | low | bug | Validation gaps (accepted but questionable input) |
| [RUST-07](rust.md) | low | bug | Voice "stuck hotkey" cap only stops buffering, not the microphone |
| [RUST-08](rust.md) | low | bug | App commands are callable from every window, contradicting "popups have no data access" (D33) |
| [RUST-09](rust.md) | low | bug | File commands accept any path with an allowed extension; `import_image` accepts any source file |
| [RUST-10](rust.md) | low | bug | `fetch_ics` follows redirects and fetches any host (localhost, link-local, LAN), including plain http |
| [RUST-11](rust.md) | low | bug | Quit paths other than tray/close skip the settings flush |
| [RUST-12](rust.md) | low | bug | Backup .zip export is written in place, so a failed export destroys an earlier file of the same name |
| [RUST-13](rust.md) | low | bug | release.yml: manual dispatch from a branch, and signing key visible to build scripts |
| [QA-11](quickadd.md) | low | bug | Tag/list character set mismatch and punctuation splitting |
| [QA-15](quickadd.md) | low | bug | Filter "~Home Chores" (list name with a space) |
| [QA-16](quickadd.md) | low | bug | Title that is only tokens keeps the tokens in the title |
| [QA-17](quickadd.md) | low | bug | DST gap time silently shifts |
| [HAB-06](habits.md) | low | bug | Pomodoro phase after a late tick: session span inconsistent, break starts at wake-up |
| [HAB-10](habits.md) | low | bug | Logging a slip on a quit habit fires the "habit checked" feature event |
| [HAB-12](habits.md) | low | bug | Timed task running past midnight is flagged Overdue |
| [HAB-13](habits.md) | low | bug | Timed tasks just after midnight are "Upcoming" when End-of-day hour > 0 |
| [HAB-14](habits.md) | low | bug | Auto-start focus misses a block when the 1 s tick is throttled; stale blockEnd |
| [HAB-15](habits.md) | low | bug | Habit week/month navigators and Habits day picker ignore End-of-day hour and midnight rollover |
| [HAB-16](habits.md) | low | bug | Focus totals disagree between Progress and Focus page |
| [HAB-17](habits.md) | low | bug | `fitItems` returns -1 for an empty list with negative width |
| [HAB-18](habits.md) | low | bug | Mini window matrix counts include waiting/blocked tasks |
| [HAB-19](habits.md) | low | bug | Subtask of a waiting/someday parent still lands in Today on its own |
| [HAB-20](habits.md) | low | bug | Negative list sortOrder sorts wrongly when grouping by list |
| [UI-09](ui.md) | low | bug | Checklist item inputs are uncontrolled, so a stale value can overwrite a synced change |
| [UI-10](ui.md) | low | bug | A bulk move can detach a subtask from its parent, depending on selection order |
| [UI-11](ui.md) | low | bug | Enter submits during IME composition in quick add, inline add and the popup |
| [UI-12](ui.md) | low | bug | The Tour only handles keys when focus is inside its card, and polls layout every frame |
| [UI-13](ui.md) | low | bug | Task list ARIA structure is invalid |
| [UI-14](ui.md) | low | bug | Lists are unreachable from the sidebar in the icon rail |
| [UI-15](ui.md) | low | bug | Reminder popup: "Tomorrow 9:00" snooze minutes are computed at render and can go stale |
| [UI-16](ui.md) | low | bug | Calendar mini-month drag has no pointercancel handler |
| [MOB-02](mobile.md) | low | bug | Duplicate `android.permission.SCHEDULE_EXACT_ALARM` entry in app.json |
| [MOB-08](mobile.md) | low | bug | Notification permission prompt appears at launch, not when the user first sets a reminder |
| [MOB-09](mobile.md) | low | bug | Reschedule briefly leaves no pending notifications; the 60 cap does not count everything |
| [MOB-10](mobile.md) | low | bug | Snooze/Done pressed with the app killed take effect only at next launch |
| [MOB-11](mobile.md) | low | bug | Deep-link params are not validated (`share`, `event/new`) |
| [MOB-12](mobile.md) | low | bug | Today widget goes stale when the app is not opened |
| [MOB-13](mobile.md) | low | bug | No keyboard avoidance outside Sheet and welcome |
| [MOB-14](mobile.md) | low | bug | `fontFamily: "monospace"` is Android-only (Connections code and webhook) |
| [MOB-15](mobile.md) | low | bug | Regenerating the webhook has no confirmation |
| [MOB-16](mobile.md) | low | bug | SQLite driver's `$N` to `?N` rewrite would also rewrite `$digits` inside string literals (latent) |
| [DES-02](design.md) | low | bug | Rule 1: Hard-coded white or black in mobile settings check icon |
| [DES-03](design.md) | low | bug | Rule 1: Hard-coded `text-white` on the window close hover |
| [DES-04](design.md) | low | bug | Rule 1: Toggle knob hard-coded to `#fff` |
| [DES-05](design.md) | low | bug | Rule 1: Habit colour hex map duplicates the `h-*` tokens and adds an untokenised fallback |
| [DES-06](design.md) | low | bug | Rule 1: Picker handle uses `border-white` and a hard-coded `rgb()` shadow |
| [DES-07](design.md) | low | bug | Rule 2: Gradient (and shine highlight) in the generated app icon |
| [DES-08](design.md) | low | bug | Rule 2: Extra box-shadow rings and arbitrary shadows outside `shadow-float` |
| [DES-09](design.md) | low | bug | Rule 2: Extra shadow on phone "lifted" drag item |
| [DES-10](design.md) | low | bug | Rule 2: Blur applied to the user's background image |
| [DES-11](design.md) | low | bug | Rule 5: `font-mono` used for code samples, not only the focus timer |
| [DES-12](design.md) | low | bug | Rule 6: Arbitrary pixel radii instead of the radii scale |
| [DES-13](design.md) | low | bug | Rule 7: `outline-none` on bare text inputs with no own focus indicator |
| [DES-14](design.md) | low | bug | Rule 7: Clickable `span` without role, tabIndex or keydown |
| [DOC-06](docs.md) | low | bug | Invite page describes a paste field that does not exist and a desktop link that never opens |
| [DOC-07](docs.md) | low | bug | Windows-only wording shown to macOS and Linux users in notification settings |
| [DOC-08](docs.md) | low | bug | "Tray" wording shown on macOS where the app uses the menu bar |
| [DOC-09](docs.md) | low | bug | README release steps omit mobile/app.json, which the version check requires |
| [DOC-11](docs.md) | low | bug | docs/mocks is untracked, but CLAUDE.md names it as the design source |
| [DOC-12](docs.md) | low | bug | Uncommitted mobile/app.json lists SCHEDULE_EXACT_ALARM twice |
| [DOC-13](docs.md) | low | bug | Mixed "Color" and "Colour" in user-facing copy |
| [SYNC-19](sync.md) | low | feature | Coalesce the outbox and stop recording while signed out |
| [TIME-20](time.md) | low | feature | Missed occurrences of a daily task pile up; no "skip to today" |
| [DATA-14](stores.md) | low | feature | No data export other than the full-database zip |
| [DATA-15](stores.md) | low | feature | Undo coverage gaps for structural deletes |
| [SOC-19](social.md) | low | feature | Buddies cannot opt out, and habit names and progress are shared without the buddy's say |
| [SOC-20](social.md) | low | feature | Share invitation spam |
| [SOC-21](social.md) | low | feature | Slack OAuth callback has no `state` check or rate limit; webhook secret is in the URL path |
| [SOC-22](social.md) | low | feature | Check hosted auth settings: OTP lifetime |
| [AGENT-19](agent.md) | low | feature | Structured add and richer update |
| [AGENT-20](agent.md) | low | feature | Habit check-in and calendar/focus tools |
| [AGENT-21](agent.md) | low | feature | Snapshot/version stamp on replies |
| [QA-18](quickadd.md) | low | feature | Unsupported-but-natural phrasing |
| [HAB-21](habits.md) | low | feature | Idle/sleep detection and "forgot to stop" handling for focus |
| [HAB-22](habits.md) | low | feature | Backfill from the heatmap/month grid on desktop |
| [HAB-23](habits.md) | low | feature | Skip / vacation / pause for habits |
| [HAB-24](habits.md) | low | feature | Quit/limit habits: "days since last slip" anchor |
| [HAB-25](habits.md) | low | feature | Manual focus sessions and midnight splitting |
| [UI-17](ui.md) | low | feature | Trash has no "Empty trash" |
| [MOB-17](mobile.md) | low | feature | Phone cannot edit settings its own scheduler uses |
| [MOB-18](mobile.md) | low | feature | Missing on phone vs desktop |
| [MOB-19](mobile.md) | low | feature | Focus screen does not keep the screen awake; only one phase end is notified |
| [DOC-10](docs.md) | low | feature | Registry and README advertise 1.3.0 and 1.4.0 features with no CHANGELOG section |
| [FEAT-21](features.md) | low | feature | Dependencies polish: blocked-by chip and Blocking list |
| [FEAT-22](features.md) | low | feature | Search across habits, events and note snippets |
| [FEAT-23](features.md) | low | feature | Print or PDF of a list or the day |
| [FEAT-24](features.md) | low | feature | Undo history panel with change source |
| [FEAT-25](features.md) | low | feature | Attachment preview for PDFs and text |
| [FEAT-26](features.md) | low | feature | Sample data in onboarding |
| [FEAT-27](features.md) | low | feature | Multi-window (pop out a list or calendar) |
| [FEAT-28](features.md) | low | feature | Desktop widgets |
