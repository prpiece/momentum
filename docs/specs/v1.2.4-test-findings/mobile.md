# Phone app (MOB)

Scope: mobile/. Part of the [v1.2.4 test findings](README.md). Each entry says whether a probe test proved it or it rests on reading the code; prove it with a failing test before fixing (the v1.2.1 rule).

### MOB-01 · medium · bug · Uncommitted app.json adds expo-updates / EAS Update, is half-configured (duplicate runtimeVersion policies, no update signing)
- [ ] Status: open
- Note (2026-11-15): the user is moving Momentum away from offline-first, so the extra network call on its own is no longer a defect. What still needs fixing: the two conflicting `runtimeVersion` policies (an iOS OTA bundle could reach a binary missing its native modules), no update code signing, the duplicated SCHEDULE_EXACT_ALARM permission, and a PLAN.md D-number for adopting EAS Update.
- Where: mobile/app.json (working tree diff: `updates.url`, `runtimeVersion` x2, `extra.eas.projectId`, `owner`), mobile/package.json (`expo-updates ~58.0.22`)
- Proven: reasoning only (diff vs docs/specs/v1.2-mobile.md "EAS Update is not used in v1.2"; CLAUDE.md "Network calls are the update check (desktop) and sync"; memory "store accounts/EAS wait for listing")
- What happens: with expo-updates installed the app checks u.expo.dev on every launch (default checkAutomatically ON_LOAD) and can run downloaded JS. That is a new network path not in the privacy policy, and the project id and personal `owner` account are baked into a repo that is planned to move accounts. `runtimeVersion` is declared twice with different policies: top level `appVersion`, iOS `sdkVersion`. With `sdkVersion`, an iOS OTA JS bundle that needs new native code (the momentum-alarm module, widgets) would be delivered to older binaries and crash. No update code signing is configured.
- Repro: build the app, launch online, and it contacts u.expo.dev. Compare the iOS and Android runtime versions in the generated config.
- Expected: no OTA (per spec) until deliberately adopted; if adopted, one runtimeVersion policy for both platforms, code signing, privacy policy updated.
- Suggested fix: discard the updates/owner/eas/runtimeVersion hunks and the expo-updates dependency, or finish the decision (single `runtimeVersion: {policy:"appVersion"}`, remove the ios override, record a D-number in PLAN.md).

### MOB-02 · low · bug · Duplicate `android.permission.SCHEDULE_EXACT_ALARM` entry in app.json
- [ ] Status: open
- Where: mobile/app.json android.permissions (working tree)
- Proven: yes (git diff shows the line added twice)
- What happens: harmless at build (manifest merger dedupes) but sloppy. The permission itself is still needed: expo-notifications DATE triggers use exact alarms and Settings has an "Allow alarms" flow. The custom alarm module uses setAlarmClock, which needs no permission. Version check is fine: app.json is 1.2.3 and matches the other three files, so src/shared.test.ts passes. mobile/package.json `version` is "1.0.0" and is not checked.
- Repro: `git diff mobile/app.json`
- Expected: listed once.
- Suggested fix: delete the duplicate line.

### MOB-03 · medium · bug · Task sheet notes never resync, and a blur overwrites newer remote notes with stale text
- [ ] Status: open
- Where: mobile/src/app/task/[id].tsx (`const [notes, setNotes] = useState(...)` has no sync effect, unlike title; `onEndEditing` on the Notes input)
- Proven: reasoning only
- What happens: `notes` is initialised once. Title has `useEffect(() => setTitle(t.title))`, notes does not. If the desktop or a sync pull changes the description while the sheet is open, the field shows stale text. Focusing then leaving the field computes `next = stale notes + attachments`, which differs from `t.description`, and `updateTask` writes the stale text over the newer desktop notes (and it syncs back). Related: an emptied title is neither saved nor reverted (field shows empty, store keeps old).
- Repro: open a task on the phone, edit its notes on desktop, wait for sync, tap into the phone's Notes then tap away. The desktop edit reverts.
- Expected: notes follow the store unless being edited; no write when the user did not change the text.
- Suggested fix: set a `dirty` flag in onChangeText and write only when dirty; resync notes from the store while the field is not focused.

