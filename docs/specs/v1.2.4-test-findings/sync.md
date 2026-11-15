# Sync engine (SYNC)

Scope: src/lib/sync/, src/domain/sync.ts, sync triggers, supabase/ (sync side). Part of the [v1.2.4 test findings](README.md). Each entry says whether a probe test proved it or it rests on reading the code; prove it with a failing test before fixing (the v1.2.1 rule).

Scope: src/lib/sync/engine.ts, src/domain/sync.ts, src-tauri/migrations (0009/0010 triggers), supabase/migrations (sync_push, sync_pull, push_shared, ping), stores that sync touches.
The probes ran on real SQLite with the shipped migrations and the real `planApply`/`applyOp`/`startSync`/`signOut`, with Supabase mocked. All probe files have been deleted.

### SYNC-01 · high · bug · A task moved to Trash on one device is hard-deleted on the others, taking its activity and focus links with it
- [ ] Status: open
- Where: src/domain/sync.ts:89-92 (planApply: any `data.deleted_at != null` becomes `{kind:"delete"}`), src/lib/sync/engine.ts:156-158 (applyOp delete)
- Proven: yes. Probe: device B has task t1 plus an activity row and a focus session for it. The pull brings `tasks/t1` with all its fields and `deleted_at` set (A trashed it). planApply returns `delete` instead of an upsert. After the apply, t1 is gone from B's DB (so not in B's Trash), its activity is cascade-deleted, `focus_sessions.task_id` is SET NULL, and B's outbox stays empty. A then restores the task: t1 comes back on B, but its activity does not (count 0), because the server never re-sends those rows.
- What happens: tasks use `deleted_at` for the 30-day Trash (D121 "Soft deletes everywhere synced", D287), but the pull planner treats every non-null `deleted_at` as a hard tombstone. Other devices never show the trashed task in Trash, so it can't be restored from them (including through the agent `restore_task`/`list_trash` tools on that device). The local FK cascade runs with recording off, so it destroys the task's history (task_activity) and focus-session links on every other device for good. A restore on the origin device brings back the bare task only. The same applies to soft-deleted calendar_events.
- Repro: two devices on one account. Trash a task that has activity on A, sync B, open Trash on B (it's empty). Restore on A and sync B: the task's history on B is empty.
- Expected: B upserts the row with `deleted_at` set, so the task shows in B's Trash with its activity. Only a real tombstone (a hard delete, whose record is `{deleted_at}` alone) should DELETE.
- Suggested fix: for tables that have a local `deleted_at` column (tasks, calendar_events, calendar_subscriptions), upsert the remote row, `deleted_at` included, instead of deleting it. To tell a purge apart, have the hard-delete trigger send a marker (e.g. `_purged: true`) or check that the data holds only the tombstone keys. Keep `goneTasks` for the activity filter.

### SYNC-02 · high · bug · If the app dies while a pull is applying, recording stays off for good and local edits stop syncing without any sign
- [ ] Status: open
- Where: src/lib/sync/engine.ts:226-238 (pull sets `record='0'`, restores it in `finally`), src/lib/sync/engine.ts:362-390 (startSync never resets `record`), src/db/client.ts:62-66 (`transact` is only write-chain serialization, not a SQL transaction)
- Proven: yes. Probe: `account='A'` and `record='0'` in sync_state (the state a process kill leaves between line 226 and line 237), then `startSync()`. Sync resumes (`useSync.account === 'A'`), but inserting a task adds 0 rows to the outbox and `record` stays `'0'`.
- What happens: pull writes `record='0'` as an autocommitted statement, then applies hundreds or thousands of ops over IPC. If the window or app is closed, the app crashes, or (most likely) the OS kills the phone app in the background during that window, `record` stays `'0'`. On the next launch nothing sets it back to `'1'` (only enableSync does, at sign-in). From then on every local change on that device is silently left out of the outbox. Pulls keep working and the status keeps saying "Synced", so the user only notices when edits never show up on other devices. A fresh first sign-in, whose first pull covers the whole account, has the longest window. The apply is also not atomic, so a kill can leave a half-applied batch (deletes done, upserts not) until the next sync.
- Repro: sign in on a large account and kill the app while "Syncing…" shows on the first pull. Relaunch and edit a task. The `sync_outbox` stays empty.
- Expected: recording turns back on at startup while signed in. Better, pulls never persist a "recording off" state.
- Suggested fix: smallest is `setLocalState("record", "1")` in startSync when `account` is set. Root cause: replace the persisted flag with a connection-scoped one (e.g. a TEMP table or `PRAGMA`-free temp `sync_apply` row that triggers check with `NOT EXISTS`). Wrap the apply in BEGIN/COMMIT on one connection, which needs a single-connection driver or a Rust-side apply command.

### SYNC-03 · high · bug · Same-name tags made on two devices: the losing tag id is deleted, and tasks that use it lose the tag
- [ ] Status: open
- Where: src/lib/sync/engine.ts:181-195 (applyOp UNIQUE handler), src/domain/sync.ts:157 (tagWinner)
- Proven: yes. Probe: the local tag `b2` "work" is used by task t2 (`tags='["b2"]'`). The pull brings remote tag `a1` "work". Afterwards only `a1` exists, t2 still holds `["b2"]` (dangling), and the outbox holds only the `tags/b2` tombstone. No task is remapped.
- What happens: tasks store tag ids (`filter.ts:73`, `taskViews.ts:148` look names up by id). The winner logic keeps one tag row but never rewrites `tasks.tags` from the loser id to the winner id, on either device. Every task tagged with the losing id quietly loses that tag on all devices. The usual way in is a common path: someone uses the app offline on two devices (both get "work", "home", …), then signs in on both. The second device's fresh sign-in pull hits UNIQUE for every shared tag name.
- Repro: device A makes tag "work" and tags task X. Device B makes tag "work" and tags task Y. Sync both. One of X or Y no longer shows "work".
- Expected: tasks that used the loser id end up with the winner id, and the tag names stay intact everywhere.
- Suggested fix: in the UNIQUE branch, while recording is on for that statement (or with explicit outbox rows), run `UPDATE tasks SET tags = replace(tags, '"<loser>"', '"<winner>"') WHERE tags LIKE '%"<loser>"%'` so each remapped task pushes a `tags` patch. Or make the tag id deterministic from the lower-cased name, so the collision can't happen at all.

### SYNC-04 · high · bug · "Sign out and remove data" during a sync lets the old account's rows land after the wipe, and the next account's sign-in uploads them
- [ ] Status: open
- Where: src/lib/sync/engine.ts:468-494 (signOut/wipeLocal don't stop or fence an in-flight run), :203-250 (pull applies without re-checking the account), :301-318 (runOnce checks `account` only at the start)
- Proven: yes. Probe: signed in as A, `syncNow()` is held inside `sync_pull`. `signOut("remove")` runs and the wipe completes (list "secret" absent). Then the pull resolves with A's list "secret". Afterwards the list exists locally, `cursor='7'`, `record='1'` (the pull's `finally` turns recording back on while signed out), and `signInSituation("B")` returns `"fresh"`, so B's enableSync will `queueLocalRows` and push A's list into B's account.
- What happens: signOut only clears the scheduler. The running `syncNow` carries on: its pull transact queues on the write chain behind wipeLocal and re-inserts the old account's data into the "wiped" DB. It also restores the cursor and sets record=1, so the device keeps recording into the outbox while signed out. The next sign-in as a different account counts as "fresh" (account and former_account are gone), so every leaked row is queued as that account's data. This is a cross-account data leak (e.g. on a shared computer), and "remove my data" didn't remove it.
- Repro: start a sync on a large account (or a slow network), immediately choose Sign out → remove data, then sign in as another user.
- Expected: once sign-out starts, nothing from the old session writes locally, and the wipe is final.
- Suggested fix: keep a session epoch/account token. signOut bumps it and awaits `running`. pull checks before its transact that the token is unchanged and `state('account')` still matches, and drops the batch if not. Don't set `record='1'` in `finally` unless an account is still set.

### SYNC-05 · high · bug · A device that upgrades across a schema migration never receives the new columns and tables already synced
- [ ] Status: open
- Where: src/domain/sync.ts:93-95 (planApply keeps only known local columns), src/lib/sync/engine.ts:117 (parseRemote skips unknown tables), :239 (cursor still advances), src-tauri/migrations/0010_planning_subscriptions.sql (no cursor reset)
- Proven: yes for the drop: on a schema-9 DB, planApply's upsert for a task with `deadline` and `someday` has no `deadline` key, and parseRemote `continue`s past `calendar_subscriptions`. The "never re-pulled" part is reasoning: nothing resets `cursor` on a migration (grep: only the issue heuristics in startSync do).
- What happens: a v1.1.x device pulls tasks that a v1.2 device has given deadline/duration/someday/waiting, plus calendar_subscriptions rows. It drops the unknown fields and tables but advances its cursor past them. After it upgrades to v1.2 (migration 0010 adds the columns), those values never arrive: deadlines, Someday flags, waiting-for and subscribed calendars stay missing on that device until each record happens to be edited again elsewhere. syncRoundtrip.test.ts covers "older app doesn't drop fields it pushes" but not "upgraded app recovers fields it skipped". The same will happen with every future column or table.
- Repro: phone on v1.1.3 and desktop on v1.2.x, both signed in. Set a deadline on desktop and let the phone sync. Upgrade the phone: the task has no deadline.
- Expected: after a local migration that adds synced columns or tables, the device recovers them.
- Suggested fix: store the local schema version the cursor was built with (`sync_state.cursor_schema`). In startSync, if it is below the current migration, reset `cursor` to 0 once (pending local fields still win in planApply). The local migration could also simply `DELETE FROM sync_state WHERE key='cursor'`.

### SYNC-06 · medium · bug · A copied or restored database file reuses the device id, so the server silently drops that copy's new edits and the client deletes them
- [ ] Status: open
- Where: supabase/migrations/20261114020000_shares.sql:667-670 (`continue when seq <= last`), src/lib/sync/engine.ts:100 (`DELETE FROM sync_outbox WHERE seq <= res.last_seq`), :51-57 (device_id lives inside the DB)
- Proven: reasoning only (SQL read).
- What happens: the push watermark is `devices.last_seq` per device_id, and both the device id and the AUTOINCREMENT sequence live inside momentum.db. If the user copies their app-data folder to a new PC (or restores a `backups\` pre-migration copy, which CLAUDE.md documents as the recovery path), the copy has the same device_id and an older `sqlite_sequence`. The server skips every patch whose seq is ≤ last_seq, as if it were a retry, and returns that last_seq. The client then deletes its whole outbox up to it. Edits are lost without any issue being reported. Two live copies (old and new PC) keep stepping on each other.
- Repro: copy `%APPDATA%\com.momentum.planner` to a second machine, keep using the first, then edit on the second. The edits never reach the server.
- Expected: a copy or restore gets a new device identity, or the server notices seq going backwards.
- Suggested fix: server: when the first seq in a batch is ≤ last_seq and no earlier batch was acknowledged, answer `{"error":"seq_regressed"}`. Client: regenerate `device_id` and push again (the patches are field merges, so replaying them is safe apart from `_delta`). Or bind device_id to something outside the DB file (the OS keychain via secrets.rs).

### SYNC-07 · medium · bug · A remote list or parent delete cascades away a local task that hasn't been pushed yet; the task survives on the server and turns up in other devices' Inbox
- [ ] Status: open
- Where: src/lib/sync/engine.ts:156-158 (DELETE runs with record=0 and FK cascades), src/domain/sync.ts:89-91, :98 (deletes are applied before upserts)
- Proven: yes. Probe: B creates task "new" (plus activity) in list L while offline, so the outbox holds the `tasks/new` and `task_activity/a9` creates. The pull brings the tombstone for L. After the apply, "new" is gone locally, and the outbox still holds both creates with no tombstone. (A second probe confirmed that on the origin device a list delete does record the cascaded task tombstones.)
- What happens: the cascade on B is unrecorded, so B's next push uploads the task alive into a deleted list. Every other device puts it in the Inbox (resolveTaskRefs), while B itself no longer has it. The devices diverge permanently, and the user who created the task can't see it on the device where they made it. Subtasks under a remotely deleted parent behave the same way (`parent_id ON DELETE CASCADE`).
- Repro: on B (offline) add a task to list L. On A delete L. Bring B online.
- Expected: one outcome everywhere: either the delete wins (B tombstones the task too) or the task is kept (moved to the Inbox on every device, B included).
- Suggested fix: in applyOp's delete branch, for lists and tasks, first look for local children with pending creates in the outbox. Either move them to Inbox / null their parent with recording on, or drop their outbox rows and push tombstones, so B ends up in the same state as everyone else.

### SYNC-08 · medium · bug · Concurrent edits to JSON columns (exdates, checklist, reminders, tags) keep only one device's change; skipped recurring occurrences come back
- [ ] Status: open
- Where: server merge `r.data || excluded.data` (supabase/migrations/20261114020000_shares.sql:691, push_shared:212), triggers send whole JSON strings (src-tauri/migrations/0010_planning_subscriptions.sql sync_upd_tasks)
- Proven: yes. Probe: two devices with the same daily recurring task. A sets `exdates=["2026-11-03"]` and B sets `exdates=["2026-11-05"]`, using the real triggers. Merging both outboxes per field leaves `["2026-11-05"]`, so A's skip is lost.
- What happens: field-level LWW treats each JSON column as one value. A skipped or deleted occurrence on one device reappears when another device edits exdates for a different date. If the skip came with a detached copy (D13), the series now shows the virtual occurrence and the detached copy, a duplicate. The same goes for checklist items (one device ticks, another adds, and one is lost), reminders and tags.
- Repro: as in the probe, with both devices offline and then synced.
- Expected: set-like JSON columns merge, so both exdates survive.
- Suggested fix: for `exdates` (and `tags`) send set ops, e.g. `_add_exdates`/`_del_exdates` deltas merged server-side like `_delta`, or merge as a set union in sync_push for those keys. Checklists need per-item ids with per-item LWW.

### SYNC-09 · medium · bug · Instant sync wake-ups are ignored on accounts with only one device
- [ ] Status: open
- Where: src/lib/sync/engine.ts:347-350 (`if (row?.id !== device) void syncNow()`), supabase/migrations/20261114020000_shares.sql:395-399 (`ping`), 20261114030000_social.sql:7-10 (`ping_all`)
- Proven: reasoning only.
- What happens: server-side wake-ups (a share member's push into your list, bot/webhook `server_write`, sent tasks) bump `last_seen` on every devices row of the target account. The client ignores the event for its own row, which is right for the echo of its own push but also drops these pings. With two or more devices, a sibling row's event wakes each device. A user with a single device gets no instant update and waits for the 5-minute poll, even though "Friend requests and share changes arrive instantly" (68a4802) is the stated behavior.
- Repro: one account on one desktop shares a list with a friend. The friend adds a task. Nothing appears on the desktop for up to 5 minutes.
- Expected: pings wake every device, the only one included.
- Suggested fix: have `ping`/`ping_all` write a separate column (e.g. `pinged_at`), and have the client sync on any event for its own row whose `pinged_at` changed. Or route these pings through a per-account table like `social_pings`.

### SYNC-10 · medium · bug · A task whose list or parent hasn't arrived is moved to the Inbox (or loses its parent) for good
- [ ] Status: open
- Where: src/lib/sync/engine.ts:141-151 (resolveTaskRefs)
- Proven: reasoning only (the behavior is covered by engine.test.ts "puts a new task whose list never arrived in the Inbox", but the follow-up is not).
- What happens: the rewrite to `list_id='inbox'` / `parent_id=null` / `section_id=null` happens with recording off, so the server still says list L. If L or the parent arrives later (re-sent after a refusal, share access granted later, a list create pushed after a fix), the task isn't pulled again and stays in the Inbox or top level on this device only. Nothing tells the user it diverged.
- Repro: a task record names list L before L reaches this device. L arrives in a later pull. The task stays in the Inbox here and is in L everywhere else.
- Expected: once the reference shows up, the task moves to it.
- Suggested fix: record the substitution (a `sync_state` set of task ids "awaiting list/parent X"). After each apply, re-apply the stored server values for ids whose target now exists, or reset the cursor for them.

### SYNC-11 · medium · bug · Offline edits overwrite newer edits from other devices because the server merges in arrival order; there's no way to see the conflict
- [ ] Status: open
- Where: supabase/migrations/20261114020000_shares.sql:686-691 (merge by arrival), push_shared:210-212
- Proven: reasoning only (by design per the sync_push header comment, but it loses updates).
- What happens: a device that was offline for a day pushes its stale field values on reconnect and wins over anything edited elsewhere in the meantime, `updated_at` included (which goes backwards). "Edited title on phone at 11:00, laptop's 09:00 offline edit replaced it at 12:00" happens, and the user sees nothing about it.
- Repro: A offline: rename task to "X". B online, later: rename to "Y". A reconnects: "X" everywhere.
- Expected: either the newer edit wins (per-field HLC/timestamp), or the overwrite shows up as a conflict.
- Suggested fix: send a per-patch client timestamp (the outbox already has `created_at`) and keep `_ts` per field server-side. Skip a field whose stored `_ts` is newer, capping skew by clamping client time to server `now()`.

### SYNC-12 · medium · bug · CLIENT_SCHEMA is stuck at 9 although the client ships migration 0010
- [ ] Status: open
- Where: src/lib/sync/engine.ts:20 (`const CLIENT_SCHEMA = 9; // latest migration`), src-tauri/migrations/0010_planning_subscriptions.sql (shipped in v1.2.0)
- Proven: reasoning only (git: 0010 shipped in tag v1.2.0, and the constant hasn't changed).
- What happens: v1.1.x clients (which lack deadline/someday/waiting/calendar_subscriptions) and v1.2.x clients both report schema 9. The server floor (`min_client_schema`) therefore can't require v1.2 without also locking out every current client, which defeats the "Version skew" mechanism in the spec.
- Repro: read engine.ts:20 against the migrations directory.
- Expected: the constant follows the latest local migration, with a test to enforce it.
- Suggested fix: set it to 10 and add to shared.test.ts that `CLIENT_SCHEMA` equals the highest `src-tauri/migrations/NNNN` number.

### SYNC-13 · low · bug · A remote settings pull can undo a settings change made in the last 250 ms
- [ ] Status: open
- Where: src/lib/sync/engine.ts:243-247, src/stores/settings.ts:24-31, src/db/settings.ts:20-22
- Proven: reasoning only.
- What happens: `update()` sets the store immediately and saves after a 250 ms debounce. Until then the change isn't in the outbox, so planApply doesn't protect it. The pull merges the full remote settings record over the store and calls `saveSettings(next, false)`, which sets `saved = next`. The debounced save then finds no patch, so the user's change is reverted and never pushed. The window is narrow but real when dragging sliders while another device syncs settings.
- Expected: settings changes still waiting on the debounce win like pending outbox fields.
- Suggested fix: in pull, flush the pending debounced save (the store already has a flush used before quit) before reading the outbox.

### SYNC-14 · low · bug · The post-pull hydrate reads outside the write chain and can briefly undo an edit made during it
- [ ] Status: open
- Where: src/lib/sync/engine.ts:248 (hydrate after transact), src/stores/data.ts:124-135, src/db/client.ts:38-41 (`select` is not chained)
- Proven: reasoning only.
- What happens: an edit made between the pull's transact and hydrate's SELECT has its write queued behind the select, or lands after the snapshot. hydrate then `set()`s the store from the older snapshot, and the edit disappears from the UI (it is in the DB) until the next hydrate.
- Suggested fix: run the hydrate reads through `transact` (on the chain), or merge only the rows the pull changed into the store.

### SYNC-15 · low · bug · Realtime DELETE events on `devices` reach every user and wake every client
- [ ] Status: open
- Where: supabase/migrations/20261110083515_sync.sql:190 (devices in `supabase_realtime`), src/lib/sync/engine.ts:345-351
- Proven: reasoning only (Supabase docs: RLS isn't applied to DELETE events and they can't be filtered, the same concern 20261115020000_social_pings.sql cites for `friendships`).
- What happens: removing a device (or an account cascade) broadcasts `{owner_id, id}` to all subscribers, so other users' clients receive account and device UUIDs. Every connected client also runs `syncNow()` on each such event (`p.new` is empty, so the id check passes): a thundering herd.
- Suggested fix: publish a per-account pings table (as social_pings does) instead of `devices`, or ignore events with no `new.id`.

### SYNC-16 · low · bug · A refused non-shared patch leaves the device permanently ahead of the server
- [ ] Status: open
- Where: src/lib/sync/engine.ts:100-102, supabase/migrations/20261114020000_shares.sql:693-706 (only shared tables with 42501 are re-sent)
- Proven: reasoning only.
- What happens: a patch refused for a size or check failure (e.g. the `sync_rows_size` 1 MB cap, a bad `_delta`) is deleted from the outbox and listed under Sync issues. The local value stays, the server never has it, and later issues expire after 7 days (startSync:378), so the divergence becomes invisible.
- Suggested fix: on refusal of a non-shared row, bump the server row's version as the shared path does, so the device gets the server copy back, or keep the patch for retry when the reason is transient.

### SYNC-17 · medium · feature · Failed applies should be retried, not skipped past by the cursor
- [ ] Status: open
- Where: src/lib/sync/engine.ts:228-239
- Proven: reasoning only.
- What happens: any applyOp error (constraint, FK, NOT NULL) becomes an "issue", and the cursor still moves past the row, so that change never arrives unless a later edit touches the row. The startSync heuristics (reset the cursor when old issue text matches) are one-off patches for each failure kind found so far.
- Suggested fix: keep failed `(tbl,id)` pairs in `sync_state` and re-request those rows by id (a small `sync_get(ids)` RPC) on later runs, removing each once it applies.

### SYNC-18 · medium · feature · Show conflicts and sync health to the user
- [ ] Status: open
- Where: Settings → Account (Sync issues only lists refusals and apply errors)
- What happens: overwritten values (LWW), tasks moved to the Inbox for a missing list, tags merged by the collision rule, and patches the server skipped are all silent. There's no "N changes waiting to sync" count or "last successful push" time, which would have exposed the stuck `record='0'` bug.
- Suggested fix: show the outbox count and the age of its oldest row in the Account panel. Log each local substitution and each server-side overwrite (when a pushed field had changed since the device last pulled it) as an issue with the old value.

### SYNC-19 · low · feature · Coalesce the outbox and stop recording while signed out
- [ ] Status: open
- Where: src-tauri/migrations/0009_sync.sql triggers, src/lib/sync/engine.ts:468-477 (`keep` leaves record=1)
- What happens: every UPDATE adds a row, and nothing merges successive patches to the same row (dragging a task's order 200 times queues 200 patches). After "Sign out, keep data", recording stays on indefinitely, so a user who never signs back in grows the outbox forever.
- Suggested fix: before each push, merge consecutive non-`_delta` patches per `(tbl,row_id)` (sum the `_delta`s). Cap or prune the outbox (or keep only the changed-row set, rebuilt as full rows at resume) while signed out.
