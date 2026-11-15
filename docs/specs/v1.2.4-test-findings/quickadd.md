# Quick-add parser, filters, search (QA)

Scope: src/domain/{quickAdd,filter,autocomplete,fuzzy}.ts. Part of the [v1.2.4 test findings](README.md). Each entry says whether a probe test proved it or it rests on reading the code; prove it with a failing test before fixing (the v1.2.1 rule).

All probes: TZ=America/New_York, fixed `now` (Fri 2026-11-13 10:00 local unless stated). Nothing threw on any input (10k-char strings OK, worst case ~200ms for 3000x "by ").

### QA-01 · high · bug · Date-only words roll to next week/year after 12:00 noon
- [ ] Status: open
- Where: src/domain/quickAdd.ts ~:214 (`casual.parse(mask(input, matches), now, { forwardDate: true })`), also dateAt() ~:103 (deadline/waiting); filter.ts reuses parseQuickAdd
- Proven: yes. now=Fri 2026-11-13 12:01 or later: "fri" -> 2026-11-20 (at 11:59 -> 11-13); "nov 13" -> 2027-11-13; "friday gym" -> 11-20; "by fri" deadline -> 11-20; "this fri" -> 11-20; "dec 31" at 2026-12-31 23:59 -> 2027-12-31. Filter "fri" and "nov 13" likewise move to next week/year.
- What happens: chrono gives a date with no time an implied 12:00; forwardDate then compares that noon to `now`, so every afternoon/evening a weekday or month-day naming today is treated as "already passed". Typing "fri" on Friday afternoon (and "sat" on Saturday...) schedules a week later; "dec 31" on Dec 31 evening schedules next year; the filter "fri" never shows today's tasks in the afternoon. Behaviour flips at noon.
- Repro: parseQuickAdd("fri gym", new Date(2026,10,13,15,0)) -> day 2026-11-20.
- Expected: a date-only phrase naming today stays today (same as before noon).
- Suggested fix: when the result has no certain hour, re-parse with reference = start of local day (`startOfDay(now)`); keep `now` for timed results. Apply in parseQuickAdd and dateAt.

### QA-02 · medium · bug · Bare hour 1-7 is read as AM ("at 5", "dinner at 7")
- [ ] Status: open
- Where: quickAdd.ts date pass (chrono default meridiem)
- Proven: yes. "meet at 5" -> 2026-11-14 05:00 local (next day); "dinner at 7" -> 07:00 next day; "Dr. Smith at 3" -> 03:00; "tomorrow at 5", "friday at 5" -> 05:00. ("lunch at 12" -> noon ok.)
- What happens: "at 5" normally means 5pm; user gets a 5am task, and it jumps to tomorrow because 5am has passed.
- Expected: hours 1-6/7 without am/pm resolve to PM.
- Suggested fix: chrono refiner: when meridiem is not certain and hour in 1..7, add 12h.

### QA-03 · medium · bug · "9 to 5" / "tomorrow 9 to 5" create a 20-hour task spanning to next day
- [ ] Status: open
- Where: quickAdd.ts date pass (only checks end > start)
- Proven: yes. "tomorrow 9 to 5" -> start 2026-11-14 09:00, end 2026-11-15 05:00 local.
- Expected: 9am-5pm.
- Suggested fix: same PM heuristic for the end when end-start > 12h.

### QA-04 · medium · bug · "in 90 minutes / in 2 hours / in 30 min" are eaten as a duration
- [ ] Status: open
- Where: quickAdd.ts planningMatches duration regex (~:109), runs before chrono and masks the span
- Proven: yes. "in 2 hours call" -> title "in call", durationMin 120, schedule none. "in 30 min call" same. ("in an hour" correctly a timed task.)
- What happens: user wants a reminder 2h from now; gets an unscheduled task titled "in call" with a 2h duration.
- Expected: timed task at now+2h, title "call".
- Suggested fix: skip the duration match when the preceding word is "in" (e.g. lookbehind `(?<!\bin\s)`), so chrono reads it.

### QA-05 · medium · bug · Decimal and parenthesised durations become bogus times
- [ ] Status: open
- Where: quickAdd.ts duration regex (integers only, needs whitespace/start before the number)
- Proven: yes. "write report 1.5h" and "... 1.5 hours" -> timed task today 11:30 (chrono reads "5h"/"1.5h" as a time), title "write report". "meeting (30m)" -> timed 10:30, title "meeting ( )".
- Expected: 90 min duration, no date; "(30m)" a duration.
- Suggested fix: allow `\d+(?:\.\d+)?` hours, allow `(`/`[` before and `)` after.

