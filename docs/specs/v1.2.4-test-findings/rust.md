# Rust/Tauri backend and app security (RUST)

Scope: src-tauri/src/, tauri.conf.json, capabilities, release workflow. Part of the [v1.2.4 test findings](README.md). Each entry says whether a probe test proved it or it rests on reading the code; prove it with a failing test before fixing (the v1.2.1 rule).

### RUST-01 · high · bug · Clicking an external link in a task note navigates the whole app window away
- [ ] Status: open
- Where: src/features/tasks/NoteMarkdown.tsx:60-70 (no `components.a`), src/features/tasks/TaskDrawer.tsx:363 (anchor clicks deliberately not treated as "edit"), also src/features/shell/WhatsNew.tsx:38,52 and src/features/settings/UpdatesSection.tsx:63 (same default `<a>`), src-tauri/capabilities/default.json (opener scope)
- Proven: reasoning only (read tauri-plugin-opener 2.7.2 `src/init-iife.js` and the react-markdown usage; did not run the app)
- What happens: react-markdown (+ remark-gfm autolinks) renders `[x](https://...)` and bare `https://...` as a plain `<a href>` with no `target`. The opener plugin's injected click handler only intercepts anchors with `target="_blank"` or ctrl/shift-click, so a normal click is not intercepted and the main WebView navigates to the external page (Tauri does not block external navigation by default). The frameless window (decorations:false) has no back button or URL bar, the React state is gone, and the user is looking at an arbitrary site inside the app chrome until they restart. Notes also arrive from other people (friend shares / sync), so this is an in-app phishing surface. Even if the click were intercepted, `opener:allow-open-url` is scoped to `https://prpiece.github.io/momentum/*`, so `open_url` would be rejected for any user link.
- Repro: add a note `[docs](https://example.com)` or paste `https://example.com`, leave edit mode, click the link.
- Expected: opens in the system browser; app window untouched.
- Suggested fix: pass `components={{ a: ({href, children}) => <a href={href} target="_blank" rel="noreferrer noopener">{children}</a> }}` to the three ReactMarkdown usages (one shared component) and widen the opener scope to `https://*` / `http://*` (plus `mailto:` if wanted); optionally add an `on_navigation` guard in Rust that denies non-app origins as a backstop.

### RUST-02 · medium · bug · A failed pre-migration backup (or missing tray library) makes the app impossible to launch, silently
- [ ] Status: open
- Where: src-tauri/src/lib.rs:387-389 (`setup`: `backup_before_migrate(...)?;` `build_tray(app)?;`), lib.rs:409-410 (`.build(...).expect(...)`), lib.rs:94-135 (`backup_before_migrate`, `prune_backups`); Cargo.toml `panic = "abort"`, main.rs `windows_subsystem = "windows"`
- Proven: reasoning only
- What happens: any I/O error in the backup (disk full during `fs::copy`, read-only or AV-locked backups folder, `remove_file` of an old backup held open by another program in `prune_backups`) returns Err from `setup`. `build()` returns Err and `.expect` aborts; in release there is no console and no dialog, so the app just vanishes on every launch (the comment promises "retries next launch", but each retry fails the same way and leaves another partial copy behind). A DB that cannot be backed up is exactly when the user most needs the app to open. Same pattern for `build_tray(app)?`: on Linux without libappindicator/ayatana (CLAUDE.md notes the .deb hard-codes `libappindicator3-1`, missing on newer Ubuntu) the tray build fails or panics and the app never starts, although the tray is optional.
- Repro: make `<config>/backups` read-only (or fill the disk) after a version bump so the marker differs, launch; or run on Ubuntu 24.04 without libayatana-appindicator.
- Expected: app starts; backup failure surfaces as a warning, marker not advanced so it retries; tray failure only disables the tray.
- Suggested fix: wrap both like the agent/asset steps already are (`if let Err(e) = backup_before_migrate(..) { eprintln!(..) }`, same for `build_tray`), and make `prune_backups` best-effort (`let _ = fs::remove_file`).

