# Mobile is an Expo (React Native) companion app

Supersedes ADR 0003. The iOS and Android apps are a separate Expo app in `mobile/`, with native UI written once for both phones. Desktop stays Tauri and is unchanged.

The phone app is a focused companion, not the whole desktop app:
- **On the phone:** Today, Inbox, Upcoming and lists; quick add; task details; search; the calendar; habits; the focus timer; reminders; account and sync.
- **Desktop only:** Board, Matrix, Timeline, Progress, voice, backgrounds and the power-user settings.

It shares code with desktop below the UI:
- `src/domain/`, which is pure TypeScript;
- the SQLite schema, migrations and sync triggers (`src-tauri/migrations/`);
- the sync engine and the stores, through a pluggable SQLite driver;
- the Supabase server and protocol, unchanged.

Why: Tauri mobile and Capacitor would reuse the desktop UI, but both render it in the phone's web view. The user wants the app to feel native, smooth gestures, sheets, transitions and keyboard included. Todoist reaches that feel by writing native UI on each platform and sharing only logic. One developer can't write the UI twice, so React Native gives native UI once for both, while keeping the TypeScript logic shared. Expo's EAS Build also signs and builds iOS without a Mac.

Rejected:
- **Flutter:** Dart, so nothing would be shared.
- **Fully native Swift and Kotlin:** two UIs and nothing shared.
- **Tauri mobile and Capacitor:** web-view feel.
- **The whole desktop app in React Native:** about 11,000 lines of UI to rewrite, for screens that don't suit a phone.
