# Agent API, MCP server, CLI (AGENT)

Scope: src/lib/agentApi.ts, src/domain/agentOps.ts, src-tauri/src/agent.rs, cli/. Part of the [v1.2.4 test findings](README.md). Each entry says whether a probe test proved it or it rests on reading the code; prove it with a failing test before fixing (the v1.2.1 rule).

### AGENT-01 · medium · bug · get_task "No task with id" right after list_tasks listed it (live bug): not a code-path bug; state or instance changed, and the error hides why
- [ ] Status: open
- Where: src/lib/agentApi.ts:20-35 (view, find), :28-35; src-tauri/src/agent.rs:165-198 (forward); cli/src/main.rs:136-155 (call/launch_app)
- Proven: partly. Code path proven consistent; live state evidence collected; exact trigger not reproducible.
- What happens: `list` and `find` both read `derive(tasks, lists)` (same memo; `d.active` is a filter of `d.vms`, `d.byId` is built from the same `vms`), and the id is passed through unchanged (CLI `json!({"id":..})`, Rust forwards the body verbatim, `parseRequest` only trims). A full id returned by `list` therefore cannot miss in `byId` within one store snapshot. Nothing transforms case or key name. Only one window can answer: `emit_to("main", ..)`, and `single_instance` is registered (lib.rs:314). The live bug therefore needs the store to have changed between the two calls, or a different process to answer. Evidence on the machine:
  - Right now `list_tasks inbox`, `search "Tuesdays"` and `list_trash` all return 0. `momentum.db` (+wal/shm copied and opened) holds 6 tasks and none is `90ac…` or "Tuesdays Exams". The task was never persisted or was hard-purged (not in Trash).
  - The only app process (pid 34812, `...\Local\Momentum\momentum.exe --minimized`) was started at 19:17:44 BY the MCP server process (pid 14036, started 19:17:03, parent of the app). So the app was not running when the MCP session began and was auto-launched from the DB. A task that existed only in a previous instance's memory (or was removed by sync pull / "Delete forever" / undo / a parallel agent in the UI) would vanish exactly like this.
  - Sync (`startSync`) and UI actions replace store rows at any time; the agent API has no snapshot/version, so list-then-get is not atomic.
  - Error quality is what makes it look like a bug: `find` says "No task with id X" for ids that DO exist but are trashed, exhausted (see next finding), or removed, with no hint.
- Repro (closest in-code): add a task, `delete_task` it, `get_task` it -> "No task with id"; same message as a typo.
- Expected: when the id is a known row that is hidden, say why ("is in the Trash; restore_task brings it back", "is a repeating series with no occurrences left"); only say "No task" when nothing matches (include trashed in the prefix search).
- Suggested fix: in `find`, on miss look in `useData.getState().tasks` (all rows incl. deletedAt and exhausted series) for exact/prefix id and throw a specific message. Optionally add `instance` (pid + boot time) to every reply, so a client can see the app restarted between calls.

### AGENT-02 · high · bug · update on a recurring timed task with durationMin (or planned time change) moves the series/occurrence back to the series' first date
- [ ] Status: open
- Where: src/lib/agentApi.ts:109-117 (update, `schedule = vm.task.schedule` and `timed(new Date(schedule.start), ...)`), with src/stores/data.ts:317-338 (editOccurrence)
- Proven: yes (throwaway Vitest probe, TZ=America/New_York). Daily 09:00 task starting 2026-10-01, two occurrences completed so the current occurrence is 10-03. `update {id, durationMin:30}`:
  - scope this (default): the detached copy is dated 2026-10-01 (not 10-03); the series still has 10-03 so 10-03 is not removed from the series either (duplicate/misplaced).
  - scope following: new series starts 2026-10-01.
  - scope all: `shiftAnchor(anchor, occ=10-03, patch=10-01)` shifts the whole series 2 days back: occurrence becomes 2026-09-29.
- What happens: the code builds the new schedule from the series anchor (`vm.task.schedule`) instead of the current occurrence (`vm.schedule`), then editOccurrence treats it as "the occurrence's new schedule". Any agent that just sets a duration on a recurring time-blocked task silently reschedules it. Same root for `date` on a timed recurring task with scope this (uses anchor time-of-day, which happens to be right) but wrong base for the anchor comparison.
- Repro: recurring daily timed task, complete the first two occurrences, `update_task {id, durationMin:30}`.
- Expected: occurrence keeps its date; only the length changes.
- Suggested fix: in `update` use `vm.schedule` (the occurrence) as `current` for applyPlanned and for the `timed(new Date(start), dur)` branch when `vm.task.recurrence`; for scope all with only duration change, patch `durationMin`/end relative to anchor (`timed(new Date(anchor.start), dur)`) and do NOT pass a moved schedule. Add a test beside the existing "update on a recurring task" block.

