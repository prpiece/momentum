# D6 · Handoff (Gate 5)

Status: **approved 2026-11-12** (D254): `02`–`06` and the canvas, done together in one pass at the user's request. This is the input to R1.

- **Canvas:** "Momentum Phone redesign", https://claude.ai/artifact/6wKYNAEtYNgEMyahq5DqnC (private; share it from the page if others need it).
- **Brief:** `01-brief.md`. **Flows and states:** `02`. **Research and direction:** `03`. **System, motion and gestures:** `04`.
- D5 (wireframes) went straight to mid-fidelity on the canvas; there's no separate low-fidelity set.

## 1. Screen index

| Screen | Canvas artboard(s) | Presentation | Route today (Observed) → R1 |
|---|---|---|---|
| Today | Today, Flip, Largest text, First run, Offline/error, Complete+undo | Tab | `(tabs)/index` |
| List (Inbox, Upcoming, any list) | List · Chemistry | Pushed | `list/[id]` |
| Task details | Task sheet; Unfolded · Today + task | Sheet (pane when expanded) | `task/[id]` modal → sheet with detents |
| Quick add | Quick add; Onboarding 2 | Sheet over the keyboard | inline `AddBox` → global sheet from + |
| Calendar | Agenda, 3 days, Month, Landscape; Unfolded · Calendar + event | Tab | `(tabs)/calendar` |
| Event details | Event sheet | Sheet (pane when expanded) | `event/[id]` modal → sheet |
| Habits | Habits | Tab | `(tabs)/habits` |
| Habit detail | Habit detail | Pushed | `habit/[id]` modal → pushed screen |
| Focus | Focus | Full-screen modal; a bar while running | `focus` |
| Browse | Browse | Tab | replaces `(tabs)/lists` and `(tabs)/more` |
| Search | Search | Pushed, keyboard up | `search` |
| Settings | Settings (+ update required) | Pushed | `settings` |
| Account and sign-in | Account; Sign in (email, code, merge) | Pushed | `account` split into sign-in and account |
| Onboarding | Onboarding 1–4 | Stack before the tabs, first run only | new |
| Reminder picker and permission | First reminder · permission | Sheet | inside `task/[id]` |
| Deleted item | Opened from a reminder · deleted | Sheet | inside `task/[id]` ("This task was deleted.") |
| Widgets | Widgets · home, lock + focus | OS widgets | new (`expo-widgets`) |

## 2. Component inventory

| Component | States | Built on | Notes |
|---|---|---|---|
| `TabBar` / `Rail` | active, badge (none yet) | Expo Router `Tabs` with a custom `tabBar`; rail when expanded | The + opens the quick-add sheet; it isn't a route. |
| `TaskRow` | open, done, overdue, selected (expanded), dragging, swiping | `Pressable` + RNGH `Swipeable`-style pan + Reanimated | Exists (`ui/TaskRow.tsx`). Add swipe, the 44 hit area on the ring, label, and wrapping meta. |
| `Ring` (task checkbox) | priority colour × open/done; disabled | `Pressable`, `accessibilityRole="checkbox"` | Exists inside TaskRow. Extract. |
| `GroupHeader` | expanded, collapsed, with action | `Pressable` | OVERDUE · Reschedule; Done collapsed. |
| `ProgressLine` | 0–100 | `View` | Today header. |
| `Sheet` | detents (medium, large), keyboard, dismissing | **Proposed:** a small Reanimated sheet in `ui/`, or a native sheet (Expo Router `presentation: "formSheet"` with detents) | Decide in R1 with the ponytail ladder: the native `formSheet` first. |
| `FieldRow` | value, empty ("Add…"), destructive | `Pressable` | The task, event, settings and account rows. |
| `ChipBar` | parsed token, removable, picker-open | `ScrollView` horizontal | Exists in AddBox (read-only). Make chips tappable. |
| `QuickAddSheet` | empty, typing, parsed, submitting, draft kept | `Sheet` + `TextInput` + `ChipBar` + tool row | Uses `createFromText` with context defaults (D220). |
| `Toast` | info, undo, error | Exists (`ui/Toast.tsx`) | Restyle inverted. Place above the tab bar plus the focus bar. |
| `Banner` | offline (quiet line), error, update required | `View` with `accessibilityRole="alert"` for errors | New. |
| `EmptyState` | per screen | `View` | Exists (`Empty`). Copy per §3 of `02`. |
| `CalendarGrid` | day, 3-day, week (landscape) | Existing grid + `layoutDay` | Add lift, haptics and the live time label; fix the drag past the grid end. |
| `MonthGrid` | selected, today, out-of-month, dots | `View` grid | Replace the chips with dots plus that day's agenda. |
| `HabitRow` + `CheckIn` | once, count, limit, quit; done | `Pressable`, SVG ring | Rings via `react-native-svg`. |
| `YearMap` | levels 0–4, tap to fix a day | SVG or `View` grid | Exists (53×7). Add a legend and tap. |
| `FocusBar` | running, paused | Absolute `View` over the tabs | New. |
| `GettingStartedCard` | items, progress, dismissed | `View` | **Reuse** `gettingStartedItems` (`src/domain/features.ts`) with phone items; add the feature entries. |
| `OnboardingStack` | 4 steps, skip | Expo Router stack | Writes an `onboarded` flag to `sync_state` (device-local). |
| `Widgets` | Quick add, Today, Habits, lock accessories, Focus Live Activity | `expo-widgets` + `@expo/ui` | The app calls `updateSnapshot` wherever `notify.ts` reschedules today, after store changes and pulls. |