### RUST-03 · medium · bug · Alt+F4 (Windows/Linux) or Cmd+W (macOS) on a popup destroys it; quick add, mini and reminders then silently stop working until restart
- [ ] Status: open
- Where: src-tauri/src/lib.rs:373-376 (`on_window_event` returns early when label != "main"), lib.rs:247-265 (`show_quick_add`, `toggle_mini` no-op when the window is gone), src/lib/os.ts:191-196 (`Window.getByLabel("quickadd")` then `w?.show()`)
- Proven: reasoning only
- What happens: the popups are frameless but still receive WM_CLOSE / the default macOS "Close Window" menu item. Nothing prevents the close for non-main windows, so the window is destroyed (all windows are created from tauri.conf.json, never on demand). Afterwards the global quick-add shortcut, tray "Quick add"/"Mini window", the voice popup and the reminder popup all do nothing (optional chaining hides the failure). Quick add holds focus when shown, so Alt+F4 there is plausible.
- Repro: press the quick-add hotkey, press Alt+F4, press the hotkey again: nothing appears; tray > Quick add also does nothing. Same for Mini.
- Expected: closing a popup just hides it.
- Suggested fix: in `on_window_event`, for `CloseRequested` on any label other than "main": `api.prevent_close(); let _ = window.hide();`.

### RUST-04 · medium · bug · Dev and sync-test runs share (and can delete) the installed app's refresh token
- [ ] Status: open
- Where: src-tauri/src/secrets.rs:5-6,13 (`SERVICE = "com.momentum.planner"` hard-coded), src/lib/sync/supabase.ts:73-81 (`restoreSession` deletes the stored token on any 4xx), CLAUDE.md "Sync" gotcha
- Proven: reasoning only
- What happens: the keychain entry is keyed by a constant service string, not the app identifier. `npm run tauri dev` (pointed at local Supabase by .env.development.local) and the documented `--config '{"identifier":"com.momentum.planner.synctest"}'` isolation (separate DB) read and write the same `refresh_token` as the installed release app. A dev run tries the production token against the local server, gets a 4xx, and `secrets.delete()` removes it, which signs the real installed app out (and signing in locally overwrites the production token). The documented "test sync without touching your own data" path therefore does touch it.
- Repro: sign in on the installed app, run `npm run tauri dev` with local Supabase and let it restore the session, relaunch the installed app: signed out.
- Expected: separate identifiers keep separate secrets.
- Suggested fix: derive `SERVICE` from `app.config().identifier` (pass `AppHandle` into the three secret commands).

### RUST-05 · medium · bug · Voice model download has no timeout; if the connection stalls, Cancel does nothing and the state is stuck
- [ ] Status: open
- Where: src-tauri/src/voice.rs:148 (`reqwest::Client::new()`, no timeout), voice.rs:158-163 (cancel flag only checked when a chunk arrives), voice.rs:122-130 (`voice_download` returns Ok immediately while status is Downloading)
- Proven: reasoning only
- What happens: after sleep/wake or a half-open TCP connection `resp.chunk().await` never completes. The cancel flag is polled only between chunks, so Cancel has no effect, status stays `Downloading`, and clicking Download again returns `Ok(())` without doing anything. Only restarting the app clears it (482 MB on a laptop makes this likely).
- Repro: start the download, disable the network adapter or suspend/resume mid-way, press Cancel.
- Expected: cancel works at any time; a stalled download errors out and can be resumed (the .part resume logic exists).
- Suggested fix: build the client with `.read_timeout(Duration::from_secs(30))` and `connect_timeout`, and poll the cancel flag with `tokio::time::timeout(1s, resp.chunk())` in a loop.

### RUST-06 · medium · bug · A database that fails to open or migrate (or a downgrade) gives a blank window with no message
- [ ] Status: open
- Where: src/main.tsx:44-45 (`await Promise.all([... data.hydrate() ...])` at top level, no catch), src-tauri/src/lib.rs:309-319 (plugin-sql migrations run lazily when the frontend opens the DB)
- Proven: reasoning only
- What happens: any rejection (failed migration, a DB newer than the binary after a downgrade -> sqlx missing-migration error, locked or corrupt file) makes the module's top-level await reject, `root.render` is never reached, and Rust's `show_main` still shows the empty window. A pre-migration backup exists but the user is never told; the app looks hung.
- Repro: run an older build against a DB migrated by a newer one, or corrupt momentum.db.
- Expected: an error screen naming the problem and the backups folder.
- Suggested fix: wrap the hydrate block in try/catch and render a minimal error component (message, `backups_dir` path, Quit button).

