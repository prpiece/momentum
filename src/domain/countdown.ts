import { daysBetween, fromLocalDate, toLocalDate } from "./dates";
import type { CalendarEvent, CountdownMode, LocalDate } from "./types";

/** What a countdown counts toward. Countdowns are all-day calendar events since v1.0 (D163). */
export type Countdown = {
  date: LocalDate;
  /** `until`: days left to the date; `since`: days elapsed since it. */
  direction: CountdownMode;
  repeat: "none" | "monthly" | "yearly";
};

/** The countdown an event shows, if any. Only monthly and yearly rules roll the target forward. */
export function eventCountdown(e: Pick<CalendarEvent, "schedule" | "recurrence" | "countdown">): Countdown | null {
  if (!e.countdown || e.schedule.kind !== "day") return null;
  // ponytail: other rules (weekly, intervals) count to the first date; expand the series if anyone asks.
  const rule = e.recurrence?.rule;
  const repeat = rule === "FREQ=MONTHLY" ? "monthly" : rule === "FREQ=YEARLY" ? "yearly" : "none";
  return { date: e.schedule.date, direction: e.countdown, repeat };
}

const daysInMonth = (y: number, m: number) => new Date(y, m + 1, 0).getDate();
/** Same day-of-month in (y, m), clamped (Jan 31 → Feb 28/29, Feb 29 → Feb 28 in common years). */
const clampDate = (y: number, m: number, day: number) => toLocalDate(new Date(y, m, Math.min(day, daysInMonth(y, m))));

/** The date a repeating countdown is counting toward: the next anniversary on or after today. */
export function targetDate(c: Countdown, today: LocalDate): LocalDate {
  if (c.repeat === "none" || c.direction === "since" || c.date >= today) return c.date;
  const base = fromLocalDate(c.date);
  const t = fromLocalDate(today);
  if (c.repeat === "yearly") {
    const thisYear = clampDate(t.getFullYear(), base.getMonth(), base.getDate());
    return thisYear >= today ? thisYear : clampDate(t.getFullYear() + 1, base.getMonth(), base.getDate());
  }
  const thisMonth = clampDate(t.getFullYear(), t.getMonth(), base.getDate());
  return thisMonth >= today ? thisMonth : clampDate(t.getFullYear(), t.getMonth() + 1, base.getDate());
}

/** Days left (until) or elapsed (since). A past non-repeating "until" goes negative. */
export function countdownDays(c: Countdown, today: LocalDate): number {
  return c.direction === "since" ? daysBetween(c.date, today) : daysBetween(today, targetDate(c, today));
}
