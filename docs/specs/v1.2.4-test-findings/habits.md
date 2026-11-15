# Habits, focus, matrix, smart lists (HAB)

Scope: src/domain/{habits,stats,focus,matrix,taskViews}.ts, src/features/{habits,focus,progress}/. Part of the [v1.2.4 test findings](README.md). Each entry says whether a probe test proved it or it rests on reading the code; prove it with a failing test before fixing (the v1.2.1 rule).

### HAB-01 · high · bug · Running focus timer is lost on quit, crash or update restart
- [ ] Status: open
- Where: src/stores/focus.ts (timer lives only in `useFocus` memory), src/lib/os.ts (no close/quit hook calls stopFocus)
- Proven: reasoning only (grep: no persistence of `timer`, no onCloseRequested/beforeunload touching focus)
- What happens: the timer state is never written to SQLite or storage; a session is only recorded by stop/advance. Closing the app (not hidden to tray), a crash, a reboot or the auto-updater restart mid-session drops the whole session: no focus_session row, no time credited to the task.
- Repro: start stopwatch on a task, work 90 min, quit the app (or let it update). Focus time for that block is 0.
- Expected: session saved on quit, or timer state persisted and restored.
- Suggested fix: on window close / app exit call `stopFocus()` (records the session); better, persist `timer` JSON on each change and restore it in `hydrateFocus`.

### HAB-02 · medium · bug · Decimal amount/count target below 1 is silently treated as 1
- [ ] Status: open
- Where: src/domain/habits.ts:78 `targetOf` (`Math.max(1, h.goal.target)`); the dialog allows it: src/features/habits/HabitDialog.tsx:135 (`min={0.1}`), parseGoal accepts any >0
- Proven: yes. Goal `{kind:"amount", target:0.5, unit:"L", period:"day"}`: `targetOf` = 1, `isDone(h, 0.5)` = false (expected true).
- What happens: a "0.5 L a day" habit can never be completed with 0.5; ring, streak, completion rate and heatmap all use target 1. The goal label still says 0.5.
- Expected: target honoured.
- Suggested fix: use `h.goal.target` directly (parseGoal already guarantees > 0).

### HAB-03 · medium · bug · Focus time is bucketed by calendar day, ignoring End-of-day hour
- [ ] Status: open
- Where: src/features/focus/FocusView.tsx:40 `minutesPerDay`, :101 `todays` filter; src/features/progress/ProgressView.tsx:41 `focusMinutes` (all use `toLocalDate(new Date(s.startAt))`); contrast src/domain/stats.ts:7 `localDay` which uses `todayLocal(new Date(iso))`
- Proven: yes (dayEndHour=3, instant Mon 01:00: `todayLocal` = Sun, `toLocalDate` = Mon).
- What happens: with End-of-day 3am a 01:00 focus session counts on the next calendar day: missing from the Focus page "today" list and total, drawn on a day beyond "today" in the 14-day chart (not shown), week totals off at the boundary. Tasks completed use the shifted day, so the two disagree.
- Expected: same day rule as tasks and habits.
- Suggested fix: replace with `todayLocal(new Date(s.startAt))` in the three places (one shared `sessionDay` helper).

### HAB-04 · medium · bug · Switching the task mid-session credits the whole session to the new task
- [ ] Status: open
- Where: src/stores/focus.ts `setFocusTask` + src/domain/focus.ts `sessionOf` (reads `s.taskId` at stop time)
- Proven: yes (stopwatch on A, taskId set to B at 59 min, stop: session.taskId "B", 3540 s).
- What happens: changing the picker during a running timer rewrites taskId; elapsed time before the switch moves to the new task.
- Expected: time before the switch stays on A.
- Suggested fix: in `setFocusTask`, when the task changes and elapsed >= 60 s, record a session for the old task up to now and restart accumulation (accumulatedMs=0, sessionStart=now).

### HAB-05 · medium · bug · Stopwatch keeps counting through sleep/hibernate and inflates focus time
- [ ] Status: open
- Where: src/domain/focus.ts `elapsedMs` / `sessionOf` (wall-clock only, no cap)
- Proven: yes (stopwatch started, stopped 9 h later: one 9 h session).
- What happens: wall-clock derivation is right against timer throttling but not against sleep/lock/forgotten timers: a laptop lid closed overnight yields a 9 h session credited to the task and Progress. Pomodoro is capped at phase length, stopwatch is not.
- Expected: suspended gaps are not counted, or the user is asked.
- Suggested fix: in `tickFocus` track `lastTick`; if `now - lastTick` > ~2 min auto-pause at `lastTick` and toast "Paused while you were away".