### QA-06 · medium · bug · Ordinal repeat phrases silently mis-parse
- [ ] Status: open
- Where: quickAdd.ts repeatMatches
- Proven: yes. "every month on the 15th" -> rule FREQ=MONTHLY, start today (13th), title "on the 15th" (day ignored, repeats on the 13th). "monthly on the 1st" same. "every 2nd tuesday", "every last friday", "first monday of month": no rule, chrono makes a one-off date, titles "every 2nd" / "every" / "first of month". "every 15th", "pay rent on the 1st": nothing parsed.
- What happens: wrong recurrence created with no warning; leftover words pollute the title.
- Expected: BYMONTHDAY=15 / BYDAY=2TU / BYDAY=-1FR.
- Suggested fix: add `every (\d+)(st|nd|rd|th)` / `(on )?the Nth` after monthly/every month (BYMONTHDAY), and `every (first|second|third|fourth|last|Nth) <day>` (nth BYDAY). Extend the chip span over what was consumed.

### QA-07 · medium · bug · "every weekend", "bi-weekly", "until", counts mis-parse
- [ ] Status: open
- Where: repeatMatches
- Proven: yes. "every weekend" -> one-off Sat 2026-11-14, title "every", no rule. "bi-weekly" -> rule WEEKLY (not every 2 weeks), title "bi-". "fortnightly", "every weeknight": ignored. "every 3 days until dec 1 water" -> rule DAILY;INTERVAL=3, schedule START becomes 2026-12-01, title "until water". "daily x5 pills" -> title "x5 pills", count ignored.
- Expected: weekend -> BYDAY=SA,SU; biweekly/fortnightly -> INTERVAL=2; "until <date>" -> UNTIL (start stays today); "x5"/"for 5 weeks" -> COUNT.
- Suggested fix: add these to repeatMatches; consume the date after `until|through` into UNTIL instead of letting chrono use it as start.

### QA-08 · medium · bug · Bare day/month words become dates even as ordinary words
- [ ] Status: open
- Where: quickAdd.ts chrono pass (casual parser)
- Proven: yes. "SAT prep" -> Sat 11-14, title "prep"; "study for the sat" -> title "study for the"; "sun cream" -> Sunday, "cream"; "mon ami" -> Monday; "march"/"march madness" -> 2027-03-01, "madness"; "may" -> 2027-05-01 (while "pay may rent" does not parse - inconsistent). "now" ("pay $5 now", "see https://x.com now") -> timed task at the current hour.
- What happens: title words vanish and the task is scheduled. Chip is visible, but a "SAT prep" or "Sun Tzu" task gets dated.
- Expected: ambiguous single words (sat, sun, mon, wed, mar, may, march, now) do not parse unless introduced by on/next/this/by/every or followed by a day number/time.
- Suggested fix: post-filter chrono results: drop a match whose text is a lone ambiguous word.

### QA-09 · medium · bug · Possessive/brackets left behind when a date is removed from the title
- [ ] Status: open
- Where: quickAdd.ts title cleanup (~:250)
- Proven: yes. "tomorrow's plan" -> title "'s plan"; "Tuesday's meeting" -> "'s meeting"; "note: tomorrow's plan" -> "note: 's plan"; "Task A (tomorrow)" -> "Task A ( )"; "\"tomorrow\" movie" -> "\" \" movie"; "tomorrow-ish" -> "-ish"; "~List's" -> list "List", title "'s".
- Expected: do not match the stem of a possessive; drop empty `()`, `[]`, `""`.
- Suggested fix: reject chrono matches directly followed by `'s`/`’s`; strip empty bracket/quote pairs in the cleanup regexes.

### QA-10 · medium · bug · Non-Latin tags with combining marks are truncated
- [ ] Status: open
- Where: quickAdd.ts tokenMatches/keywordMatches/waiting regexes and autocomplete.ts TOKEN_CHAR use `[\p{L}\p{N}_\-/]` (no \p{M})
- Proven: yes. "#हिन्दी x" -> tag "ह", title "िन्दी x". NFD "#café x" -> tag "cafe", title "́ x" (stray accent). tokenAt("#हिन्दी",4) -> null.
- Expected: whole word is the tag.
- Suggested fix: add `\p{M}` to every token char class (one shared constant for parser + autocomplete + waiting name).

### QA-11 · low · bug · Tag/list character set mismatch and punctuation splitting
- [ ] Status: open
- Where: quickAdd.ts tokenMatches vs autocomplete.ts TOKEN_CHAR
- Proven: yes. "~Home/Away x" -> list "Home", title "/Away x" while autocomplete treats "/" as part of a `~` token (parser allows "/" only for tags). "#v1.2" -> tag "v1", title "2 x"; "#c++" -> tag "c", title "++ x"; "#don't" -> tag "don", title "'t x"; "#🎉 party" not a tag (emoji unsupported).
- Suggested fix: one shared char class; when a tag is followed directly by `.`/`+`/`'` junk, either include it or do not treat it as a tag.