### AGENT-03 · medium · bug · Exhausted recurring series (and tasks in the Trash) are unreachable by id: get/update/complete/delete all say "No task with id", while the row still exists
- [ ] Status: open
- Where: src/lib/agentApi.ts:28-35 (find uses d.byId, which excludes `toVM===null` series and deletedAt rows); src/domain/taskViews.ts:230-238
- Proven: yes (probe: series with COUNT=1 and its only occurrence in exdates -> get and delete both "No task with id <full id>", list empty).
- What happens: a series with no occurrences left is hidden from every view; an agent holding its id gets a misleading error; delete can't clean it; restore works only for deletedAt rows.
- Expected: clear message (see first finding) or allow delete/get on it.
- Suggested fix: same lookup-on-miss in `find`; let `remove` accept exhausted series by reading `tasks[id]` directly.

### AGENT-04 · medium · bug · delete_task on a recurring task deletes the entire series, but the response and tool text imply one task
- [ ] Status: open
- Where: src/lib/agentApi.ts:148-157 (remove -> deleteTasks([id])); cli/src/main.rs tool description "Move ONE task to the Trash"
- Proven: yes (probe: weekly series, `delete` returns the single current occurrence 2026-10-01 and the whole series goes to the Trash).
- What happens: `list_tasks` shows "Tuesdays Exams" as a single dated task; an agent deleting "this Tuesday's exam" removes every future occurrence. The agent task shape has no `repeats`/`recurrence` field, so the agent can't even tell. update has `scope`; delete has none.
- Expected: delete takes `scope: this|following|all` for recurring tasks (default `this` = exdate, like UI `deleteOccurrence`), and `AgentTask` exposes `repeats: string|null`.
- Suggested fix: add `repeats` (rrule or human label) to `agentTask`; in `remove` call `deleteOccurrence(id, key, scope)` for recurring tasks; add `scope` to parse/MCP/CLI (`--scope`). Return `deleted` with the scope applied. Note `restore` of an exdate'd occurrence needs the exdate undone; document or return a note.

### AGENT-05 · low · bug · `list` with view `__proto__` throws a TypeError; `constructor` silently matches everything (KEYWORDS is a plain object)
- [ ] Status: open
- Where: src/domain/filter.ts:35 (`KEYWORDS[m[0].toLowerCase()]`), reached via src/lib/agentApi.ts:52
- Proven: yes (probe: `list {view:"__proto__"}` -> "apply is not a function"; `constructor` -> blanked as a "keyword chip", filter becomes empty, returns all tasks). Over the API it becomes "Something went wrong inside Momentum." plus console error. Same bug exists in the UI filter bar.
- Expected: unknown words are text.
- Suggested fix: `Object.hasOwn(KEYWORDS, w)` or build KEYWORDS with `Object.create(null)` / a Map. Check other lookup tables keyed by user text (`PRIORITY_WORDS` in agentOps.ts:75 is fine because the result is type-checked, but `Object.hasOwn` is cleaner).

### AGENT-06 · medium · bug · Windows PATH edit decodes `reg query` output as UTF-8 and writes it back (non-ASCII PATH entries can be corrupted on legacy-codepage systems)
- [ ] Status: open
- Where: src-tauri/src/agent.rs:381-404 (windows_path, `String::from_utf8_lossy(&out.stdout)`)
- Proven: reasoning only. On this machine reg.exe emitted UTF-8 for `C:\José` and `C:\中文` when piped (checked with a temp key, deleted), so it works here. reg.exe encodes redirected output in the console OEM codepage on systems without the UTF-8 system locale; invalid bytes become U+FFFD and then `reg add /d` writes them back, destroying those entries. The "never shorter" guard does not catch same-length corruption.
- Expected: abort rather than write if the read contains U+FFFD.
- Suggested fix: `if current.contains('\u{FFFD}') { return Err(...) }` before writing (smallest), or read the value with winreg/`RegGetValueW` instead of reg.exe.

