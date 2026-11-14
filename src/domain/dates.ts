import { addDays, addMinutes, differenceInCalendarDays, differenceInMinutes, format } from "date-fns";
import type { Instant, LocalDate, Schedule } from "./types";

const LOCAL_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isLocalDate(v: unknown): v is LocalDate {
  if (typeof v !== "string") return false;
  const m = LOCAL_DATE.exec(v);
  if (!m) return false;
  const d = new Date(+m[1], +m[2] - 1, +m[3]);
  return d.getFullYear() === +m[1] && d.getMonth() === +m[2] - 1 && d.getDate() === +m[3];
}

export function isInstant(v: unknown): v is Instant {
  return typeof v === "string" && v.includes("T") && !Number.isNaN(Date.parse(v));
}

export const toLocalDate = (d: Date): LocalDate => format(d, "yyyy-MM-dd");

/** Local midnight of a calendar date. */
export function fromLocalDate(s: LocalDate): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/**
 * End of day (D267): the hour (0–5) at which "today" rolls over. Before it, it is still yesterday for
 * Today, overdue and habit days. Set once from settings (`setDayEndHour`); 0 is midnight.
 * ponytail: module state rather than a parameter on ~90 callers; pass `endHour` explicitly in tests.
 */
export const DAY_END_MAX = 5;
let dayEndHour = 0;
export const setDayEndHour = (h: number) => void (dayEndHour = Number.isInteger(h) && h >= 0 && h <= DAY_END_MAX ? h : 0);
export const getDayEndHour = () => dayEndHour;

/** The local date "today" is at `now`, shifted back a day before the end-of-day hour. DST-safe (wall-clock hours). */
export function todayLocal(now = new Date(), endHour = dayEndHour): LocalDate {
  const d = toLocalDate(now);
  return now.getHours() < endHour ? addDaysLocal(d, -1) : d;
}
export const addDaysLocal = (s: LocalDate, n: number): LocalDate => toLocalDate(addDays(fromLocalDate(s), n));
export const daysBetween = (from: LocalDate, to: LocalDate): number =>
  differenceInCalendarDays(fromLocalDate(to), fromLocalDate(from));

/** Wall-clock `HH:mm` on a local date. DST-safe: built from components, not by adding milliseconds. */
export function atLocalTime(date: LocalDate, hhmm: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  const [h, mi] = hhmm.split(":").map(Number);
  return new Date(y, m - 1, d, h, mi);
}

/** Minute-precision wall-clock key, stable across DST and time-zone changes. */
export const wallKey = (d: Date): string => format(d, "yyyy-MM-dd'T'HH:mm");
export const hhmm = (d: Date): string => format(d, "HH:mm");

/** The local date a schedule falls on (a timed task's start day). */
export function scheduleDate(s: Schedule): LocalDate | null {
  switch (s.kind) {
    case "none":
    case "someday":
      return null;
    case "day":
      return s.date;
    case "timed":
      return toLocalDate(new Date(s.start));
  }
}

export function durationMinutes(s: Schedule): number | null {
  return s.kind === "timed" ? differenceInMinutes(new Date(s.end), new Date(s.start)) : null;
}

/** A task's duration (D267): a timed task's end minus start, otherwise its own `durationMin`. */
export const taskMinutes = (t: { schedule: Schedule; durationMin: number | null }): number | null =>
  durationMinutes(t.schedule) ?? t.durationMin;

/** "4h 10m", "45m", "2h". */
export function formatMinutes(min: number): string {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h && m ? `${h}h ${m}m` : h ? `${h}h` : `${m}m`;
}

export function timed(start: Date, minutes: number): Schedule {
  return { kind: "timed", start: start.toISOString(), end: addMinutes(start, minutes).toISOString() };
}

export function formatTime(d: Date, fmt: "12h" | "24h"): string {
  if (fmt === "24h") return format(d, "HH:mm");
  return format(d, d.getMinutes() === 0 ? "h a" : "h:mm a");
}

/** Short human label for a date relative to today: Today, Tomorrow, Mon, Oct 3, Oct 3 2027. */
export function relativeDayLabel(date: LocalDate, today: LocalDate): string {
  const diff = daysBetween(today, date);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "Yesterday";
  const d = fromLocalDate(date);
  if (diff > 1 && diff < 7) return format(d, "EEE");
  return format(d, d.getFullYear() === fromLocalDate(today).getFullYear() ? "MMM d" : "MMM d, yyyy");
}

/** Same schedule on another day: keeps a timed task's wall-clock time and duration. */
export function moveToDate(s: Schedule, date: LocalDate): Schedule {
  if (s.kind === "timed") return timed(atLocalTime(date, hhmm(new Date(s.start))), durationMinutes(s) ?? 0);
  return { kind: "day", date };
}