### QA-12 · medium · bug · Search is not accent-insensitive nor Unicode-normalised
- [ ] Status: open
- Where: src/domain/taskViews.ts:199 matchScore (also fuzzy.letters, autocomplete.key)
- Proven: yes. matchScore("Café meeting","cafe") -> null; ("Cafe meeting","café") -> null; ("Résumé","resume") -> null; ("Ünï","uni") -> null; NFC "école" vs NFD "école" -> null both ways; ("Straße","strasse") -> null; ("İstanbul","istanbul") -> null. Filter text and autocomplete suggest("é", ["ea"]) -> [] behave the same.
- Expected: diacritic-insensitive, NFC/NFD equal.
- Suggested fix: one helper `s.normalize("NFD").replace(/\p{M}/gu,"").toLowerCase()` used by matchScore, suggest, nameKey (filter + quickAddSubmit).

### QA-13 · medium · feature · Filter has no negation / OR
- [ ] Status: open
- Where: src/domain/filter.ts parseFilter/matchesFilter
- Proven: yes. "-#work" and "!#work" -> literal text; "not #work" -> tag work AND text "not"; "#work or #home" -> tags work AND home plus text "or" (empty result).
- Suggested fix: support `-#tag`, `-~list`, `-!high` as excludes; document multiple tags as AND.

### QA-14 · medium · bug · Filter: planning tokens show chips but do nothing; weekday words can't be searched
- [ ] Status: open
- Where: filter.ts parseFilter
- Proven: yes. "someday", "30m", "2h", "by fri": chips shown, no field set, isEmptyFilter() true so the view shows everything while a chip claims a filter. "buy by fri" -> text "buy", deadline silently dropped. "waiting"/"@sam" are plain text. "overdue today" -> date "today" silently overrides overdue. "this week" -> single date Sat 11-14 (shows only Saturday). Any text containing a day/month word ("sat", "sun cream", "may", "march", "mon") becomes a date filter and cannot be searched as text; "done"/"overdue" likewise keywords.
- Expected: unsupported chips should not render as active, or should filter (someday -> schedule.kind==="someday"; by -> deadline).
- Suggested fix: drop duration/deadline/someday/waiting chips in parseFilter (leave as text) or implement them; require explicit keywords (today/tomorrow/ full date) for date filters rather than any chrono match.

### QA-15 · low · bug · Filter "~Home Chores" (list name with a space)
- [ ] Status: open
- Where: filter.ts / quickAdd.ts (`~` token is a single word; filter passes no listNames)
- Proven: yes. "~Home Chores" -> list "Home", text "Chores" (matches nothing unless a list "Home" exists); users must type "~HomeChores". The autocomplete inserts the space-less form so the UI path works; hand-typed does not.
- Suggested fix: match longest prefix of following words against listNames (as keywordMatches does), for typed `~` and in filters.

### QA-16 · low · bug · Title that is only tokens keeps the tokens in the title
- [ ] Status: open
- Where: quickAdd.ts ~:262 `result.title = title || input.trim()`
- Proven: yes. "#work" -> title "#work" + tag work; "!high" -> title "!high", priority 3; "~Work" -> title "~Work", list Work; "5pm-6pm" -> title "5pm-6pm". Intentional non-empty fallback, but surprising.
- Suggested fix: keep (documented) or strip sigils but keep the word.

### QA-17 · low · bug · DST gap time silently shifts
- [ ] Status: open
- Proven: yes. now=2027-03-13 12:00: "tomorrow 2:30am" -> 03:30 EDT (2:30 does not exist); "every day at 2:30am" anchors 03:30. Acceptable.

### QA-18 · low · feature · Unsupported-but-natural phrasing
- [ ] Status: open
- "due friday"/"due 5pm" leave "due" in the title; "eom", "eod", "eow", "tom", "christmas", "thanksgiving", "end of week" not parsed ("end of month" works); "jan"/"oct" alone ignored; "lunch 12-1" no time; "a week from friday" -> title "from friday", date today+7; "6a"/"6p"/"1730" ignored; "tomorrow or friday" keeps "or friday"; "remind me to ..." keeps prefix.
- Suggested fix: add `due` to the trailing-word strip (`on|at|by|for|due`), eod/eow/eom aliases.

## Verified OK
Priority variants (!high !HIGH !2), duplicate tokens (first wins, all blanked), "!", "!!!", "#", "##", "~" alone, email/URL/C#/$5 not tokenised, 10k-char inputs, RTL text (English-only chrono), "2026-02-30" (left in title), "feb 29" non-leap (none), "meeting 9-10:30", "5pm-6pm", noon/midnight/12am, "in 2 weeks", "next fri" (+7), "31/1" and "1/31" both Jan 31, "every other week", "every weekday", "every 3 days", "every Mon, Wed and Fri", splitImport markers/indent/cap, regex-special search input (no throw, properly escaped), bestName thresholds, createFromText list fallback.