### MOB-04 · medium · bug · Typed text can be lost when the form sheet is swiped away with the keyboard open
- [ ] Status: open
- Where: task/[id].tsx (title and notes save only in `onEndEditing`); formSheet presentation in _layout.tsx
- Proven: reasoning only (RN does not guarantee onEndEditing on unmount)
- What happens: title and notes persist only when the field ends editing. Dismissing the sheet by swipe or Android back while typing can unmount before onEndEditing fires and silently drop the edit.
- Repro: open a task, type in Notes, swipe the sheet down immediately.
- Expected: edit saved.
- Suggested fix: debounce-save in onChangeText and flush in an unmount cleanup.

### MOB-05 · medium · bug · Habit target/amount fields reject decimal commas (locale)
- [ ] Status: open
- Where: mobile/src/app/habit/[id].tsx:71 (`Number(n) || 0`), :85 (`Number(k)`), :117 (`Number(v)`)
- Proven: reasoning only (Number("2,5") is NaN)
- What happens: the keyboard is `decimal-pad`, which types "," in many locales (DE, FR, ES, PT, NL). "2,5" becomes NaN, then `|| 0`, then `Math.max(1, 0)` gives a target of 1 for count/amount and a cap of 0 for limit. The value is silently replaced. A check-in value typed with a comma (line 117) is ignored with no feedback.
- Repro: set device language to German, create an Amount habit, type 2,5.
- Expected: 2.5.
- Suggested fix: one helper `Number(text.replace(",", "."))` used at all three sites.

### MOB-06 · medium · bug · A second `choose()`/`askText()` while one is open leaves the first promise unresolved
- [ ] Status: open
- Where: mobile/src/ui/Sheet.tsx (`choose`, `askText` call `useAsk.setState({ ask })`)
- Proven: reasoning only
- What happens: the new ask replaces the previous one without resolving it. The earlier awaiting flow (scope prompt, multi-step "waiting for" flow) hangs forever, and for askText the stale `text` state from the first prompt can prefill the next (`text` resets only in `close`).
- Repro: trigger two sheets in quick succession (double tap on a list menu entry).
- Expected: the earlier promise resolves null when replaced.
- Suggested fix: in both helpers call `useAsk.getState().ask?.resolve(null)` before setting the new ask, and reset `text`.

### MOB-07 · medium · bug · Android alarm rings indefinitely and is lost on reboot
- [ ] Status: open
- Where: mobile/modules/momentum-alarm/android/src/main/java/expo/modules/momentumalarm/MomentumAlarm.kt (AlarmReceiver `FLAG_INSISTENT`, `setAlarms`), notify.ts (`continue` past scheduleNotificationAsync for alarms)
- Proven: reasoning only
- What happens: (1) `FLAG_INSISTENT` with no timeout rings until the user acts; an unattended phone alarms until the battery dies. (2) No BOOT_COMPLETED receiver: AlarmManager forgets alarms on reboot and the high-priority reminders are not also scheduled as normal notifications, so they are missed entirely until the app is opened (acknowledged in a ponytail comment). (3) Completing the task elsewhere while it rings does not stop it. (4) If POST_NOTIFICATIONS is denied the alarm shows nothing.
- Repro: create a high-priority task with a reminder in 2 minutes on Android 14, reboot before it fires.
- Expected: reminder still fires; ringing stops after about a minute.
- Suggested fix: add a boot receiver that re-arms from the stored prefs, or also schedule a plain notification as fallback; `setTimeoutAfter(60_000)` on the notification.

### MOB-08 · low · bug · Notification permission prompt appears at launch, not when the user first sets a reminder
- [ ] Status: open
- Where: mobile/src/notify.ts `allowed()` called from `apply()` on every start
- Proven: reasoning only (spec: "ask when the user first sets a reminder or starts a timer, not at launch")
- What happens: an account that syncs tasks with reminders from the desktop triggers the OS prompt about 1 s after first launch, possibly over the welcome screen.
- Expected: ask in context.
- Suggested fix: request permission only from the action that creates a reminder or starts focus; `apply()` should only read `getPermissionsAsync().granted`.

