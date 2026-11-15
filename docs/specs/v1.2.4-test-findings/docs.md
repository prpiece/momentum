# Help, docs and shortcut consistency (DOC)

Scope: src/domain/features.ts, README.md, CHANGELOG.md, site/. Part of the [v1.2.4 test findings](README.md). Each entry says whether a probe test proved it or it rests on reading the code; prove it with a failing test before fixing (the v1.2.1 rule).

### DOC-01 · medium · bug · Priority keys 1 and 3 are reversed in the shortcut sheet and Help
- [ ] Status: open
- Where: src/domain/features.ts:102 (text), src/lib/shortcuts.ts:51-55 (behaviour), src/domain/types.ts:27 (PRIORITY_LABEL)
- What happens: The "?" sheet and Settings → Help say "1 2 3 / 0: Priority high, medium, low / none". The code sets priority to `Number(e.key)`, and PRIORITY_LABEL maps 1 to Low and 3 to High. So pressing 1 makes a task Low and pressing 3 makes it High. Users who follow the documented mapping set the wrong priority on every task.
- Expected: The documented mapping matches the code: 1 = low, 2 = medium, 3 = high, 0 = none.
- Suggested fix: Change the text in features.ts:102 to "Priority low, medium, high / none". Keep the code as is, since the rest of the app (`!2` = Medium, matrix `importantPriorities: [2, 3]`) already uses this mapping.

### DOC-02 · medium · bug · Help sheet and Tour show the default global shortcuts even after the user rebinds them
- [ ] Status: open
- Where: src/domain/features.ts:89 (Ctrl Shift A), :96 (Ctrl Alt Space), :140 (Ctrl Alt M); src/features/shell/Tour.tsx:45 and :71; rebinding at src/features/settings/SettingsView.tsx:294, :297, :412
- What happens: Settings lets the user change quickAddShortcut, miniShortcut and voiceShortcut, and os.ts registers whatever was saved. The "?" sheet, Settings → Help and the tour still print the hard-coded defaults. After a rebind, the docs point at a key that does nothing.
- Expected: The shortcut text comes from the saved settings, or the entry says it can be changed.
- Suggested fix: Give the three `keys(...)` entries a settings key (e.g. `{kind:"keys", setting:"quickAddShortcut"}`) and resolve it through `keyLabel` when rendering in Dialogs.tsx and Tour.tsx. Quick fix: append "(changeable in Settings)" to those three how-to texts.

### DOC-03 · medium · bug · Shortcut recorder accepts any Ctrl/Alt/Meta combo and registers it system-wide
- [ ] Status: open
- Where: src/features/settings/SettingsView.tsx:92-94 (recorder), src/lib/os.ts:199-206 (global registration)
- What happens: The recorder only requires one of Ctrl, Alt or Meta. A user can record Ctrl+C, Ctrl+V, Ctrl+W, Ctrl+R, Ctrl+P, Ctrl+Z or Alt+F4 as the quick-add, mini or voice shortcut. os.ts then registers it as an OS-wide hotkey, so copy, paste, close and reload stop working in every other app until the setting is changed. The only check is the "another app may be using it" toast, which does not fire when the key is free.
- Expected: A global shortcut is never a common OS or webview key.
- Suggested fix: In the recorder, require Shift or Alt in addition to Ctrl/Meta, and reject a small denylist (Ctrl+C/V/X/A/W/R/P/Z/Q/S, Alt+F4, Alt+Tab, F-keys) with a toast.

### DOC-04 · medium · bug · CHANGELOG promises per-connection add-only mode that the app cannot set
- [ ] Status: open
- Where: CHANGELOG.md:23 (v1.2.1, "Each connection can be set to add-only, and the webhook starts that way"); server side supabase/migrations/20261115000000_v121_fixes.sql:459-462 (set_connection_permission)
- What happens: The database has `set_connection_permission` and the webhook defaults to 'add', so the webhook part works. No client code calls `set_connection_permission` (no caller in src/, mobile/src/ or supabase/functions/), and ConnectionsSection.tsx has no permission control. A user cannot make a Discord, Slack or Telegram link add-only, so the release note describes a feature that does not exist in the UI.
- Expected: The release note is true of the shipped app.
- Suggested fix: Either add a per-link "Add only / Full access" control in ConnectionsSection.tsx that calls the RPC through the existing API layer, or reword the note to "The webhook is add-only by default" and move the per-connection option to the next release.

### DOC-05 · medium · bug · Privacy policy understates the network calls the app makes without an account
- [ ] Status: open
- Where: site/privacy.html:27 ("The app connects to the internet for two things only")
- What happens: The policy lists two network uses for users without an account: the update check and the voice model download. The code also fetches calendar subscriptions the user adds (src/domain/subscriptions.ts, refreshed every 30 minutes, as README.md:52 says) and sends a problem report when the user submits one (src/features/settings/ReportDialog.tsx). README.md:96 lists all of these, so the two documents disagree. The policy also says "Settings → About", but the page is named "About & updates" (src/features/settings/SettingsView.tsx:116).
- Expected: The policy lists every outbound request the app makes, and names the settings page as it appears in the app.
- Suggested fix: Change the sentence to "The app connects to the internet only for things you turn on or send: checking GitHub for updates (turn off in Settings → About & updates), downloading the voice model, fetching calendar subscriptions you add, and sending a problem report you write." Keep the voice sentence about on-device processing.