### AGENT-07 · medium · bug · CLI sends the bearer token to whatever listens on the port in a stale agent.json; pid in agent.json is never checked
- [ ] Status: open
- Where: src-tauri/src/agent.rs:245 (writes pid), :256-261 (stop only on clean exit); cli/src/main.rs:62-67 (endpoint), 79-98 (http_post)
- Proven: reasoning only.
- What happens: after a crash or kill, agent.json stays. If another local process later binds that port, the CLI POSTs the token (and the user's task text) to it. Also `momentum.exe` treats an unrelated server's answer as "unexpected answer" and errors instead of relaunching.
- Expected: CLI verifies the pid is alive (or does a `ping` first and requires `ok:true`) before sending real requests; token only sent after the ping succeeded is not enough, so also verify pid/process name.
- Suggested fix: in `endpoint()` check the pid exists (`OpenProcess` / `kill -0`); treat dead pid as Unreachable and delete the file.

### AGENT-08 · low · bug · `ready` is never reset: a webview reload or renderer crash makes every call hang 10 s and fail with 504 (not retried)
- [ ] Status: open
- Where: src-tauri/src/agent.rs:170 (`ready` set once in agent_ready), :188 (recv_timeout); cli/src/main.rs:86-97 (504 maps to Failed, so no retry)
- Proven: reasoning only.
- What happens: after F5/Ctrl+R or a WebView2 crash-recovery, the JS listener is gone until initOs re-runs; requests still get emitted and time out. The CLI/MCP gets "Momentum did not answer in time" immediately without retrying.
- Suggested fix: set `ready=false` on webview `PageLoad::Started`/`on_page_load` for main, and in the CLI treat 504 like 503 (retry within START_WAIT).

### AGENT-09 · low · bug · CLI relaunches (and pops up) the app on any transient connect failure; agent.json write is not atomic
- [ ] Status: open
- Where: cli/src/main.rs:112-141 (call: Unreachable -> launch_app); src-tauri/src/agent.rs:228-230 (fs::write truncate then write); lib.rs:314 (single-instance callback = show_main)
- Proven: reasoning only.
- What happens: CLI reading agent.json mid-write gets None (or a 2 s connect timeout under load) -> Unreachable -> spawns `momentum.exe --minimized`; the already-running app's single-instance handler calls `show_main`, so the window jumps to the front during an agent call.
- Suggested fix: write to a temp file and rename; require two consecutive Unreachable results (or a dead pid) before launching.

### AGENT-10 · low · bug · `--duration m` or `--duration 0` silently CLEARS the duration; `h*60` can overflow
- [ ] Status: open
- Where: cli/src/main.rs:230-241 (minutes)
- Proven: reasoning only (`"m"` -> m=0 -> `json!(0)`, server maps 0 to null; `"999999999999999999h"` overflows u64 `h*60`, wraps in release; `"15mmm"` accepted by trim_end_matches).
- Suggested fix: require a digit, reject 0 (only `none` clears), use checked_mul/checked_add.

### AGENT-11 · low · bug · CLI cannot take text starting with `--`, no `--` terminator; `--json` anywhere in text is swallowed
- [ ] Status: open
- Where: cli/src/main.rs:156-190 (parse_args)
- Proven: reasoning only. `momentum add -- --foo` -> "unknown option --". Also `list` prints 8-char ids, but `delete` needs the full id, so the human CLI flow requires `get`/`--json` first (message says so, but it is a papercut).
- Suggested fix: treat a bare `--` as "rest is positional"; print full id in `list` when `--full` or always in `get` (it already does).

### AGENT-12 · low · bug · MCP JSON-RPC gaps
- [ ] Status: open
- Where: cli/src/main.rs:278-330 (mcp_reply, serve_mcp)
- Proven: reasoning only.
- What happens: (1) a JSON array (batch, valid in protocol 2025-03-26) or a non-object JSON value yields no reply at all (`msg.get("id")?` is None) instead of -32600; (2) a client *response* (has id, no method) gets a bogus "method not found" error reply; (3) `initialize` echoes any requested protocolVersion even if unsupported; (4) the loop is single-threaded and blocking: one call stuck up to 20 s (app launch) blocks all others and `notifications/cancelled` is ignored; (5) tools have no `annotations` (readOnlyHint, destructiveHint), so clients cannot auto-approve reads or warn on delete; (6) schemas lack `additionalProperties:false` although the server refuses unknown fields.
- Suggested fix: reply -32600 for non-objects; ignore messages without `method`; add annotations to `tools()`; add `additionalProperties:false`.

### AGENT-13 · low · bug · Server robustness: unauthenticated body read, thread per connection, per-read (not total) timeout
- [ ] Status: open
- Where: src-tauri/src/agent.rs:51-97, 150-162, 247-252
- Proven: reasoning only.
- What happens: `parse_request` reads up to 1 MiB of body and 16 KiB of headers BEFORE authorization; each read has a fresh 5 s timeout, so a local client trickling bytes holds a thread indefinitely; threads are unbounded. Only same-machine processes can do it (loopback + Host + no-Origin checks are sound: Host is exact `127.0.0.1:port`/`localhost:port`, Origin refused, token compare is constant-time apart from length, 32 random bytes). `agent_reply` is invocable from any webview (popups too) and request ids are sequential (`r0`, `r1`...), so a compromised popup could forge a reply.
- Suggested fix: check `Authorization` from headers before reading the body (split parse into head + body), overall deadline, cap concurrent connections (e.g. 8), restrict `agent_reply` to the `main` webview.

### AGENT-14 · low · bug · `listen("agent:request")` has no idempotence guard; a second initAgentApi would run every write twice
- [ ] Status: open
- Where: src/lib/agentApi.ts:232-246
- Proven: reasoning only (initOs is called once in production; possible under dev HMR, which CLAUDE.md already warns creates a second store copy).
- Suggested fix: keep the unlisten handle in a module variable and call it before re-listening.

### AGENT-15 · low · bug · Inconsistent visibility: search/list hide tasks in archived lists, get/delete/update do not; list_tasks named-list view hides done and subtask context
- [ ] Status: open
- Where: src/lib/agentApi.ts:46-49, 61-69 (d.active) vs 28-35 (d.byId)
- Proven: reasoning only (derive.active filters archived lists). A task found by id can be absent from every listing; search says "open and finished" but skips archived lists.
- Suggested fix: document, or add `archived: true` to AgentTask and an `includeArchived` arg.

### AGENT-16 · low · bug · Validation gaps (accepted but questionable input)
- [ ] Status: open
- Where: src/domain/agentOps.ts:96-101, 114-142; src/lib/agentApi.ts:71-92
- Proven: yes (probe): title/description unbounded (200 000-char title accepted; 1 MiB body cap only), control chars (`\n`, `\u0000`) allowed in titles, tags accept `x#y` and zero-width chars (`é\u200b`), `add` with both `list` and `parentId` silently ignores `list` (list inherited from parent), `add` text `"#x"` creates a task titled "#x" (fallback) instead of refusing, ids are case-sensitive (uppercase UUID -> "No task"), prefix match needs 4+ chars and is only against live tasks. Rejected correctly: `__proto__` key, unknown op, non-object args, non-integer/string limits, bad/impossible dates, floats for durations, `priority: "constructor"`.
- Suggested fix: cap title (e.g. 500) and description sizes, strip control chars, lowercase id before lookup, reject `list` together with `parentId`.

### AGENT-17 · medium · feature · Recurring awareness: expose `repeats` / series info and recurrence scope on delete/complete
- [ ] Status: open
- Add `repeats` (human label), `isOccurrence`, `seriesId` to AgentTask; accept `scope` on delete and complete. Prevents the silent whole-series delete above.

### AGENT-18 · medium · feature · Lookup tools agents need: list_lists, list_tags, list_completed / `status` filter, get_trash_task
- [ ] Status: open
- `add_task`/`update_task` take list names but the agent can only discover them from an error message; `list_tasks` returns only open tasks (done tasks only via search). Add `list_lists`, `list_tags`, and `status: open|done|all` on list/search.

### AGENT-19 · low · feature · Structured add and richer update
- [ ] Status: open
- `add_task` is quick-add text only; add optional structured fields (date, time, durationMin, priority, tags, deadline) so agents do not depend on the parser. `update_task` cannot set recurrence, reminders, checklist, waiting-on, parent/section, pin, or move under a parent.

### AGENT-20 · low · feature · Habit check-in and calendar/focus tools
- [ ] Status: open
- `list_habits` is read-only; add `check_in_habit` (+ undo), `list_events` (calendar events are not exposed at all), `focus_status`.

### AGENT-21 · low · feature · Snapshot/version stamp on replies
- [ ] Status: open
- Return `{ instance, revision }` (pid + monotonic store revision) with each reply, so agents and the CLI can detect "the app restarted/changed between my list and my get" (the live bug class).