### MOB-09 · low · bug · Reschedule briefly leaves no pending notifications; the 60 cap does not count everything
- [ ] Status: open
- Where: mobile/src/notify.ts `apply()` (cancel loop, then one await per schedule), `LIMIT = 60`
- Proven: reasoning only
- What happens: all non-snooze notifications are cancelled, then rescheduled one `await` at a time (up to 60 native calls). If the app is killed or backgrounded in that window, the user can be left with none. Count: fires up to 60 minus blocks, plus blocks, plus 1 focus notification, plus pending snoozes, can reach 61 plus snoozes, exceeding iOS's 64 when several snoozes are pending.
- Expected: diff-based scheduling and a cap that includes focus and snooze.
- Suggested fix: schedule the new set first (same identifiers overwrite), then cancel identifiers not in it; use `LIMIT = 56`.

### MOB-10 · low · bug · Snooze/Done pressed with the app killed take effect only at next launch
- [ ] Status: open
- Where: notify.ts `respond` and `getLastNotificationResponseAsync` (acknowledged ponytail)
- Proven: reasoning only
- What happens: "Snooze 10 min" with the app closed does nothing until the app is next opened, then snoozes 10 minutes from that moment; Done likewise. The OS already dismissed the notification, so the user believes it worked.
- Expected: actions work with the app closed.
- Suggested fix: headless task (expo-task-manager), or make the actions open the app.

### MOB-11 · low · bug · Deep-link params are not validated (`share`, `event/new`)
- [ ] Status: open
- Where: mobile/src/app/share.tsx (`kind`), mobile/src/app/event/[id].tsx (`minute`, `day`)
- Proven: reasoning only
- What happens: `momentum://share?kind=<anything>&id=<anything>` treats any non-"folder" kind as a list and passes the raw string to `api.createShare(kind, id)` when the user taps "Share this ...". `momentum://event/new?minute=abc` gives NaN into `hhmmOf` and `timed()` (Invalid Date); `day=garbage` goes into `atLocalTime`. Impact limited to wrong or failed actions; no exfiltration path found. The invite route passes the code to `openInvite`, which answers "isn't a Momentum invite link", acceptable.
- Repro: `adb shell am start -a android.intent.action.VIEW -d "momentum://event/new?minute=abc"`
- Expected: invalid params ignored.
- Suggested fix: validate `kind in {list, folder}`, `/^\d{4}-\d\d-\d\d$/` for day and `Number.isInteger(minute)`.

### MOB-12 · low · bug · Today widget goes stale when the app is not opened
- [ ] Status: open
- Where: mobile/src/widgets/start.ts
- Proven: reasoning only
- What happens: the snapshot is written only while the app runs. Overnight the widget keeps yesterday's list; tasks completed or added on the desktop do not reach it until the phone app is opened. The Android widget is display-only.
- Expected: at least a midnight refresh, or the limit documented.
- Suggested fix: midnight timeline entry if expo-widgets supports it; otherwise document.

### MOB-13 · low · bug · No keyboard avoidance outside Sheet and welcome
- [ ] Status: open
- Where: mobile/src/app/event/[id].tsx, habit/[id].tsx, report.tsx (multiline body), task/[id].tsx (notes in a formSheet)
- Proven: reasoning only (KeyboardAvoidingView exists only in welcome.tsx; Sheet handles its own)
- What happens: spec says "the keyboard never covers the field being typed in". These are plain ScrollViews with `keyboardShouldPersistTaps` but no inset handling; with Android edge-to-edge and iOS modals, lower fields (report body, habit unit, event notes) can sit under the keyboard.
- Repro: Report a problem, tap "What happened?" on a small phone.
- Suggested fix: `automaticallyAdjustKeyboardInsets` on iOS and the existing `useKeyboardHeight` padding on Android.

### MOB-14 · low · bug · `fontFamily: "monospace"` is Android-only (Connections code and webhook)
- [ ] Status: open
- Where: mobile/src/app/connections.tsx (`mono`)
- Proven: reasoning only
- What happens: on iOS it falls back to the system font, so the one-time code and webhook URL are not monospaced (O/0, l/1 ambiguity). JetBrains Mono is already loaded.
- Suggested fix: use the loaded JetBrains Mono family.