### HAB-06 · low · bug · Pomodoro phase after a late tick: session span inconsistent, break starts at wake-up
- [ ] Status: open
- Where: src/domain/focus.ts `advance`/`sessionOf`
- Proven: yes (pomodoro started t=0, first tick at t=3 h: seconds 1500 but startAt..endAt spans 3 h; the break phase starts at 3 h).
- What happens: with a throttled hidden window (about 1 tick/min) or after sleep the phase-end alarm is late; seconds are capped correctly but endAt is `now`, so exports show a 3 h session.
- Suggested fix: `endAt = sessionStart + ms` for pomodoro; start the next phase at the computed boundary.

### HAB-07 · medium · bug · Habit check-ins before the start date are impossible; no way to backfill
- [ ] Status: open
- Where: src/domain/habits.ts:99 `isScheduled` (false when `date < startDate`), src/features/habits/HabitsView.tsx `scheduled` -> "Rest"; HabitDialog has no start-date field; `addHabit` sets startDate=today
- Proven: reasoning only
- What happens: a user who adds a habit they have been doing, or forgot yesterday, cannot record earlier days (day picker shows them as "Rest"); earlier check-ins would be ignored by streaks anyway.
- Expected: editable start date, or start date moves back when an earlier check-in is made.
- Suggested fix: Start date input in HabitDialog; in `setCheckin`, if `date < habit.startDate` call `updateHabit(id, { startDate: date })`.

### HAB-08 · medium · bug · Per-week / weekly-total habits: partial first week counts as a failed week
- [ ] Status: open
- Where: src/domain/habits.ts `weekDoneCount` + `completionRate`/`currentStreak`/`bestStreak` (byWeek branch)
- Proven: yes. perWeek 5, start Thu, Thu..Sun all done: completionRate 0, currentStreak 0 (week 1 can never reach 5); with a perfect week 2 rate is 0.5.
- What happens: contradicts "days before startDate never count against streaks or completion rate".
- Expected: first week prorated (min(target, eligible days)) or skipped.
- Suggested fix: in `weekMet` use `Math.min(target, eligibleDays)` for the start week; prorate or skip for weekly totals.

### HAB-09 · medium · bug · Weekly-total / per-week habits are counted inconsistently on Today and Habits headers
- [ ] Status: open
- Where: src/features/habits/TodayHabits.tsx:22 (`doneCount` uses `isDone(h, today value)`), src/features/habits/HabitsView.tsx (`doneToday`/`dueToday`), vs CheckinButton (uses `periodValue`); `isDueToday` is always true for weekly totals
- Proven: reasoning only
- What happens: a "20 km a week" habit with 21 km logged shows a completed ring but "0/1" in the Today strip and "N of M done today" in Habits, because the day value is below 20. perWeek habits sit in the denominator every day. The habit never leaves Today once the week is met.
- Suggested fix: one `isDoneOn(h, checkins, date, ws)` in habits.ts (periodValue for weekly totals, weekMet for perWeek) used by both; `isDueToday` hides met weekly totals unless done today.