### RUST-07 · low · bug · Voice "stuck hotkey" cap only stops buffering, not the microphone
- [ ] Status: open
- Where: src-tauri/src/voice.rs:26-27,312,334-337
- Proven: reasoning only
- What happens: `MAX_SECONDS` stops appending to the buffer, but the record thread keeps the input stream open and emits `voice:level` every 60 ms until `stop` is sent. If the release event is lost (global-shortcut Released not delivered, popup destroyed per the finding above) the mic stays hot (OS mic indicator on) indefinitely; the TS state stays `recording`, so a new press is ignored (os.ts:284).
- Repro: start voice via the popup mic button, close the popup with Alt+F4.
- Expected: recording ends after 120 s.
- Suggested fix: break out of the loop in `record` once `buf.len() >= max` (or elapsed > MAX_SECONDS) and emit an event so the UI resets.

### RUST-08 · low · bug · App commands are callable from every window, contradicting "popups have no data access" (D33)
- [ ] Status: open
- Where: src-tauri/build.rs (plain `tauri_build::build()`, no `AppManifest::commands`), src-tauri/capabilities/popups.json description, lib.rs:338-370
- Proven: reasoning only (Tauri 2 allows commands missing from an app manifest for all windows)
- What happens: popups.json grants only window permissions, but the custom commands `secret_get/set/delete`, `write_text_file`, `read_text_file`, `write_png`, `import_image`, `fetch_ics`, `quit_app`, `agent_*`, `voice_*` can be invoked from quickadd/mini/reminder too. Those windows render user text (task titles, transcripts), so any future XSS there could read the refresh token or write files. Defence in depth today (React escapes), hence low.
- Suggested fix: `tauri_build::Attributes::new().app_manifest(AppManifest::new().commands(&[...]))` and grant command permissions only in default.json.

