# D3 · Reference ledger and direction (Gate 2)

Status: **draft for approval**, combined with D2 and D4–D6.

How to read the ledger:
- References are **Observed** from the shipped apps' public behaviour, from memory plus the Todoist help pages. Verify the details on a device before copying any measurement.
- **Adapted** means we take the reason behind a pattern, never the visuals.
- Nothing here is a screenshot copy.

## 1. Ledger

| Product · area | What it does (Observed) | Why it works | Momentum takes (Adapted) | Rejected |
|---|---|---|---|---|
| **Todoist** · quick add | A floating + on every list. NL parsing highlights dates, #project, @label and p1 inline. The add-task widget can preset a project or due date (MacStories). | Capture is one gesture from anywhere, and the parser's feedback teaches the syntax. | One + in the tab bar's centre, from every tab. Highlighted tokens and chips (D219). The Quick add widget can preset a list. | Labels and projects as separate concepts (Momentum has list and #tag). |
| **Todoist** · rows | Swipe right to complete, swipe left to schedule. Both are configurable. | Two most frequent actions at thumb distance, each with a visible fallback. | Same two directions, fixed (no setting yet). | Long-swipe-to-delete: destructive and easy to trigger by accident. |
| **Todoist** · onboarding | Example tasks show natural language; sign-in is with Google, Apple or email. | Teaching happens inside the real input. | First-task step with tappable examples. | A mandatory account (we're local-first). |
| **Things 3** · Today | "Today" and "This Evening" groups, a calm list, and a "Magic Plus" button you can drag into position. | Grouping by when, not by list. Very low chrome. | Overdue, Today and Done groups. Calm rows with weight-based hierarchy. | Drag-to-place plus (undiscoverable; our + is fixed). |
| **TickTick** · tabs | Customisable tab bar with Calendar, Habits and Focus as tabs. | One app for tasks, habits and focus, like ours. | Tasks, Calendar and Habits as tabs. Focus reached from a task and a running bar. | A customisable tab bar for v1 (settings weight; revisit later). |
| **Apple Reminders** · lists | Grouped lists with smart lists at the top and inline new-list. | Smart lists before user lists makes it easy to find your way around. | Browse puts Inbox and Upcoming first, then folders and lists. | — |
| **Microsoft To Do** · My Day | A daily list you plan each morning. | A deliberate daily plan. | Today already comes from due dates. No separate "My Day". | A second "today" concept. |
| **Apple Calendar** · month | Month grid with dots; tapping a day shows its list underneath. | Fits a phone width without event text in cells. | Month view with dots and that day's agenda below (canvas). | — |
| **Google Calendar** · 3-day | 3-day view, pinch to zoom hours, tap a slot to create, press and hold to drag. | Dense enough to plan, still readable. | 3-day and Day views. Tap to create; press and hold to move (Observed in our build). | Pinch-zoom in v1 (gesture conflict with scroll; later). |
| **Fantastical** · NL events | Natural-language event entry with a live parse. | Same as our quick add. | Event creation goes through the same + sheet with an Event/Task switch. | — |
| **Streaks** · habits | Big circular targets, tap and hold to complete. | Fast and satisfying. | Large rings for check-in. | Tap-and-hold as the only way (undiscoverable; we use a tap). |
| **Loop Habit Tracker** · history | Score and history grid per habit. | Long-term view motivates. | The past-year map in habit detail (Observed in our build). | Score maths (our streak rules are D217). |

## 2. Decisions the tickets asked D3 to make

| Decision | Choice | Why |
|---|---|---|
| Tab set and order | **Today · Calendar · + · Habits · Browse** | The v1.0 mock's shape. Progress is desktop-only, so its slot becomes Browse (Inbox, Upcoming, lists, folders, search, Focus, settings, account). |
| Sheets or full screens | **A sheet** for task details, quick add, reminder, event create and check-in steppers (keeps context). **Full screen** for Focus, Search, Settings, Account, a list and habit detail (their own scroll and navigation). On expanded widths the sheets become the side pane. | The anti-slop rule "bottom-sheet everything": a sheet only where the context underneath matters. |
| iOS vs Android | **One design.** Platform behaviour is kept for: back (swipe from the edge on iOS, the system back on Android), date and time pickers (native), sheets (iOS detents vs Material bottom sheet with a scrim), switches (native), the notification permission dialog, haptics (iOS impact light vs Android `CLOCK_TICK`), and live progress (Live Activity vs ongoing notification). | Shared visual language, native behaviour where people expect it. |
| When to ask for notifications | **When the first reminder is set, or the first focus session starts.** Never on launch or in onboarding. | Permission asked in context, with a reason and a fallback (canvas row 2). |
| Row swipe actions | **Right = complete, left = reschedule.** No swipe-to-delete. Delete lives in the sheet. Each has a visible alternative: the ring, and the Due row. | Consequential actions are never gesture-only. |

## 3. Directions

**A · Calm list (chosen).**
- **What it is:** the v1.0 phone mock carried forward. Grouped lists, the + in the centre, sheets for detail, weight-based hierarchy, no cards except grouped settings and habits.
- **Fit:** closest to desktop, so one product. Strongest for capture and check-off.
- **Risk:** it can feel plain, so identity comes from Bricolage titles, the accent on the one primary action, and haptics and motion on completion.

**B · Day-timeline first.**
- **What it is:** Today becomes a vertical timeline (timed items placed by hour, untimed in a strip on top), like a planner app.
- **Fit:** great for heavy calendar users.
- **Risk:** weaker for students whose tasks mostly have no time. It duplicates the Calendar tab, and it's harder at the largest text size. **Kept as an option** for the Calendar's Day view only.

**C · Dashboard home (rejected).**
- **What it is:** a home of cards (today's progress, a habits ring, a focus card, next event).
- **Why rejected:** this is the anti-slop "data-card wallpaper" pattern. It hides the list behind summaries and adds a tap to every job.