### MOB-15 · low · bug · Regenerating the webhook has no confirmation
- [ ] Status: open
- Where: mobile/src/app/connections.tsx `makeWebhook` bound to "Regenerate"
- Proven: reasoning only
- What happens: one tap permanently invalidates the old URL used by external integrations, unlike Delete which asks.
- Suggested fix: Alert confirm like Delete.

### MOB-16 · low · bug · SQLite driver's `$N` to `?N` rewrite would also rewrite `$digits` inside string literals (latent)
- [ ] Status: open
- Where: src/db/client.ts:18 `numberedParams` (used by mobile/src/db/sqlite.ts)
- Proven: reasoning only; grep of src/db, src/stores, src/lib/sync found no quoted `$N` literal in current SQL, and migrations go through `execAsync` unrewritten
- What happens: `WHERE x = '$1'` would be rewritten. `$10` maps correctly (greedy `\d+`). JSON paths like `'$.a'` are safe (no digit).
- Suggested fix: none now; add a comment or test that SQL literals never contain `$<digit>`.

### MOB-17 · low · feature · Phone cannot edit settings its own scheduler uses
- [ ] Status: open
- Where: mobile/src/app/settings.tsx vs notify.ts (`settings.notify.focus`, digest, pomodoro, default reminders)
- Proven: reasoning only
- What happens: Settings exposes theme, accent, week start, day end, time format, notifications on/off, streak reminder, auto-focus. Missing vs desktop: daily digest time and toggle, per-kind reminder toggles, Pomodoro lengths and cycles, default reminder lead time, snooze length (fixed 10 min), default list. Values synced from desktop apply but cannot be changed on the phone.
- Suggested fix: add notify and pomodoro sections.

### MOB-18 · low · feature · Missing on phone vs desktop
- [ ] Status: open
- Where: mobile/src/app/** (no matching screens)
- Proven: yes (grep: no Trash, tag manager, section, archive-list, .ics, export UI)
- What happens: absent: Trash and restore (desktop has features/trash; on the phone deleting a list deletes its tasks with only a confirm and no undo, `removeList`; habit delete likewise), section create/rename, tag management, list archive/unarchive, Matrix/Board/Timeline/Progress, backup export/import, .ics import, command palette, voice, mini window. Several are explicit spec non-goals. Trash/restore and list archive are not listed as out of scope and are the most valuable gaps (accidental deletion on the phone cannot be recovered there).
- Suggested fix: add Trash (reuse features/trash logic via @core) and an Undo toast for list/habit delete.

### MOB-19 · low · feature · Focus screen does not keep the screen awake; only one phase end is notified
- [ ] Status: open
- Where: mobile/src/app/focus.tsx, notify.ts (single FOCUS_ID notification)
- Proven: grep (no KeepAwake usage); reading
- What happens: the timer view sleeps with the device. Timing stays correct (Date.now based), but only the current phase end is scheduled, so a Pomodoro chain with the app closed notifies once.
- Suggested fix: optional keep-awake while mounted; schedule the following phase boundaries too.

## Verified OK
- Version sync: package.json, tauri.conf.json, Cargo.toml, mobile/app.json all 1.2.3; versionCode derivation guarded in app.config.js.
- Migration list: mobile/src/db/migrations.ts has versions 1-10, matching src-tauri/migrations 0001-0010 (content diff not run; shared.test enforces it). Migrations run in a transaction with ROLLBACK on failure and `PRAGMA user_version` set inside it. 0008/0009 DROP TABLE is the same as on desktop.
- `$N` rewrite: `$10` maps correctly; out-of-order params fine with `?N`.
- Writes go through the shared ordered chain; no driver-level concurrency hazard found.
- Crypto polyfill uses expo-crypto (native CSPRNG) and is assigned with `??=`, so a real implementation is not replaced.
- Reminders: one debounced, serialised `apply` chain; cleanup returned by startReminders; notification payload validated (`targetOf`); idempotent ids from fire keys.
- Deleted task/event/habit routes show a message instead of crashing; invite route handles bad codes via openInvite's toast.
- Today and list screens use FlatList; AppState listeners are removed in cleanups; token refresh starts/stops with foreground, sync on resume and network return.
- Secure store holds only the refresh token and an "alarm permission asked" flag.
- Sheet handles Android back (onRequestClose); main Pressables (rings, tab bar, FAB, focus bar, habits) have roles and labels.
