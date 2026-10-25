import { daysBetween, fromLocalDate, toLocalDate } from "./dates";
import type { Instant, LocalDate } from "./types";

export const COUNTDOWN_REPEATS = ["none", "monthly", "yearly"] as const;
export type Countdown = {
  id: string;
  title: string;
  date: LocalDate;
  /** `until`: days left to the date; `since`: days elapsed since it. */
  direction: "until" | "since";
  repeat: (typeof COUNTDOWN_REPEATS)[number];
  emoji: string;
  color: string;
  pinned: boolean;
  createdAt: Instant;
};

const daysInMonth = (y: number, m: number) => new Date(y, m + 1, 0).getDate();
/** Same day-of-month in (y, m), clamped (Jan 31 → Feb 28/29, Feb 29 → Feb 28 in common years). */
const clampDate = (y: number, m: number, day: number) => toLocalDate(new Date(y, m, Math.min(day, daysInMonth(y, m))));

/** The date a repeating countdown is counting toward: the next anniversary on or after today. */
export function targetDate(c: Pick<Countdown, "date" | "repeat" | "direction">, today: LocalDate): LocalDate {
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
export function countdownDays(c: Pick<Countdown, "date" | "repeat" | "direction">, today: LocalDate): number {
  return c.direction === "since" ? daysBetween(c.date, today) : daysBetween(today, targetDate(c, today));
}

export function countdownLabel(c: Pick<Countdown, "date" | "repeat" | "direction">, today: LocalDate): string {
  const n = countdownDays(c, today);
  if (c.direction === "since") return n === 0 ? "Today" : `${n} day${n === 1 ? "" : "s"} since`;
  if (n === 0) return "Today";
  if (n < 0) return `${-n} day${n === -1 ? "" : "s"} ago`;
  return `${n} day${n === 1 ? "" : "s"} left`;
}
