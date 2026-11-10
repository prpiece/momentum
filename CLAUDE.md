# Momentum

Offline, local-first desktop planner: Tauri 2 (Rust) + React/TS/Vite + Tailwind + Zustand + SQLite (`@tauri-apps/plugin-sql`). The plan, phases and decision log are in `PLAN.md`. Record each new decision there as `D<n>`.

## Commands
- `npm run tauri dev`: run the app. The first run compiles Rust and takes a few minutes.
- `npm run dev`: UI only, in a browser. No persistence (see `isTauri` in `src/db/client.ts`).
- `npm test`: selector lint + Vitest (domain, row mapping, store logic). Tests run in TZ=America/New_York.
- `npm run build`: typecheck and build the frontend
- `npm run tauri build`: produce the installers (`src-tauri/target/release/bundle/`). Updater bundles are signed, so set `TAURI_SIGNING_PRIVATE_KEY` (the key file `~/.tauri/momentum.key` or its contents) and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` first, or the build fails at the signing step.
- `npm run screenshots`: regenerate the README images in `docs/screenshots/`. Run it and commit the images after any visible UI change (PLAN D61).
- DB location: `%APPDATA%\com.momentum.planner\momentum.db`, with pre-migration copies in `backups\` alongside it.
- Schema changes: add `src-tauri/migrations/NNNN_name.sql` and register it in `migrations()` in `src-tauri/src/lib.rs`. Never edit a migration that has already been applied, because sqlx checksums them.

## Releases
Bump the version in `package.json`, `src-tauri/tauri.conf.json` and `src-tauri/Cargo.toml`, add a `## vX.Y.Z` section to `CHANGELOG.md` (it becomes the release notes and the in-app "What's new", PLAN D66), then push a `vX.Y.Z` tag. `.github/workflows/release.yml` builds a draft release (Windows first, then macOS and Linux), signed for the updater with the `TAURI_SIGNING_PRIVATE_KEY(_PASSWORD)` secrets. Installed apps only see it once the draft is published (PLAN D59).