### DOC-06 · low · bug · Invite page describes a paste field that does not exist and a desktop link that never opens
- [ ] Status: open
- Where: site/invite/index.html:17 ("paste the link in the app: Friends → Open invite link"); src/features/friends/FriendsView.tsx:47 (placeholder "Paste an invite link", aria "Open an invite link"); src-tauri/Cargo.toml (no deep-link plugin)
- What happens: The page tells users to use "Friends → Open invite link", but the control has no such label. The auto-redirect to `momentum://invite/<code>` only works where the app registers that scheme, which is the phone app (mobile/app.json scheme "momentum"). The desktop app registers no URL scheme, so the "Open in Momentum" button does nothing on Windows, macOS or Linux, and the page gives desktop visitors no instructions.
- Expected: The page names the field as it appears in the app, and desktop visitors are told to paste the link.
- Suggested fix: Change the line to "paste the link in the app: Friends, then the Paste an invite link box." Add a sentence for computers: "On a computer, copy the link and paste it into Friends."

### DOC-07 · low · bug · Windows-only wording shown to macOS and Linux users in notification settings
- [ ] Status: open
- Where: src/features/settings/NotificationSection.tsx:61 ("Windows notification" preview caption) and :109 (option label "Windows" for the system notification style)
- What happens: The notification style control is shown on every platform. On macOS and Linux the option reads "Windows" and the preview says "Windows notification". The label should name the OS-neutral thing.
- Expected: The label is neutral, or uses the platform name from src/lib/platform.ts.
- Suggested fix: Use "System" for the option label (matching the "system" value) and "System notification" for the preview caption.

### DOC-08 · low · bug · "Tray" wording shown on macOS where the app uses the menu bar
- [ ] Status: open
- Where: src/features/settings/NotificationSection.tsx:78; src/features/settings/SettingsView.tsx:288 ("Keep running in the tray") and :291 ("Start minimized to the tray")
- What happens: On macOS the status item is in the menu bar, and these settings name the tray.
- Expected: The label matches the platform's term, using the same isMac check as keyLabel.
- Suggested fix: Add `trayName = isMac ? "menu bar" : "tray"` in src/lib/platform.ts and use it in the three strings.

### DOC-09 · low · bug · README release steps omit mobile/app.json, which the version check requires
- [ ] Status: open
- Where: README.md:154 ("Bump the version in `package.json` and `src-tauri/tauri.conf.json` (and `src-tauri/Cargo.toml`)")
- What happens: CLAUDE.md lists four files, and src/shared.test.ts (lines 52-54) fails when mobile/app.json (expo.version) differs. A release that follows the README leaves the phone version behind, and the test then fails.
- Expected: The README lists the same four files as CLAUDE.md.
- Suggested fix: Change the line to "Bump the version in `package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml` and `mobile/app.json` (the test in src/shared.test.ts checks they match)."

### DOC-10 · low · feature · Registry and README advertise 1.3.0 and 1.4.0 features with no CHANGELOG section
- [ ] Status: open
- Where: src/domain/features.ts:113-120 and :141-159 (`since: "1.3.0"` / `"1.4.0"`); README.md:22-23 and :66-70; CHANGELOG.md (top section is v1.2.3, and package.json is 1.2.3)
- What happens: Deadlines, duration tokens, Someday, Waiting, One thing, Todoist and TickTick import, and snooze are tagged 1.3.0. Friends, sharing, focus together, buddies and connections are tagged 1.4.0. No CHANGELOG section covers either version, so these features will not appear in the release notes or "What's new" when they ship. The Friends entries say 1.4.0, but the v1.2.3 changelog already describes friend requests, so Getting started will show them as "New" to users who already have them.
- Expected: Each shipped feature is in the changelog under the version it first shipped in, and the registry's `since` matches that version.
- Suggested fix: Add `## v1.3.0` and `## v1.4.0` sections when those versions are cut, and correct `since` on the friends entries to the version that first shipped them (1.2.x, per CHANGELOG.md).

### DOC-11 · low · bug · docs/mocks is untracked, but CLAUDE.md names it as the design source
- [ ] Status: open
- Where: CLAUDE.md:49 ("The screen mocks are `docs/mocks/momentum.html`"); git status shows `?? docs/mocks/`
- What happens: The mocks are not committed. A fresh clone has no docs/mocks/momentum.html, so the design-token workflow in CLAUDE.md cannot be followed.
- Expected: Every file CLAUDE.md names is in the repository.
- Suggested fix: Commit docs/mocks/ by explicit path, or change CLAUDE.md to point at a committed copy.

### DOC-12 · low · bug · Uncommitted mobile/app.json lists SCHEDULE_EXACT_ALARM twice
- [ ] Status: open
- Where: mobile/app.json:28-29 (uncommitted diff, `git diff mobile/app.json`)
- What happens: The permissions array contains "android.permission.SCHEDULE_EXACT_ALARM" twice. The duplicate is harmless today, but it is an accidental copy in an uncommitted change.
- Expected: The permission appears once.
- Suggested fix: Delete line 29. Also review the rest of that diff before committing; it adds a personal "owner" value and a runtimeVersion policy that conflicts with the top-level one.

### DOC-13 · low · bug · Mixed "Color" and "Colour" in user-facing copy
- [ ] Status: open
- Where: src/features/calendar/CalendarView.tsx:135 ("Color by"); src/components/ui/ColorField.tsx:18 (default label "Color"). Versus "Colour" at src/features/matrix/MatrixView.tsx:199 ("Colours") and src/features/settings/BackgroundSection.tsx:81 ("Colour"), and README.md:51 ("Colour items by list")
- What happens: The app uses British "Colour" in most places and American "Color" in the calendar menu and the shared color field. The two spellings appear in the same Settings and Calendar screens.
- Expected: One spelling, the one used in the rest of the copy and the glossary ("colour" throughout CLAUDE.md).
- Suggested fix: Change CalendarView.tsx:135 to "Colour by" and the ColorField default to "Colour". Grep for other visible "Color" strings before merging.
