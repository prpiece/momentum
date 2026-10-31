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
Bump the version in `package.json`, `src-tauri/tauri.conf.json` and `src-tauri/Cargo.toml`, then push a `vX.Y.Z` tag. `.github/workflows/release.yml` builds a draft release (Windows first, then macOS and Linux), signed for the updater with the `TAURI_SIGNING_PRIVATE_KEY(_PASSWORD)` secrets. Installed apps only see it once the draft is published (PLAN D59).

## Gotchas
- **Restart race in `tauri dev`:** editing `src-tauri/` (Rust, migrations, icons) makes `tauri dev` restart the app. The new process can fail with WebView2 `0x800700AA` ("resource in use") while the old one still holds the profile. Just run it again. Release builds are unaffected.
- **Windows and data access:** only the main window may write. The popups (`quickadd`, `reminder`) have no SQL permission and talk to the main window through events (PLAN D33).
- **Testing the real app:** set `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=<port>` before `npm run tauri dev`, then drive it over the DevTools protocol. Port 9222 may already be taken by other WebView2 apps on the machine, so pick another.

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
- **Offline:** no network calls anywhere, except the update check (PLAN D59). Fonts come from `@fontsource`.
- **Subtasks:** Matrix, calendar and focus read `Derived.roots`, never `active`; drops onto them map a subtask to `rootOf` (PLAN D58).
- **New dependencies** need a one-line reason in PLAN.md §4.

## Design tokens (`src/styles/tokens.css`)
Tailwind v4 is configured in CSS: `@theme inline` maps the tokens to utilities, and there's no `tailwind.config.ts`.
- **Colors:** every color is a CSS variable, consumed through utilities.
  - Variables and their utilities:
    - `--bg`, `--surface`, `--surface-2` (elevated), `--border`, `--hover` → `bg-bg`, `bg-surface`, `bg-surface-2`, `border-border`, `bg-hover`.
    - `--fg`, `--fg-2`, `--fg-muted` → `text-fg`, `text-fg-2`, `text-muted`.
    - `--accent`, `--accent-fg`, `--accent-hover`, `--accent-press`, `--accent-soft` → `bg-accent`, `text-accent-fg`, `bg-accent-soft` and so on.
    - `--danger`, `--success` → `text-danger`, `text-success`.
  - `--accent` and `--accent-fg` are set at runtime by `src/lib/applySettings.ts`, with the foreground picked by WCAG contrast in `src/domain/color.ts`.
  - Accent variants are derived in CSS, never hand-picked: `--accent-hover`, `--accent-press` and `--accent-soft` come from `color-mix(in oklch, var(--accent) …)`.
  - Dark mode uses layered surfaces (around `#15161a` → `#1d1f24` → `#26282e`) instead of pure black. Text must meet WCAG AA in both themes.
- **Radii:** `--r-sm: 8px` (controls), `--r-md: 12px` (cards, inputs), `--r-lg: 18px` (modals, panels).
- **Motion:** `--dur: 180ms` (150 to 220ms range) with `--ease: cubic-bezier(.2,.8,.2,1)`. Turn motion off under `prefers-reduced-motion`.
- **Type:**
  - UI font: Plus Jakarta Sans.
  - Times, timers and counters use JetBrains Mono or `font-variant-numeric: tabular-nums`.
  - Density: `html[data-density=compact]` changes `--row-h` and `--pad`. Font size sets the root `font-size`, so every rem value scales with it.

## Conventions
- **Zustand selectors return stable references.** Select the raw map (`useData((s) => s.lists)`) and derive arrays with `useMemo`. A selector that builds a new array/object on every call loops React ("getSnapshot should be cached"). `npm run lint:selectors` greps for it.
- Small components, one per file, under `src/features/<area>/`. Shared primitives go in `src/components/ui/`.
- Every interactive element gets a visible focus ring (`--accent`) and a keyboard path.
- Commit once per phase. Stage files by explicit path.