## 3. Accessibility

- **Labels:** every `Pressable` gets a label, for example "Complete Study chem, due today 17:00, medium priority". The audit found NavRow, calendar nav, all-day chips and month items unlabelled.
- **Roles and state:** the ring is `checkbox` with `checked`; tabs are `tab` with `selected`; switches are native; banners use `alert` for errors and the polite live region for offline.
- **Text size:** every role scales (`04` §1). No fixed heights on rows or blocks. The calendar block's minimum height grows with the font scale; the grid hour height scales up to 1.6×.
- **Focus order:** title, then the primary action, then groups. In sheets, focus moves to the title on open and returns to the row on close.
- **Announcements:**
  - Complete: "Completed Study chem. Undo available."
  - Move: "Moved to Friday 16:30."
  - Sync error: "Couldn't sync. Changes are safe on this phone."
- **Contrast:** tokens pass WCAG AA (`tokens.test.ts`). Text on the soft fills (accent-soft, success-soft, danger-soft) stays `fg`.
- **Gestures:** every gesture has a visible alternative (`04` §7). VoiceOver and TalkBack users get custom actions on rows: Complete, Reschedule, Open.

## 4. Motion spec (summary; the tokens are in `04` §5)

| Moment | Trigger | Motion | Reduced motion |
|---|---|---|---|
| Sheet open/close | +, row tap, swipe down | `spring.sheet`, follows the finger | Crossfade, 150 ms |
| Complete | Ring tap or swipe | Ring fill 150 ms; the row leaves for Done after 600 ms with a 180 ms collapse | Instant move; the toast still shows |
| Drag in the calendar | Hold 350 ms | `spring.lift`, settle 180 ms on drop | No scale; position only |
| Group collapse | Header tap | Height and opacity, 180 ms | Instant |
| Fold / unfold | Window resize | The pane fades in at 220 ms; content keeps its scroll | Instant |
| Toast | Any undoable action | Slides up 12 px and fades in, 180 ms | Fade only |

## 5. Build notes for R1 (`/ponytail`)

- **New dependencies:** `expo-haptics`, `lucide-react-native` + `react-native-svg`, `expo-widgets`. Each needs a line in PLAN §4. Install with `npx expo install`, which requires a new dev build.
- **Reuse:** `layoutDay`, `withDefaults`/`createFromText`, `gettingStartedItems`, `upcomingFires`, the settings draft, `notify.ts`'s change hook (it also drives widget snapshots).
- **Gaps from the inventory that R1 must close:**
  - KeyboardAvoidingView in the sheets;
  - safe-area insets on every screen;
  - font scaling;
  - labels;
  - list and folder create/rename/delete (S2);
  - full habit editing (S7);
  - the Done group (S12);
  - the amount habit kind showing as count (`habit/[id].tsx:77`).
- **Hypotheses to test on devices:** the swipe thresholds (35%), the 350 ms hold, the 600 ms delay before a completed row moves, and whether people find Browse for Focus. Recorded as hypotheses, not facts.

## 6. Open items

- **Widgets on Android:** tap-to-complete is documented for iOS 17+ only. Confirm `expo-widgets` Android button support, or fall back to "tap opens the app".
- **"Restore task" on the deleted sheet:** confirm that a task deleted on desktop can still be restored from the phone (it depends on trash syncing).
- **The 'update required' trigger:** there is no protocol-version check in the sync code today; it needs a server signal.
- **D7 (store assets)** stays separate and waits for listing.
