# Mobile apps are Tauri 2 mobile

The future iOS and Android apps are Tauri 2 mobile builds of this same React UI, `src/domain/` and SQLite store, so the sync client is written once in TypeScript and shared by every platform. The UI redo is therefore mobile-aware from the start: touch targets and a narrow layout. React Native (new UI, shared domain) and native apps (nothing shared) were rejected as two or three times the work for one developer.
