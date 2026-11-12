# D2 · Journeys, content and states (Gate 1)

Status: **draft for approval**, combined with D3–D6 at the user's request (2026-11-12). Screens are on the Design canvas, "Momentum Phone redesign".
Tags: **Observed** (in the code or mocks), **Proposed** (new).

## 1. Task flows

Each flow lists where it starts, its steps, what proves it worked, and the ways out.

### F1 Capture from a cold start
- **Entry:** app icon, the Quick add widget, or Android's app shortcut.
- **Steps:**
  1. From the app icon, the app opens on Today (last tab remembered). From the widget, the + sheet is already open with the keyboard up.
  2. Type. Chips appear for each token (date, !priority, #tag, ~list, every…). Tapping a chip offers a picker or removal.
  3. Return adds the task. The sheet stays open for the next one, and its field is cleared.
- **Success:** the row appears in its group behind the sheet, and a light tick plays when it's added.
- **Exits:** swipe the sheet down. If text is half-typed, the draft is kept until the next +.
- **Budget:** ≤ 3 taps from the widget, one-handed.
- **Context defaults:** opened from a list, the task goes to that list. From the calendar, it gets that day. From Today, it gets today (`withDefaults`, D220).

### F2 Complete with undo
- **Entry:** any task row, the Today widget or a notification action.
- **Steps:** tap the ring, or swipe the row right past the threshold.
- **Success:** the ring fills and a light haptic plays. The row moves to Done after 600 ms (shortened under reduced motion), and the toast "Completed 'X' · Undo" shows for 6 s.
- **Exits:** Undo in the toast, or tap the ring in Done.
- **Recurring task:** the next occurrence appears in place. The toast reads "Next: Fri 20 Nov".

### F3 Reschedule
- **Entry:**
  - "Reschedule" on the Overdue header: one date picker applies to all overdue tasks.
  - Swipe a row left.
  - The Due row in the task sheet.
  - Dragging in the calendar.
- **Picker:** Today, Tomorrow, This weekend, Next week, Pick a date…, No date.
- **Success:** the row moves to its new group, with the toast "Moved to Fri 13 Nov · Undo".

### F4 Plan the day in the calendar
- **Entry:** Calendar tab, which opens on the view used last (agenda by default).
- **Create:** tap an empty slot. The + sheet opens prefilled with that time, the Event/Task switch is visible, and times snap to 15 min.
- **Move:**
  1. Press and hold for 350 ms (Observed). The block lifts with a haptic tick.
  2. Drag. The time label updates live, and moving into another day column moves the item to that day.
  3. Let go. The change saves and an Undo toast shows.
- **Resize:** drag the bottom handle. A top handle is Proposed, for blocks 48 px or taller.
- **Exits:** dropping back where it started, or a system interruption, cancels the move.
- **Visible alternative:** the event sheet's Start and End rows.

### F5 Check in a habit
- **Entry:** Habits tab, the Habits widget, or the streak reminder notification.
- **Once:** tap the ring.
- **Count:** tap adds 1. Press and hold opens a number pad.
- **Limit:** tap opens a stepper sheet with "12 / 30 min".
- **Quit:** "Slip" opens a confirm sheet, with an optional count.
- **Success:** the ring fills, a light haptic plays, the streak number updates, and the row moves to Done.
- **Exits:** tap again to undo a once-kind; a stepper's minus button undoes a count.

### F6 Start focus
- **Entry:**
  - "Start focus" in the task sheet.
  - Browse → Focus.
  - The "Focus starts now" notification (D245).
  - The running-focus bar.
- **Steps:** choose the task (optional), choose Focus/Short/Long or Stopwatch, then Start.
- **While running:** a bar shows on every tab, a Live Activity on iOS, and an ongoing notification on Android. A phase end sends a notification (D230).
- **Exits:** Pause, Stop (asks "End session? 12 min will be saved") or Skip.

### F7 Act on a reminder notification
- **Entry:** a notification with Done and Snooze 10 min actions (Observed, D230).
- **Paths:**
  - Done or Snooze: handled without opening the app, or on next start if the app was killed (Observed).
  - Tapping the notification body: opens the task sheet over Today.
  - The item was deleted meanwhile: the "was deleted" sheet (canvas row 2).

### F8 Sign in on a phone when desktop already has data
- **Entry:** Welcome "I use Momentum on a computer", the Getting started item "Sync with your computer", or Browse → account row.
- **Steps:**
  1. Enter email and tick the consent box.
  2. Enter the 6-digit code (Observed).
  3. If the phone already has local tasks, choose: "Add this phone's tasks to your account" or "Remove them" (D226d).
  4. Syncing shows "Bringing in 1,240 tasks…", then a sync line.
- **Exits:** Back at each step. A wrong code shows "That code didn't work. Check the email or send a new one."

### F9 Delete account
- **Entry:** Browse → account → Delete account.
- **Steps:**
  1. An explanation: "Your account and synced data are deleted after 7 days. This phone keeps its copy."
  2. Type DELETE to confirm, then request.
  3. The phone signs out at once and keeps its data (D231).
- **Signing in within the 7 days:** a "Keep my account" banner shows (Observed).

### F10 First run (onboarding, S14)
- **Steps:** Welcome → first task → optional habit → Today with the Getting started card (canvas row 4).

## 2. Content inventory: messy data the screens must survive

| Case | Where it bites | Design response |
|---|---|---|
| A 140-character title | Rows, widget, Live Activity | Rows wrap to 2 lines, then end with "…". The sheet title wraps fully. Widgets use 1 line. |
| 6 tags plus a list plus a time | Row meta line | The meta wraps to a second line. Never clipped mid-tag. |
| 30 tasks today | Today | Groups collapse. The Done group starts collapsed. The header count stays accurate. |
| 0 tasks today, 12 overdue | Today | Overdue first, with "Reschedule all" prominent. The progress line reads "0 of 0 due today · 12 overdue". |
| Overlapping events (4 at 10:00) | Day and 3-day views | Side-by-side columns from `layoutDay`. Below 44 px wide, show "+2", which opens a list. |
| An all-day event plus a 3-day event | All-day row | The bar spans its days. Past 2 rows, show "+N more". |
| A 400-day streak | Habit row, widget | "400" uses tabular numbers. The widget shows "400 d". |
| 50 lists in 6 folders | Browse | Folders are collapsible and remember their state. Search finds lists too. |
| A note with a desktop image | Task sheet | Placeholder "Image on desktop" (attachments don't sync, D229). |
| Emoji and RTL names | Rows, headers | They render as typed. No truncation inside a grapheme. |
| Largest system text | Everything | Canvas "Largest text size". Rows grow and nothing has a fixed height. |

## 3. State matrix

Every screen answers each of these states. "—" means the state can't happen on that screen.

| State | Today and lists | Calendar | Habits | Task/event sheet | Focus | Browse/account | Widgets |
|---|---|---|---|---|---|---|---|
| **First launch** | Onboarding, then Getting started | Empty agenda: "Nothing scheduled. Tap a time to add." | One starter habit or an empty state: "Build, limit or quit a habit" | — | Ready, no task picked | "Sign in to sync" row | "Open Momentum to set up" |
| **Signed out** | Normal (local-first) | Normal | Normal | Normal | Normal | Sign-in row | Normal |
| **Syncing** | Silent. Sync line only on first sync or a large pull | Silent | Silent | Silent | — | "Syncing…" | — |
| **Offline** | Quiet line under the title: "Offline · N changes will sync" | Same line | Same line | Edits save locally, no banner | Works | "Offline · last synced 09:12" | Shows the last snapshot |
| **Sync error** | Danger-soft banner with Retry (canvas) | Same | Same | — | — | Error and Details | Shows the last snapshot |
| **Session ended** (server revoked) | Toast: "Signed out on this phone. Your data is kept." | — | — | — | — | Sign-in row | — |
| **Update required** (server rejects the protocol) *(Proposed)* | Full-width banner: "Update Momentum to keep syncing" with a store link. The app still works offline | — | — | — | — | Same banner | — |
| **Empty** | Teaching empty state per list: "Nothing here. Tap + to add to Chemistry" | Empty agenda line | See first launch | — | — | — | "All clear for today" |
| **Long content** | See §2 | See §2 | See §2 | Scrolls inside the sheet; the footer stays pinned | Long task name wraps | — | Truncated |
| **Keyboard open** | The + sheet sits above the keyboard (KeyboardAvoidingView, missing today) | Same | Same | The field being edited scrolls into view | — | Forms scroll | — |
| **Notifications: not asked** | — | — | — | Reminder picker shows the ask card (canvas) | Phase-end alert asked the first time a session starts | Settings → Notifications shows "Allow" | — |
| **Notifications: denied or revoked** | — | — | — | The reminder picker warns, with Open settings | "Alerts are off" under the timer | Settings: "Off in phone settings" plus Open | — |
| **Android exact alarms denied** | — | — | — | Reminder picker: "Reminders may be a few minutes late · Allow exact alarms" | Same | Settings row (Observed) | — |
| **Opened item deleted meanwhile** | — | — | Habit: "This habit was deleted" sheet | The "was deleted" sheet (canvas) | The timer keeps running, with the task label struck through | — | Row disappears on next refresh |
| **Note with a desktop image** | — | — | — | Placeholder block | — | — | — |
| **Fold or unfold** | The open sheet becomes the side pane and back; scroll is kept (D249) | Same, event pane | Habit detail pane | — | Stays full screen | Detail pane | — |