### HAB-10 · low · bug · Logging a slip on a quit habit fires the "habit checked" feature event
- [ ] Status: open
- Where: src/stores/habits.ts:128 (`next.value > prev.value` -> `trackDone("habit:checked")`)
- Proven: reasoning only (D217: avoid-habits don't count as kept)
- Suggested fix: only when `isBuild(habit)` and the day became done.

### HAB-11 · medium · bug · Task with future date but deadline today (or a due person follow-up) appears in both Today and Upcoming
- [ ] Status: open
- Where: src/domain/taskViews.ts:57-62 `inSmartList` ("today" includes deadline<=today / followUpDue regardless of date; "upcoming" only checks date>today)
- Proven: yes (date 10-30, deadline 10-26, today 10-26: today=true and upcoming=true; same for a person wait with followUp today)
- What happens: duplicate rows in two smart lists and double counts. `pickOneThing` skips such tasks (date > today) although Today shows them.
- Suggested fix: in "upcoming" add `&& !(t.deadline !== null && t.deadline <= today) && !followUpDue(t.waiting, today)`.

### HAB-12 · low · bug · Timed task running past midnight is flagged Overdue
- [ ] Status: open
- Where: src/domain/taskViews.ts:78 `isOverdue` (start date only)
- Proven: yes (23:00-01:00, at 00:30 next day: isOverdue true)
- Suggested fix: for timed schedules compare `end` with now, or treat as overdue only once `end` is before today's start.

### HAB-13 · low · bug · Timed tasks just after midnight are "Upcoming" when End-of-day hour > 0
- [ ] Status: open
- Where: src/domain/dates.ts `scheduleDate` (calendar day of start) used by `inSmartList`
- Proven: yes (dayEnd 3, now Mon 01:00 so today=Sun; a Mon 01:30 block is in Upcoming, not Today)
- Suggested fix: for timed schedules derive the date with `todayLocal(new Date(start))`.

### HAB-14 · low · bug · Auto-start focus misses a block when the 1 s tick is throttled; stale blockEnd
- [ ] Status: open
- Where: src/domain/focus.ts `dueAutoFocus` (`now - start < 60_000`), src/lib/os.ts:112 setInterval, src/stores/focus.ts `blockEnd`
- Proven: reasoning only
- What happens: with the window hidden in the tray Chromium throttles timers (to about 1/min), so the 60 s window can be skipped and the block never starts. `blockEnd` also survives a manual stop, so a later manual start on the same task is stopped at the old block end.
- Suggested fix: track started blocks in a set instead of a recency window; clear `blockEnd` in `stopFocus`.

### HAB-15 · low · bug · Habit week/month navigators and Habits day picker ignore End-of-day hour and midnight rollover
- [ ] Status: open
- Where: src/features/habits/HabitReview.tsx:17-18, HabitDetail.tsx:111 (`startOfWeek(new Date())`, `startOfMonth(new Date())`); HabitsView.tsx `useState(today)` never rolls over
- Proven: reasoning only
- Suggested fix: use `fromLocalDate(todayLocal())`; reset `date` when the day changes.

### HAB-16 · low · bug · Focus totals disagree between Progress and Focus page
- [ ] Status: open
- Where: ProgressView.tsx:41 sums raw seconds; FocusView.tsx:63 sums per-day `Math.round`ed minutes (up to a few minutes apart). Round once at the end.

### HAB-17 · low · bug · `fitItems` returns -1 for an empty list with negative width
- [ ] Status: open
- Where: src/domain/dockFit.ts
- Proven: yes (`fitItems(-5, [], 4, 10) === -1`). Fix: `return Math.max(0, k)`.

### HAB-18 · low · bug · Mini window matrix counts include waiting/blocked tasks
- [ ] Status: open
- Where: src/domain/mini.ts `buildSnapshot` (`open` filters only status and `inMatrix`)
- Proven: reasoning only. The Matrix in Today excludes waiting tasks, the mini one counts them. Fix: also exclude `waitingNow(v, today)`.

### HAB-19 · low · bug · Subtask of a waiting/someday parent still lands in Today on its own
- [ ] Status: open
- Where: src/domain/taskViews.ts `inSmartList` (ignores parent state)
- Proven: reasoning only. Per D196 a subtask shows on its own when its parent is not in the view, so a dated child of a Waiting parent shows in Today although the parent is parked. Consider inheriting waiting/someday from the parent.

### HAB-20 · low · bug · Negative list sortOrder sorts wrongly when grouping by list
- [ ] Status: open
- Where: taskViews.ts `groupVMs` (`padStart(12,"0")` of a negative number: -2 sorts after -1). Reasoning only. Fix: offset or numeric compare.

### HAB-21 · low · feature · Idle/sleep detection and "forgot to stop" handling for focus
- [ ] Status: open
- Auto-pause on suspend/idle; prompt "you were away 3 h, keep it?" on return.

### HAB-22 · low · feature · Backfill from the heatmap/month grid on desktop
- [ ] Status: open
- Day picker covers only the last 7 days and MonthGrid/YearHeatmap cells are display-only; click-to-edit any past day (the phone app already supports it).

### HAB-23 · low · feature · Skip / vacation / pause for habits
- [ ] Status: open
- Only archive exists. A "skip day" or freeze that neither breaks nor extends a streak would cover sickness and travel.

### HAB-24 · low · feature · Quit/limit habits: "days since last slip" anchor
- [ ] Status: open
- They show a 1-day streak on the creation day and an ever-growing streak for unlogged days (D217 by design); a last-slip anchored count would be clearer.

### HAB-25 · low · feature · Manual focus sessions and midnight splitting
- [ ] Status: open
- Only delete exists (`deleteSession`); a session spanning midnight is credited wholly to its start day.

## Verified OK
- `currentStreak`/`bestStreak` for daily and weekday habits: unscheduled days neither break nor extend; an unfinished today is forgiven for build habits; future days never counted; start-date clipped.
- Week start Sun vs Mon is consistent through `weekStartOf` (date-fns weekStartsOn) in streaks, rate, heatmap and stats `perWeek`.
- `completionRate` returns null (no division by zero) when nothing was expected; in-progress today is skipped.
- DST: date math is via `addDays` on local-midnight Dates or string dates, no millisecond day arithmetic.
- `setCheckin` clamps negatives and deletes empty check-ins; CheckinButton guards NaN/negative typed values; dialog clamps cap/target/perWeek count.
- Focus timer derives time from wall-clock timestamps, so pause/resume accounting and background throttling do not drift the displayed clock; sub-minute sessions dropped; pomodoro seconds capped at phase length; finite cycles and long-break cadence correct.
- Matrix: no date/deadline is not urgent, overdue is urgent, priority 0 is unimportant, someday excluded; `patchForQuadrant` touches only disagreeing attributes.
- `sortVMs` stable (ties fall back to sortOrder); done sink, pinned float.
- `niceScale`, `heatLevel`, `dayStreaks` zero/empty cases OK.