### RUST-09 · low · bug · File commands accept any path with an allowed extension; `import_image` accepts any source file
- [ ] Status: open
- Where: src-tauri/src/lib.rs:165-202 (`checked_path`, `write_text_file`, `read_text_file`, `write_png`), src-tauri/src/files.rs:60-66 (`import_image`)
- Proven: reasoning only
- What happens: the comment says the commands "can't touch arbitrary files", but only the extension is checked, not that the path came from a dialog. A compromised webview can overwrite any `*.json/*.csv/*.ics/*.png` the user owns and read any `.json/.csv`. `import_image` copies ANY file (no extension or magic check on `src`) into `attachments/<id>.png`, which the asset protocol then serves back to the webview (read-any-file primitive up to 10 MB). `read_text_file` has no size cap: a multi-GB .csv/.json picked by mistake is read fully into memory and sent over IPC (with panic=abort an allocation failure kills the app).
- Suggested fix: remember dialog-picked paths in Rust state (or use the dialog plugin's fs scope), check the `src` extension in `import_image`, cap `read_text_file` (e.g. 64 MB).

### RUST-10 · low · bug · `fetch_ics` follows redirects and fetches any host (localhost, link-local, LAN), including plain http
- [ ] Status: open
- Where: src-tauri/src/net.rs:11-18,24-30
- Proven: reasoning only
- What happens: `calendar_subscriptions` is a synced table, so a URL written by another device is fetched by the desktop as-is: `http://127.0.0.1:<agent port>`, `http://169.254.169.254/...`, router pages. The body is only parsed as ICS and errors are generic, so exfiltration is minimal; the default redirect policy also follows https->http downgrades. Low impact (no response reflection, agent API needs its token).
- Suggested fix: custom redirect policy (https only) and reject loopback/link-local/private addresses for synced URLs.

### RUST-11 · low · bug · Quit paths other than tray/close skip the settings flush
- [ ] Status: open
- Where: src-tauri/src/lib.rs:145-161,409-420 (only `request_quit` emits `app:quit`; no `RunEvent::ExitRequested` handling)
- Proven: reasoning only
- What happens: macOS Cmd+Q / Dock > Quit and OS shutdown exit immediately; a setting changed within the debounce window before quitting is lost (os.ts:403 flushes only on `app:quit`).
- Suggested fix: handle `RunEvent::ExitRequested { api, .. }`: `api.prevent_exit(); request_quit(app)` guarded by an AtomicBool so the second pass exits.

### RUST-12 · low · bug · Backup .zip export is written in place, so a failed export destroys an earlier file of the same name
- [ ] Status: open
- Where: src-tauri/src/files.rs:115-132 (`fs::File::create(zip_file)` truncates the target first); same for `write_text_file` (lib.rs:173-176)
- Proven: reasoning only
- What happens: default name is `momentum-backup-<date>.zip`; exporting twice in a day and hitting disk-full or an IO error mid-way leaves a truncated zip over the earlier good backup.
- Suggested fix: write to `<path>.tmp` in the same folder and `fs::rename` after `zip.finish()`.

### RUST-13 · low · bug · release.yml: manual dispatch from a branch, and signing key visible to build scripts
- [ ] Status: open
- Where: .github/workflows/release.yml:10,42-57,135-143
- Proven: reasoning only
- What happens: `workflow_dispatch` is allowed on any ref; there `GITHUB_REF_NAME` is a branch name, so the release job creates a draft release with `tag_name=<branch>` and empty notes (the awk matches no `## main`), and publishing it would create a bogus tag. Separately `TAURI_SIGNING_PRIVATE_KEY(_PASSWORD)` is in the environment of tauri-action, which runs `beforeBuildCommand` (`node scripts/build-cli.mjs`, `npm run build`), so a compromised npm/vite plugin could read the updater signing key and ship signed malicious updates; actions are pinned to mutable tags. No `pull_request_target` or untrusted `${{ }}` inside `run:` was found.
- Suggested fix: add `if: startsWith(github.ref, 'refs/tags/v')` to the jobs; pin actions to SHAs; optionally sign updater bundles in a separate step after the build.

## Verified OK
- files.rs `valid_name`: id restricted to `[A-Za-z0-9_-]{1,64}` plus an image extension, so no `..`, separators, ADS (`:`) or long names; folder is an allowlist; zip restore needs `<kind>/<valid name>` (zip-slip test exists), each entry capped at 10 MB, JSON entry capped at 512 MB. Windows reserved names like `CON.png` pass `valid_name`, but ids are UUIDs and only a crafted zip could hit it (harmless).
- CSP is tight: `default-src 'self'`, connect-src only ipc, asset and the one Supabase host (matches .env); dev CSP only adds local Supabase. No blob:/worker usage in the frontend that the CSP would block.
- Asset protocol scope is empty in config and granted at runtime only for the two image folders.
- capabilities/default.json is minimal (opener limited to the project site, sql only in main); popups.json has no sql/fs/dialog/opener, and the popup window calls the code makes (hide/show/setSize/setPosition/outerSize) are covered.
- Updater: pubkey set, https GitHub `latest/download/latest.json` endpoint, signed artifacts, no insecure-transport flag; release `verify` job checks all platforms.
- secrets.rs only accepts the `refresh_token` key and handles `NoEntry`; keyring 4 default `v1` feature gives a store on Windows/macOS/Linux.
- net.rs: scheme allowlist (http/https/webcal), 30 s total timeout, streamed 10 MB cap, error text strips the URL.
- Single-instance plugin is first, so a second launch never reaches `setup`; window-state excludes quickadd/reminder.
- voice.rs: SHA-256 pinned model, unpack-to-temp then rename, resumable `.part`, mic thread ends via channel; the frontend state machine (os.ts) covers press/release while `starting`.
- ci.yml/keepalive.yml: no `pull_request_target`, no secrets in PR builds, `permissions: {}` on keepalive; Linux job smoke-launches the real binary.
- Rust `unwrap`s are on Mutex locks and static data only; nothing was found that unwraps user/OS input.
- Not run: cargo check (no source was modified; findings are from reading).
