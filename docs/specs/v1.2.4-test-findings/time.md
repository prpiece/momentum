# Dates, recurrence, calendar, reminders (TIME)

Scope: src/domain/{dates,recurrence,calendar,reminders,alarms,ics,subscriptions}.ts, src/lib/reminderScheduler.ts. Part of the [v1.2.4 test findings](README.md). Each entry says whether a probe test proved it or it rests on reading the code; prove it with a failing test before fixing (the v1.2.1 rule).

All probes ran in TZ=America/New_York unless noted (TZ switched at runtime with `process.env.TZ`; vite.config forces NY otherwise). Probe files deleted.

### TIME-01 · high · bug · Recurring task reminders stop firing once one occurrence is missed
- [ ] Status: open
- Where: src/domain/reminders.ts:73-88 (remindersBetween uses `vm.schedule`), src/domain/recurrence.ts:213-217 (effective -> nextOccurrence with no `from`), src/domain/taskViews.ts:30
- Proven: yes (probe: daily 09:00 series from 2026-11-10, reminder "15 min before", no exdates; window 2026-11-15 08:40-08:50 -> 0 fires, vm.key = "2026-11-10T09:00"; expected 1 fire for the Nov 15 occurrence)
- What happens: the TaskVM schedule of a series is its oldest unhandled occurrence. Reminders are computed only for that occurrence. As soon as the user skips completing one occurrence (very common for daily tasks), `reminderAt` points at a past instant forever, so no further reminder ever fires for that series, for every reminder kind ("N min before" and "On the day, 9:00"). Only the separate "Starting now" alert (via calendarItems) still works for timed tasks. Silent failure of the core reminder promise.
- Repro: create a daily 09:00 task with a 15-min reminder; don't complete tomorrow's occurrence; the day after, no reminder at 08:45.
- Expected: reminders fire for every occurrence whose reminder time falls in the window (at least the occurrences between the oldest open one and now/upcoming).
- Suggested fix: in remindersBetween, for `t.recurrence` iterate `occurrencesBetween(t, from - maxLead, to + maxLead)` (maxLead = largest reminder offset, e.g. daysBefore*1440 or minutes) and compute `reminderAt` per occurrence, keying with the occurrence key; keep vm.schedule only for non-recurring tasks.

### TIME-02 · high · bug · Editing a series "all occurrences" (time, day, or rule) resurrects every completed occurrence
- [ ] Status: open
- Where: src/stores/data.ts:334-337 (editOccurrence scope all -> shiftAnchor), src/domain/recurrence.ts:305-313 (shiftAnchor), src/features/tasks/ScheduleEditor.tsx:103,116 (`onRecurrence({ rule, exdates: [] })`), also editEventOccurrence data.ts:399
- Proven: yes (probe: daily 09:00 from 2026-11-01, exdates Nov 1-3 (completed); "all" move to 10:00 -> effective key goes from "2026-11-04T09:00" back to "2026-11-01T10:00")
- What happens: completed/deleted occurrences are stored as wall-clock exdate keys ("…T09:00" or a date). Changing the series time or shifting its day changes every generated key, so none of the old exdates match. All previously completed occurrences come back as open/overdue (while their detached "done" copies also exist, so they appear duplicated), and Today shows the very first occurrence as overdue. Changing the repeat rule in ScheduleEditor goes further and explicitly writes `exdates: []`, with the same result.
- Repro: daily 09:00 task, complete 3 occurrences, open the series and change time to 10:00 (All occurrences) or switch Daily -> Weekdays. The completed days reappear overdue.
- Expected: past handled occurrences stay handled; an "all" edit only affects the future.
- Suggested fix: an "all" edit of a series with past exdates should behave like "following" from the current occurrence (splitSeries at effective key, keep head with its exdates), or remap exdates by the same day/time delta in shiftAnchor; ScheduleEditor must keep existing exdates (or split) instead of `exdates: []`.