## Gotchas
- **Restart race in `tauri dev`:** editing `src-tauri/` (Rust, migrations, icons) makes `tauri dev` restart the app. The new process can fail with WebView2 `0x800700AA` ("resource in use") while the old one still holds the profile. Just run it again. Release builds are unaffected.
- **Windows and data access:** only the main window may write. The popups (`quickadd`, `reminder`) have no SQL permission and talk to the main window through events (PLAN D33).
- **macOS builds are ad-hoc signed, not notarized** (`bundle.macOS.signingIdentity: "-"`, PLAN D201). Without a signature the downloaded app shows "damaged"; with one, the first launch needs right-click → Open or `xattr -cr /Applications/Momentum.app`. `src-tauri/Info.plist` carries `NSMicrophoneUsageDescription` and `Entitlements.plist` the audio-input entitlement: without them macOS kills the app when voice opens the mic.
- **Linux:** the app sets `WEBKIT_DISABLE_DMABUF_RENDERER=1` at startup (blank windows on newer GPU stacks). The tray needs libappindicator / libayatana-appindicator and voice needs ALSA; the `.deb`/`.rpm` declare ALSA, but the bundler hard-codes `libappindicator3-1`, which newer Ubuntu lacks.
- **Platform text:** shortcuts are written Windows-style ("Ctrl K"); render them through `<Keys>` or `keyLabel()` (`src/lib/platform.ts`) so macOS shows ⌘ ⌥ ⇧. Paths shown to the user come from `dataDirLabel`, never a hard-coded `%APPDATA%`.
- **Port 1420:** `npm run tauri dev` fails if the browser preview (`npm run dev`) still holds the port. Stop it first.
- **Sync (v1.1, PLAN D225/D226):** a migration that changes a synced table's columns must regenerate that table's triggers with `node scripts/sync-triggers.mjs` (a test fails otherwise). `npm run test:server` needs `supabase start` (Docker). To test sync without touching your own data, run the app with `--config '{"identifier":"com.momentum.planner.synctest"}'`; `.env.development.local` points dev builds at the local server, whose emails land in Mailpit (http://127.0.0.1:54324).
- **Testing the real app:** set `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=<port>` before `npm run tauri dev`, then drive it over the DevTools protocol. Port 9222 may already be taken by other WebView2 apps on the machine, so pick another. After a hot reload, Vite serves edited modules as `…?t=…`, so `import("/src/…")` from a test script gets a separate copy of the store: restart the dev server before driving stores directly.

## Architecture rules
- **One source of truth:** Zustand stores hydrate from SQLite, and each action writes through to a `db/` repo. Smart Lists, Matrix quadrants, calendar blocks and search are *selectors* over task records. They are never stored.
- **`src/domain/` is pure:** no React, no Tauri imports. All recurrence, date, matrix, streak, NL-parse and layout logic goes there, with a `*.test.ts` beside each file. Test that logic before wiring up any UI.
- **Time:**
  - Timed instants are UTC ISO strings.
  - All-day items and due dates are local `YYYY-MM-DD` strings and never become instants.
  - Recurrence uses floating local wall-clock time.
  - Occurrences are virtual (`src/domain/recurrence.ts`). Exceptions are `exdates` keys plus detached standalone copies (PLAN D13).
- **Domain types are discriminated unions** (`status`, habit `frequency`, `goal`). Narrow them; never cast them.
- **Validate at boundaries** (JSON import, .ics import, DB rows). Code inside the boundary trusts those types.
- **Drag and drop:** dnd-kit pointer sensors only. `dragDropEnabled: false` is set in `tauri.conf.json` because Tauri's native file-drop handler would otherwise swallow drag events on Windows.
- **Offline first:** the app works fully offline. Network calls are the update check (PLAN D59) and, when signed in, sync with Supabase (ADR 0001, PLAN D225). Fonts come from `@fontsource`.
- **Subtasks:** a view shows a subtask inside its parent when both are in it, otherwise on its own with the parent's name: lists via `flattenTree`, cards via `topLevelIn` (PLAN D196). Date grids show dated subtasks; only the Arrange panel and focus picker read `Derived.roots`.
- **New dependencies** need a one-line reason in PLAN.md §4.

## Design tokens (`src/styles/tokens.css`, PLAN D198)
The source is `docs/design/momentum-tokens.css`. The screen mocks are `docs/mocks/momentum.html`, one `<section id>` per screen: read it a section at a time. Tailwind v4 is configured in CSS: `@theme inline` maps the tokens to utilities, and there's no `tailwind.config.ts`. `tokens.test.ts` checks WCAG AA and that `ACCENTS` matches the CSS.
- **Colors:** every color is a CSS variable, consumed through utilities.
  - Surfaces: `--bg` (window, sidebar), `--surface` (content), `--surface-2` (hover, chips, input tracks) and `--raised` (menus, dialogs, popovers, toasts) → `bg-bg`, `bg-surface`, `bg-surface-2`, `bg-raised`. Borders: `border-border`, `border-border-strong`, `border-control-border` (checkbox ring, toggle off).
  - Text: `text-fg`, `text-fg-2`, `text-muted`. Weight does the hierarchy, not colour.
  - Accent: `bg-accent`/`text-accent-fg` for the primary action, `bg-accent-hover`/`-press`, `bg-accent-soft` for selection (text on it stays `fg`), `text-accent-text` for links, icons and the focus ring. Never for large areas.
  - Status: `danger` (with `-hover`, `-press`, `-soft`, `-fg`), `success`, `success-soft`. Fixed marks: `prio-high/med/low` and `prio-high-tint` (`PRIORITY_VAR` in `domain/types.ts`), `q-do/schedule/delegate/drop` (`QUADRANT_VAR` in `domain/matrix.ts`), `streak`, `on-strong` (text on those fills), trophy metals `m-*`, list colours `l-*`, habit colours `h-*`.
  - The accent is a preset id on `html[data-accent]`, set by `src/lib/applySettings.ts`, and each preset is hand-tuned per theme in `tokens.css`. Never set `--accent` inline. `ACCENTS` in `src/domain/color.ts` repeats the values for swatches (`.swatch` with `--sw`/`--sw-d`) and the app icon.
  - Dark mode (`html[data-theme=dark]`) uses layered surfaces (`#141519` → `#1b1d22` → `#24262c`), never pure black. Inside a raised layer in dark, `.layer-raised` steps the fills up one level.
- **Radii:** `rounded-xs` 4px (keycaps, inline tokens), `rounded-control` 6px (buttons, inputs, chips, rows), `rounded-card` 10px (cards, menus, quadrants), `rounded-panel` 14px (dialogs, palette, sheets), `rounded-full` (checkboxes, toggles, pills).
- **Shadow:** one, `shadow-float`, for floating layers only. Cards sit on borders or a surface step.
- **Spacing and sizes:** a 4px grid (`--space-*`). `--row` is 36px (32px compact), `--control` 32px, `--touch` 44px below 720px. Panel widths are in the Sizes block. Pages pad with `px-[var(--gutter)]` (32px, 16px below 720px).
- **Phone layout (below 720px, PLAN D200):** use `max-[719px]:` / `min-[720px]:` variants. The sidebar or bar hides for `PhoneBar`; rows go two-line; Tailwind `text-xs/sm/base` follow `--fs-xs/base/lg`, so they step up with the tokens.
- **Motion:** `--dur-fast` 150ms (fades, menus), `--dur` 180ms, `--dur-slow` 220ms (panels); `--ease-out` entering, `--ease-in` leaving, `--ease-move` moving. Hover and press are instant. Nothing moves under reduced motion.
- **Type:**
  - UI font: Inter Variable with `cv05`, `cv08`. Scale: `--fs-xs` 12, `--fs-sm` 13, `--fs-base` 14, `--fs-lg` 16, `--fs-xl` 24, `--fs-display` 44 (rem at a 16px root, one step larger below 720px).
  - Bricolage Grotesque only through `.t-title` (page titles) and `.t-display` (big numbers): 24px and up, at most two per screen. `.t-label` is the 12px uppercase label.
  - JetBrains Mono (`font-mono`, `.t-timer`) only for the focus timer digits. Every other count, date, time or stat uses `tabular-nums` (`.t-count`).
  - Density: `html[data-density=compact]` sets `--row` to `--row-compact`. The Scale setting is the webview zoom (PLAN D202), so every size scales and the breakpoints reflow.

## Conventions
- **Zustand selectors return stable references.** Select the raw map (`useData((s) => s.lists)`) and derive arrays with `useMemo`. A selector that builds a new array/object on every call loops React ("getSnapshot should be cached"). `npm run lint:selectors` greps for it.
- Small components, one per file, under `src/features/<area>/`. Shared primitives go in `src/components/ui/`.
- Every interactive element gets a visible focus ring (`--accent-text`) and a keyboard path.
- **Visual rules (PLAN D172, D198):** no glass or blur (except the 6px blur on the Dialog scrim, D202, and the 2–3px blur inside short entry animations, D208), no gradients, no glows, no emoji in the chrome (only in names the user typed), one shadow (`shadow-float`) for floating layers. Reuse the component classes in `src/styles/components.css` (`.btn`, `.input`, `.seg`, `.check`, `.layer`, `.menu-item`, `.nav-item`, `.card`, `.kbd`, `.token`…) before writing new class strings; a view's controls go in the toolbar through `<ToolbarActions>`, a page title through `<PageHead>`.
- **Feature registry:** every user-facing feature has an entry in `FEATURES` (`src/domain/features.ts`: title, how-to line, commands/shortcuts/tokens, done-detector). The palette, the `?` sheet, Settings → Help, Getting started and the tour all read it, and a test fails when a command has no help text. Add the entry with the feature.
- Commit once per phase. Stage files by explicit path.
