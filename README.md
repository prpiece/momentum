<p align="center">
  <img src="assets/app-icon.svg" width="96" alt="Momentum logo" />
</p>

<h1 align="center">Momentum</h1>

<p align="center">
  An all-in-one, offline desktop planner: tasks, a drag-and-drop calendar, habits, an Eisenhower Matrix, a focus timer and your progress.<br />
  Local-first. No account, no cloud, no telemetry. Your data never leaves your computer.
</p>

<p align="center">
  <img src="docs/screenshots/calendar.png" alt="Momentum week calendar" width="860" />
</p>

## Features

**Tasks**
- Quick-add bar with natural language: `Study chem tomorrow 5pm !high #school ~Uni every mon` sets the date, time, priority, tag, list and repeat, with each recognised piece shown as a chip. Typing `#` or `~` suggests your tags and lists. Press <kbd>Esc</kbd> to keep the text literal.
- Bulk import: paste a whole list (split by line or your own separator) and each item becomes a task, read like quick add. Indented lines become subtasks. One undo removes the lot.
- Smart Lists are live queries, not copies: Inbox, Today (including overdue) and Upcoming (grouped by day). Show completed brings finished tasks back into any view.
- Filter any view with the quick-add syntax (`#work !high ~Uni tomorrow`, plus `overdue`, `nodate`, `done`, `wontdo`), and pin a filter to the sidebar to keep it. Click a tag on a task to filter by it.
- Lists with colours and icons, folders nested up to three deep, tags, and subtasks up to 5 levels. Drag to reorder, or drag onto a list, Today or Upcoming in the sidebar.
- Subtasks nest under their parent when both are in a view, and stand alone with the parent's name when only the subtask is (a dated subtask in Today, say). Completing a task completes its open subtasks, and the Focus timer lists the subtasks so you can tick them off as you go.
- A quiet sidebar: Inbox, Today, Upcoming, Calendar, Habits, Focus and Progress, then your folders and lists. Or use a single bar at the top or bottom of the window instead.
- One view switch on every task view: List, Board (a list's sections as columns you can drag to reorder), Timeline or Matrix. Group by list, date, priority or tag, and sort by date, priority, created, title or manual order.
- Task drawer:
  - A property column for list, due date, priority and tags, each opening its editor.
  - Markdown notes with images: paste, drop or add a picture, hover one to copy it back out. Removing an image from the note deletes its file too.
  - Date, time and duration, multiple reminders, repeat rules (presets or custom).
  - Priority, tags, subtasks (delete one from its parent with the hover bin), checklist, pin, duplicate, won't-do.
  - Activity history.
- Recurring tasks ask whether a change applies to *this occurrence*, *this and following* or *all*.
- Multi-select with <kbd>Ctrl</kbd>/<kbd>Shift</kbd>-click opens a bulk toolbar (complete, date, priority, move, tag, delete). There's undo for everything: a toast button or <kbd>Ctrl Z</kbd>.
- <kbd>Ctrl K</kbd> command palette to search tasks, lists, tags and habits, or run commands.
- Keyboard-first: <kbd>G</kbd> then a letter jumps to a view, <kbd>J</kbd>/<kbd>K</kbd> move between tasks, <kbd>1</kbd>–<kbd>3</kbd> set priority, <kbd>T</kbd> schedules for today, <kbd>C</kbd> completes, <kbd>/</kbd> filters. <kbd>?</kbd> lists them all.
- A Getting started card on Today ticks itself off as you try things, and a short guided tour spotlights each part of the app. Replay the tour from Settings → Help or search "tour" in <kbd>Ctrl K</kbd>. Settings → Help lists every command, shortcut and token.
- After an update, What's new walks you through every release you missed, not just the latest.
- Calm motion throughout: menus and dialogs ease in, and new rows rise into place. Settings → Animations follows your system setting, or turn it on or off.

**Calendar**
- Day, 3-Day, Week, Month and Agenda views, with an all-day row, a now-line, a mini month picker and keyboard shortcuts (<kbd>D</kbd> <kbd>X</kbd> <kbd>W</kbd> <kbd>M</kbd> <kbd>A</kbd> <kbd>T</kbd> <kbd>←</kbd> <kbd>→</kbd>).
- Click or drag on empty space to create a task or event inline.
- Drag blocks to move them, including between days. Drag their edges to resize. Everything snaps to 15 minutes.
- *Arrange Tasks* panel: drag unscheduled tasks onto the grid, or drag a block back to unschedule it.
- Overlapping items sit side by side, and Month view shows "+N more".
- Colour items by list, priority or tag. Show or hide completed tasks, habits and focus records.
- One-time, read-only `.ics` import (e.g. a Google Calendar export). Re-importing the same file updates the events instead of duplicating them.

**Eisenhower Matrix**: a view mode on any list, Today or Upcoming. Four quadrants derived from priority and due date, with adjustable rules (default: *important* = Medium/High priority, *urgent* = due within 2 days or overdue) and colours you can change. Dragging a task to another quadrant changes its attributes to match.

**Habits**:
- Goal types: complete once, count up (e.g. 8 glasses), or enter an amount (e.g. 5 km).
- Frequency: daily, specific weekdays, or X times a week. Streaks follow the frequency.
- Notes and mood for each check-in, groups, current and best streak, a monthly grid, a yearly heatmap, and weekly/monthly reviews.

**Focus**: Pomodoro and stopwatch timers linked to a task, with a set number of cycles or ∞ and today's sessions alongside.

**Countdowns** are calendar events: pin one and Today shows "23 days until …".

**Progress**: your week (tasks done, focus time, perfect days), your perfect-day streak, trophies with levels to climb, 14-day and 12-week charts, an activity heatmap and habit consistency, with optional sounds and celebrations. Share turns your week or month into an image card (numbers only, never task names) to save or copy.

**Voice (optional)**: hold <kbd>Ctrl Alt Space</kbd> (changeable) and speak a task, e.g. "call mom tomorrow at 5 priority high list family". Speech recognition runs on your computer with NVIDIA Parakeet after a one-time 482 MB download from Settings → Voice. Say commands too: "open inbox", "pause focus", "open mini window", or "finished <task>" (confirmed before it ticks anything).

**System**:
- Native notifications plus a reminder popup with *Done / Snooze / Open*, sized exactly to its cards.
- Runs in the tray, so reminders still fire after you close the window.
- Starts with your computer (in the tray); turn it off in Settings → General.
- Global <kbd>Ctrl Shift A</kbd> opens quick add from anywhere.
- A mini always-on-top window (<kbd>Ctrl Alt M</kbd>, the tray or the header) shows your current task, the focus timer or the matrix while you work in other apps.
- Backups are a single `.zip` with your data and note images; restore from `.zip` or older `.json` backups.
- Automatic updates: Momentum checks GitHub for a new release at launch and installs it with one click; you can turn this off in Settings → About & updates. The only other network request is the optional voice model download, which happens only when you start it.

**Design**: a calm, warm look in light, dark or system themes; 10 accent colours tuned for both themes, with Indigo as the default (the taskbar and tray icons take the same colour); a sidebar (left or right) or a single bar at the top or bottom; comfortable or compact density; adjustable text size and zoom; and a phone-style layout with a bottom bar when the window is narrow. Motion is subtle and respects reduced-motion settings. Keyboard navigation works throughout, and <kbd>?</kbd> shows a shortcut sheet.

## Screenshots

| | |
|---|---|
| ![Today](docs/screenshots/today.png) | ![Task drawer](docs/screenshots/list-drawer.png) |
| ![Today, dark](docs/screenshots/today-dark.png) | ![Month view](docs/screenshots/calendar-month.png) |
| ![A list in Matrix mode](docs/screenshots/matrix.png) | ![Habits](docs/screenshots/habits.png) |
| ![Focus](docs/screenshots/focus.png) | ![Progress](docs/screenshots/progress.png) |
| ![Bar at the top](docs/screenshots/layout-bar-top.png) | ![Bar at the bottom](docs/screenshots/layout-bar-bottom.png) |
| ![Settings](docs/screenshots/settings.png) | ![Guided tour](docs/screenshots/tour.png) |
| ![Narrow window](docs/screenshots/today-phone.png) | |

## Install

Download the latest installer from the **[Releases](../../releases)** page. After that, Momentum updates itself.

- **Windows:** `Momentum_x.y.z_x64-setup.exe` (or the `.msi`).
  > **SmartScreen warning:** Momentum isn't code-signed, so Windows may show *"Windows protected your PC"*. Click **More info → Run anyway**. This is normal for open-source apps without a paid certificate.
- **macOS:** the `.dmg` for your Mac (`aarch64` = Apple Silicon, `x64` = Intel); drag Momentum to Applications. The app isn't notarized by Apple yet (that needs a paid developer account), so the first launch says Apple *"could not verify Momentum is free of malware"*. Open it once and click **Done**, then go to **System Settings → Privacy & Security**, scroll to Security and click **Open Anyway** next to Momentum (on macOS 15 and later, right-click → Open no longer does this). If there's no Open Anyway button, or macOS says the app is *"damaged"*, run `xattr -dr com.apple.quarantine /Applications/Momentum.app` in Terminal and open it again. After the first launch it opens normally, and updates install without this step. Voice quick-add asks for microphone access the first time you use it.
- **Linux:** the `.AppImage` (make it executable) or the `.deb` / `.rpm`. The tray icon needs `libayatana-appindicator3` or `libappindicator3`, and voice needs ALSA (`libasound2`).

Your data lives in `%APPDATA%\com.momentum.planner\` on Windows (`~/Library/Application Support/com.momentum.planner/` on macOS, `~/.config/com.momentum.planner/` on Linux). The database is backed up automatically before every update that changes its structure. You can also export or restore a JSON backup from **Settings → Data**.

## Build from source

Prerequisites:
- [Node.js](https://nodejs.org) 20 or newer.
- [Rust](https://rustup.rs) (stable).
- The [Tauri prerequisites](https://tauri.app/start/prerequisites/) for your OS. On Windows that's the *Visual Studio Build Tools* with **Desktop development with C++**, plus WebView2, which is already included in Windows 10 and 11.

```bash
git clone https://github.com/prpiece/momentum.git
cd momentum
npm install
npm run tauri dev      # run the app with hot reload
npm test               # unit tests (recurrence, DST, matrix rules, streaks, NL parsing, …)
npm run tauri build    # installers → src-tauri/target/release/bundle/
```

`npm run dev` runs the UI alone in a browser, with sample data and no persistence. That's handy for UI work. `npm run screenshots` regenerates the images in `docs/screenshots/` from that build (it uses Microsoft Edge). In `tauri dev`, **Settings → Developer → Load sample data** fills the real database.

## Cutting a release

1. Bump the version in `package.json` and `src-tauri/tauri.conf.json` (and `src-tauri/Cargo.toml`).
   Add a `## vX.Y.Z` section to `CHANGELOG.md`: it tops the release notes and the app's "What's new" card.
2. Commit, then tag and push:
   ```bash
   git tag v0.2.0
   git push origin v0.2.0
   ```
3. The **Release** workflow (`.github/workflows/release.yml`) runs the tests, then builds Windows, macOS (Apple Silicon + Intel) and Linux installers with `tauri-action`, and attaches them to a **draft** GitHub Release.
4. Check the draft on GitHub, edit the notes and publish it. Publishing is what makes installed copies offer the update.

The workflow signs the update bundles with the `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` repository secrets. A fork needs its own key pair (`npx tauri signer generate`): put the public key in `plugins.updater.pubkey` in `tauri.conf.json` and point `endpoints` at the fork's releases.

## Tech

Tauri 2 (Rust) · React + TypeScript + Vite · Tailwind CSS v4 with CSS-variable design tokens · Zustand · SQLite (`tauri-plugin-sql`) with versioned migrations · dnd-kit · date-fns · rrule · chrono-node · ical.js · lucide-react · fonts bundled with @fontsource · Vitest.

Architecture notes and the decision log are in [PLAN.md](PLAN.md). Conventions for contributors (and AI agents) are in [CLAUDE.md](CLAUDE.md).

## Credits

Thanks to [@dalba0](https://github.com/dalba0) for the idea behind Momentum and for testing the app throughout.

## License

[MIT](LICENSE)