### TIME-03 · high · bug · Time-zone change (travel, or phone in another zone via sync) un-completes timed recurring occurrences
- [ ] Status: open
- Where: src/domain/recurrence.ts:122-123,140-143,160-162 (toFloating(anchor) uses the current zone's components of the stored UTC start), dates.ts:52 (wallKey comment claims "stable across ... time-zone changes")
- Proven: yes (probe: daily 09:00 NY series, exdates Nov 1 and Nov 2 09:00; in NY effective = "2026-11-03T09:00"; after TZ=Europe/London effective = "2026-11-01T14:00")
- What happens: the anchor is a UTC instant, re-read in whatever zone the device is in, so keys become "…T14:00" in London and no longer match the "…T09:00" exdates written in NY. Every completed, skipped or detached occurrence of every timed series (tasks and in-app events, also .ics exdates) reappears, and effective() jumps back to the first ever occurrence. Same happens on the phone if it is in a different zone than the desktop.
- Repro: complete some occurrences of a daily 09:00 timed task, change the OS time zone, restart.
- Expected: either true floating semantics (series keeps 09:00 wall clock in the new zone and old exdates still match) or fixed-instant semantics; never resurrected occurrences.
- Suggested fix: store the anchor's floating wall-clock (e.g. `wallKey`) alongside the instant (or derive the anchor from a stored local `YYYY-MM-DDTHH:mm` + duration) and build the rule from that, so keys don't depend on the current zone.

### TIME-04 · high · bug · Imported/subscribed recurring events are an hour off across DST when the event's zone differs from the user's (UTC feeds always)
- [ ] Status: open
- Where: src/domain/ics.ts:52-55,58-64 (TZID dropped, start kept as instant), src/domain/recurrence.ts:151-153 (expansion in the viewer's floating time)
- Proven: yes (probe NY viewer: weekly `DTSTART:20261026T140000Z` -> Nov 2 shown at 15:00Z (10:00 EST), correct 14:00Z (09:00 EST). Weekly `DTSTART;TZID=Europe/London:20260302T090000` -> Mar 9/16/23 shown at 08:00Z, correct 09:00Z (London still on GMT until Mar 29))
- What happens: series are expanded keeping the viewer's local wall clock of the first occurrence. For a UTC-anchored series (many SaaS feeds, Outlook/Teams exports, sports schedules) every occurrence after a DST change is one hour off for half the year; for another zone it is off during the weeks the two zones' DST rules differ (US/EU ~3 weeks twice a year, AU/US much longer). Users miss meetings; "Starting now" alerts fire an hour early/late.
- Repro: subscribe to a feed with a weekly UTC meeting; look past the next DST change.
- Expected: occurrences at the event's own zone wall-clock (RFC 5545), converted to the viewer's zone.
- Suggested fix: keep the event's TZID (or "UTC") on ics events and expand with that zone (ical.js `iterator()` can produce the instances directly for read-only ics/sub events), or compute floating components in the event's zone via Intl before calling rrule.

### TIME-05 · medium · bug · RRULE UNTIL in UTC is compared as floating time: last occurrence dropped east of UTC (or extra one west)
- [ ] Status: open
- Where: src/domain/recurrence.ts:146-153 (parse keeps `until` from the rule; build treats it as floating)
- Proven: yes (TZ=Asia/Kolkata: daily 09:00 IST with UNTIL=20261105T033000Z (= Nov 5 09:00 IST) -> keys Nov 1..4, Nov 5 missing; .ics `DTSTART:20261101T033000Z;UNTIL=20261104T033000Z` -> Nov 1..3, Nov 4 missing)
- What happens: UNTIL values from imported .ics (and any rule written by another app) are real UTC, but occurrences are floating wall-clock "UTC". East of UTC the final occurrence is lost; west of UTC (e.g. NY with an UNTIL that ends the day before) occurrences up to the offset past UNTIL can appear.
- Repro: import a daily event with UNTIL in Z in Asia/Kolkata, or Australia.
- Expected: the final occurrence on the UNTIL instant is included.
- Suggested fix: in parseIcs, convert a `Z` UNTIL to the floating local equivalent (toFloating(new Date(until))) before storing the rule; keep app-written UNTILs (splitSeries) floating as today.

### TIME-06 · medium · bug · TZID without a VTIMEZONE block is treated as the viewer's local time
- [ ] Status: open
- Where: src/domain/ics.ts:28,53 (only VTIMEZONEs in the file are registered; `toJSDate()` of an unknown TZID is floating)
- Proven: yes (NY viewer: `DTSTART;TZID=America/Los_Angeles:20261116T090000` without VTIMEZONE -> 14:00Z (9:00 NY); correct 17:00Z)
- What happens: many generators (and hand-written feeds) emit IANA TZIDs without VTIMEZONE definitions; events show at the wrong hour by the zone difference.
- Repro: import the above VEVENT.
- Expected: 09:00 Los Angeles = 12:00 New York.
- Suggested fix: when `start.zone` is unknown/floating but a TZID parameter is present and `Intl.DateTimeFormat` accepts it, compute the instant from the wall-clock components in that zone.

### TIME-07 · medium · bug · "30 min before" reminder fires after the task starts on spring-forward day
- [ ] Status: open
- Where: src/domain/reminders.ts:49-56 (reminderAt "before" does wall-clock arithmetic for all minute offsets)
- Proven: yes (task 2026-03-08 03:15 EDT (07:15Z), 30 min before -> wall 02:45 (non-existent) -> 07:45Z, i.e. 30 min AFTER start. Fall-back: task 01:30 EST (06:30Z), 15 min before -> 05:15Z = 75 min early)
- What happens: wall-clock subtraction is right for "1 day before", but for sub-day offsets on DST days the target lands in the gap (JS rolls it forward an hour) or in the repeated hour. Reminder arrives after the event, or an hour too early.
- Repro: as above.
- Expected: N minutes before = start minus N real minutes for offsets under a day.
- Suggested fix: `if (r.minutes % 1440) return new Date(new Date(s.start).getTime() - r.minutes * 60_000)`; keep the wall-clock path only for whole-day multiples.

### TIME-08 · medium · bug · Moving an occurrence of a BYDAY weekly series with "All occurrences" drops a weekday and does not move anything
- [ ] Status: open
- Where: src/domain/recurrence.ts:305-313 (shiftAnchor), src/stores/data.ts:336
- Proven: yes (FREQ=WEEKLY;BYDAY=MO,WE,FR anchored Mon 2026-11-16; drag Wed 18 -> Thu 19, All -> anchor becomes Tue 17, week shows Wed 18, Fri 20: Monday 16 vanished, nothing on Thursday)
- What happens: shiftAnchor moves DTSTART by the day delta but BYDAY still pins the weekdays, so the user's move is ignored and occurrences before the new DTSTART disappear.
- Repro: weekly on Mon/Wed/Fri, drag Wednesday's block to Thursday, choose All.
- Expected: series becomes Mon/Thu/Fri (rewrite the moved weekday in BYDAY), or the UI refuses a day move for multi-day rules.
- Suggested fix: when the rule has BYDAY (or BYMONTHDAY), remap the moved weekday/day in the rule and keep DTSTART's date; otherwise shift as today.

### TIME-09 · medium · bug · "Every 2 weeks on Sun, Mon" pairs the wrong days (WKST never set from the week-start setting)
- [ ] Status: open
- Where: src/features/tasks/ScheduleEditor.tsx:162 (RuleBuilder), src/domain/recurrence.ts:151 (build, no wkst)
- Proven: yes (FREQ=WEEKLY;INTERVAL=2;BYDAY=SU,MO from Sun 2026-11-15 -> 15, 23, 29, Dec 7, 13; a Sunday-start user expects 15, 16, 29, 30, Dec 13, 14)
- What happens: rrule defaults WKST=MO, so with interval > 1 the Sunday and Monday fall in different "weeks" and occurrences split oddly; the weekStart setting (Sunday) is ignored.
- Repro: week starts Sunday; custom repeat every 2 weeks on Sun+Mon.
- Expected: weeks counted from the user's week start.
- Suggested fix: RuleBuilder appends `;WKST=SU|MO` from settings.weekStart when INTERVAL>1 and BYDAY has several days.

### TIME-10 · medium · bug · With "Day ends at" > 0, a timed task just after midnight is Upcoming while it is happening
- [ ] Status: open
- Where: src/domain/dates.ts:57-67 (scheduleDate uses the calendar date of the start), dates.ts:37-40 (todayLocal), taskViews.ts:48-51
- Proven: yes (endHour 3, now 2026-11-16 00:45, task 00:30-01:30 Nov 16 -> today "2026-11-15", inSmartList today=false, upcoming=true)
- What happens: "today" is shifted back by dayEndHour but a timed task's date isn't, so tasks between midnight and the end-of-day hour drop out of Today and appear in Upcoming as "Tomorrow" while they're current.
- Repro: Settings day ends at 3:00, create a 00:30 task tonight, open Today at 00:45.
- Expected: tasks before the end-of-day hour count toward the previous day (consistent with todayLocal).
- Suggested fix: in taskViews compare with `todayLocal(new Date(start))` for timed schedules (or give scheduleDate an endHour for list views; leave the calendar grid on calendar dates).

### TIME-11 · low · bug · After sleep/long gap, every missed digest and habit reminder fires at once
- [ ] Status: open
- Where: src/lib/reminderScheduler.ts:253-265 (window from `last`, unbounded after wake), src/domain/reminders.ts:93-101,120-137
- Proven: yes (digestBetween window 2026-11-12 22:00 -> 2026-11-15 10:00 -> 3 fires: digest:11-13, 11-14, 11-15)
- What happens: CATCH_UP_MS limits only the launch window. Waking a laptop after a weekend shows a burst of stale "Your day in Momentum" digests (with today's counts) and one habit reminder per missed day.
- Repro: sleep the machine for 3 days with digest on.
- Expected: at most the latest digest per kind, and habit reminders only for today.
- Suggested fix: in check(), clamp `from` to `max(last, now - CATCH_UP_MS)` and for digest/habit/streak only keep the last fire per target.

### TIME-12 · low · bug · One malformed RRULE in a feed makes the whole .ics import / subscription fail; isValidRule accepts rules that crash expansion
- [ ] Status: open
- Where: src/domain/ics.ts:27 (ICAL.parse outside the per-event try), src/domain/recurrence.ts:132-138 (isValidRule only checks parseString)
- Proven: yes (feed with one VEVENT `RRULE:FREQ=DAILY;BYDAY=XX` -> parseIcs throws "invalid BYDAY value", whole feed rejected; `isValidRule("FREQ=DAILY;BYDAY=XX")` = true but occurrencesBetween throws TypeError; `FREQ=SECONDLY` is valid and yields 345,601 occurrences in 4 days)
- What happens: a single bad event blanks the whole subscription ("The calendar couldn't be read"). Rules arriving through rows/JSON import/sync pass validation yet throw inside calendarItems/derive, which would crash the calendar and list views.
- Repro: as above.
- Expected: the bad event is skipped; rules that can't expand are rejected at the boundary.
- Suggested fix: isValidRule: also `new RRule(parse(rule)).after(new Date(0))` in the try and reject FREQ=SECONDLY/MINUTELY (and HOURLY if unwanted); in parseIcs, fall back to stripping/skipping the offending RRULE line on parse error.

### TIME-13 · low · bug · EXDATE;VALUE=DATE on a timed series is ignored
- [ ] Status: open
- Where: src/domain/ics.ts:15-17,62 (keyOf returns "YYYY-MM-DD" for a DATE exdate, timed keys are "YYYY-MM-DDTHH:mm")
- Proven: yes (daily 14:00Z COUNT=5 with `EXDATE;VALUE=DATE:20261105` -> Nov 5 09:00 still shown)
- What happens: some producers exclude a day of a timed series with a DATE exdate; the excluded occurrence still appears.
- Expected: Nov 5 excluded.
- Suggested fix: when the series is timed and the exdate isDate, expand it to the series' key on that date (`${date}T${hhmm(anchor)}`).

### TIME-14 · low · bug · Monthly countdown counts to Feb 28 while the calendar has no February occurrence
- [ ] Status: open
- Where: src/domain/countdown.ts:308-323 (clamps), recurrence.ts (rrule FREQ=MONTHLY skips months without the day)
- Proven: yes (event 2026-01-31 FREQ=MONTHLY countdown: targetDate(…, 2026-02-01) = 2026-02-28; occurrences Feb 1-Mar 31 = [2026-03-31] only)
- What happens: the two parts of the app disagree about when the event is; the countdown chip says Feb 28, the calendar shows nothing until Mar 31.
- Expected: one rule for both (see the month-end FEATURE).
- Suggested fix: make targetDate use nextOccurrence over the event, or make the recurrence clamp (BYMONTHDAY=-1 style) as the countdown does.

### TIME-15 · low · bug · Short adjacent events overlap visually in the day grid
- [ ] Status: open
- Where: src/domain/calendar.ts:207-236 (layoutDay clusters on real end, draws to minHeight)
- Proven: yes (10:00-10:05 and 10:05-10:10 -> both col 0/1 col, first drawn 600-620, second 605-625)
- What happens: blocks shorter than minHeight (20 min) are drawn taller than their real span, but clustering uses the real end, so the next block is drawn on top of them in the same column; titles become unreadable/unclickable.
- Expected: side by side or stacked without overlap.
- Suggested fix: cluster/column on `bottom` (the drawn edge) instead of `end`.

### TIME-16 · low · bug · Event in the repeated fall-back hour has zero height and 0 booked minutes
- [ ] Status: open
- Where: src/domain/calendar.ts:177-182,194,213 (minutesInDay is wall-clock)
- Proven: yes (2026-11-01 05:00Z-06:00Z (01:00 EDT-01:00 EST) -> top 60, drawn 60-80, scheduledMinutes 0)
- What happens: a real 1-hour event on the fall-back night shows as a 20-min sliver and "0m booked". Rare.
- Suggested fix: for scheduledMinutes use real elapsed minutes clipped to the day; for drawing, ensure bottom >= top + real duration.

### TIME-17 · low · bug · RDATE ignored on import
- [ ] Status: open
- Where: src/domain/ics.ts:58-64
- Proven: yes (DAILY;COUNT=2 + `RDATE:20261120T120000` -> only Nov 16, 17; Nov 20 missing)
- Expected: extra dates appear.
- Suggested fix: emit each RDATE as a standalone read-only event (`ics:<uid>:<key>`), like RECURRENCE-ID overrides.

### TIME-18 · medium · feature · Month-end and leap-day recurrence: "Monthly on the 31st" skips short months, "Yearly on Feb 29" only every 4 years
- [ ] Status: open
- Where: src/domain/recurrence.ts REPEAT_PRESETS ("FREQ=MONTHLY", "FREQ=YEARLY")
- Proven: yes (Jan 31 monthly -> Jan 31, Mar 31, May 31 (Feb/Apr/Jun skipped); Feb 29 2024 yearly -> 2024, 2028)
- What happens: RFC-correct but surprising for rent/billing tasks; most planners clamp to the last day of the month.
- Suggested fix: when the anchor day > 28, generate `FREQ=MONTHLY;BYMONTHDAY=28,29,30,31;BYSETPOS=-1` (or offer "last day of month"); yearly Feb 29 -> `BYMONTH=2;BYMONTHDAY=28,29;BYSETPOS=-1`.

### TIME-19 · medium · feature · Custom repeat lacks end conditions and monthly-by-weekday
- [ ] Status: open
- Where: src/features/tasks/ScheduleEditor.tsx:158-192 (RuleBuilder builds only FREQ/INTERVAL/BYDAY)
- Proven: reasoning only (read the rule template at line 162)
- What happens: no "ends on date / after N times", no "2nd Tuesday" / "last Friday" monthly, no "last day of month". Imported rules with these work (rrule supports them) but can't be created in-app.
- Suggested fix: add UNTIL/COUNT and a monthly "on the Nth weekday" option to RuleBuilder; the domain already supports them.

### TIME-20 · low · feature · Missed occurrences of a daily task pile up; no "skip to today"
- [ ] Status: open
- Where: src/domain/recurrence.ts:213-217 (effective = oldest unhandled), src/stores/data.ts:213-226
- Proven: reasoning only (confirmed by STARVE probe: vm.key stays at the oldest open occurrence)
- What happens: after N missed days the user must complete or delete each old occurrence one by one before today's shows. Common planners offer "skip missed" / roll forward.
- Suggested fix: an action that exdates all occurrences before today in one write.
