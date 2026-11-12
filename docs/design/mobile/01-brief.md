# D1 · Phone app design ideas (Gate 0)

Status: **approved** (2026-11-12): Q1–Q6 yes; Q4 widened so folders are managed on the phone too. Draft screens for the next gates: the Design canvas "Momentum Phone redesign" (https://claude.ai/artifact/6wKYNAEtYNgEMyahq5DqnC), built on the v1.0 phone mocks in `docs/mocks/momentum.html`. Decisions it builds on: D224, D228, D229, D246–D250, ADR 0006.
Tags: **Observed** (seen in the code, mocks or screenshots), **Adapted** (taken from desktop or the narrow layout), **Proposed** (new, needs your yes).

## 1. What this is

A redesign of the Phone app that already runs. The current screens were built "plain on purpose" (`mobile/src/ui/kit.tsx`) to prove the shared domain, sync and reminders on a phone. They work, but nothing about them was designed. This gate fixes the brief and the scope. No screens are designed yet.

## 2. Product, audience, job

- **Product:** a local-first planner (tasks, calendar, habits, focus) whose main home is the desktop. The phone is the **companion you carry**: it shows the same data, synced. *(Observed: ADR 0006)*
- **Audience:** the same people who use desktop, mostly students and solo planners (the mocks' data is school, lab work and errands). They plan on desktop and act on the phone. *(Adapted: mocks; inference, please confirm)*
- **Primary job on the phone:** **capture and act in under 10 seconds, one-handed.** Get a thought in, see what's next, tick it off, check in a habit, and answer a reminder. *(Proposed)*
- **Secondary jobs:** glance at and adjust today's calendar, run a focus session, and review a list.
- **Not a phone job:** heavy organising (folders, sections, Board, Matrix, Timeline, Progress). That stays on desktop. *(Observed: D229)*

## 3. Device contexts

| Context | What it means for design |
|---|---|
| One hand, walking, standing in a queue | Primary actions in the thumb zone. Capture from any tab. Big targets. |
| Notification first (a reminder, a streak at risk) | Open straight to the item, act and leave. Handle an item deleted meanwhile. |
| Offline (a train, a lecture hall) | Everything works. Sync is invisible until it matters. |
| Unfolded Fold, spanned Duo, tablet | Expanded: two panes, designed (D249). |
| Flip main screen (22:9), Fold cover screen | Compact, a tall and narrow phone. |
| Large system text, screen readers | Layouts reflow, nothing is clipped, every control is labelled. |

## 4. Current design observed

**Navigation:** five tabs: Today · Lists · Calendar · Habits · More. Task, event and habit details open as modals. Inbox, Upcoming, Search, Focus, Account, Settings, What's new and Report are pushed screens.

**What works, and is kept unless we decide otherwise:**
- Quick add parses the full desktop grammar and shows live chips (`AddBox`).
- Completing a task gives an Undo toast.
- The calendar has day, 3-day, month and agenda views. You can press and hold to move an item, drag its edge to resize it, and tap empty space to create one, snapped to 15 minutes.
- Habits support once, count, limit and quit check-ins, a streak, and a past-year map.
- Focus offers a timer or stopwatch on a task, and it survives sleep.
- Settings has a draft with Save or Discard, and covers the permission states: denied, and Android exact alarms.
- Account covers the full sign-in, sync, devices, sign-out and delete-account flows.
- Dark mode and all 10 accents come from the desktop tokens.

**Problems, as observations to confirm:**
1. **No visual system.** Only colours are tokens. Type sizes, spacing and radii are typed by hand in every file. This is the "generic" look.
2. **Capture lives at the top of lists.** The field sits up where the thumb can't reach, and it isn't available from Calendar, Habits or More. The narrow layout puts a central **+** in the tab bar instead.
3. **Today is a flat list,** sorted by date. The narrow layout and the mocks group it into Overdue, Today and Done, with a "3 of 10 done" line and Reschedule.
4. **Task details is one long form.** Every field shows at once: date, time, repeat, reminders, priority, list, tags, notes and subtasks. Tags are a comma-separated text field.
5. **Lists is read-only.** You can't create, rename or delete a list. Is that intended (organise on desktop) or a gap?
6. **Habits are only partly editable.** Frequency, schedule and colour can't be edited, and the "amount" kind shows as "count".
7. **There's no completed view anywhere.** Lists show open tasks only.
8. **Not native in feel yet:** no haptics, no motion, no swipe actions, no pull-down, no keyboard avoidance. Large text isn't handled (fixed row and block heights). Many touch areas have no screen-reader labels.
9. **Sync and offline only show up in More and Account.** A sync error is invisible elsewhere.
10. **There are no expanded or landscape layouts** (D249 makes them required).

## 5. What carries over from desktop, and what doesn't

| Carries over *(Adapted)* | Doesn't carry over |
|---|---|
| Colour tokens, the 10 accents, light and dark surfaces (D198, D250) | Keyboard shortcuts, the command palette, `<Keys>` |
| "Calm, precise, warm"; weight does hierarchy, not colour | Hover states, tooltips, right-click menus |
| No glass, gradients, glows or emoji in the chrome; one shadow, for floating layers | Dense multi-pane views on a compact phone |
| Inter for UI. Bricolage only for page titles and big numbers. Mono only for focus digits | The 36px row: phone rows go two-line, 52px+ (narrow layout) |
| Lucide icons, one stroke width. The phone uses Feather today, so this is a switch | Desktop-only features (D229 list) |
| Natural-language tokens and chips (D219) | Window chrome, tray, mini window, quick-add popup |
| Undo on destructive or completing actions | |

## 6. Scope, item by item

The feature set is D229's and doesn't change (round-1 grilling, Q3). The table records what the redesign must design for each area, and marks the gaps found in §4 as questions.

| # | Area | Designed in the redesign | Open question |
|---|---|---|---|
| S1 | Today | Grouped (Overdue, Today, Done), progress line, reschedule overdue | — |
| S2 | Inbox, Upcoming, lists | List screens with sections and subtasks (D196); create, rename and delete lists **and folders** | Sections stay desktop-only |
| S3 | Quick add | One entry reachable from every tab, keyboard-first, chips you can tap to fix | — |
| S4 | Task details | Sheet with progressive disclosure; tags and reminders as pickers | — |
| S5 | Search | Field with results; filters only if D2 shows the need | — |
| S6 | Calendar | Day, 3-day, month and agenda; create, move and resize; event details | — |
| S7 | Habits | Today's habits; the five check-in kinds; streak; year map; create and edit everything, frequency, schedule and colour included | — |
| S8 | Focus | Timer and stopwatch on a task; phase-end alert | — |
| S9 | Reminders | Permission moment, denied and exact-alarm states, notification actions | — |
| S10 | Account | Sign-in, handle, devices, sign-out, delete | — |
| S11 | Settings | Theme, accent, week start, time format, notifications, About | — |
| S12 | Completed tasks | A collapsed Done group in Today and in each list; tap to un-complete. No logbook screen | — |
| S13 | Expanded layouts | Two-pane for S1–S8 (D249) | — |
| S14 | Onboarding *(added 2026-11-12)* | Welcome → type a first task (the parser teaches tokens) → optional starter habit → Today with a dismissible Getting started checklist. No account wall, no permission asks, everything after the first task can be skipped | Replaces D246's "no onboarding" |
| S15 | Widgets *(added 2026-11-12, scope addition)* | Quick add (small), Today (medium/large, tap to complete), Habits (small/medium, tap to check in), lock-screen tasks-left / habits / next item, Focus Live Activity (iOS) or ongoing notification (Android) | Android tap actions are unverified in `expo-widgets`; check before promising them |

## 7. D1's answers (D246)

- **First run:** straight into Today, no account. Empty states teach.
- **Haptics:** light ticks on complete, habit check-in and drag pickup only, following the OS setting.
- **Accents:** all desktop presets, synced, none phone-only.
- **Onboarding:** ~~none beyond teaching empty states~~ **amended 2026-11-12:** a short act-first onboarding (S14). The research behind it: the app should deliver value within about a minute, explain features as people reach them, and ask for sign-in and permissions only in context. From Todoist: example tasks that show natural-language entry, and Google, Apple or email sign-in (Momentum keeps sign-in optional, D105).

## 8. Risks

- **A "native feel" without a native UI kit:** React Native draws its own controls, so feel comes from gestures, haptics, sheets and motion. Those have to be specified, not assumed.
- **One design for iOS and Android:** D3 decides what differs, such as back gestures, date pickers and sheets.
- **Foldables:** expanded layouts double the screens to wireframe.
- **Large text breaks fixed-height calendar blocks and rows.**

## 9. Success, and how we'll know

- Capture from a cold start in **≤ 3 taps**, from any tab, one-handed. *(Proposed)*
- Every D2 flow can be finished at the largest text size and with a screen reader.
- No screen shows a state without feedback: offline, syncing, a sync error, permission denied, an item deleted.
- The redesign passes the anti-slop gate. Asked "does it still make sense in plain styling?", the answer is yes.
- Against the current app, every screen shows fewer competing elements, not more.

## 10. Inputs used

The built app (`mobile/src`, inventoried 2026-11-12), the D229 scope, `docs/mocks/momentum.html` (`#today-phone`, `#list-phone`), `docs/screenshots/today-phone.png` (narrow layout), `docs/design/brief.md`, `docs/design/momentum-tokens.css` and the CLAUDE.md visual rules. **Missing:** screenshots of the Phone app running on a device (Q2).
