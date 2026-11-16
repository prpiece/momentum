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

const zoneFormats = new Map<string, Intl.DateTimeFormat>();
function zoneFormat(tz: string): Intl.DateTimeFormat {
  let f = zoneFormats.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" });
    zoneFormats.set(tz, f);
  }
  return f;
}

/** Whether `tz` is an IANA zone this runtime knows. */
export function isZone(tz: string): boolean {
  try {
    zoneFormat(tz).formatToParts(0);
    return true;
  } catch {
    return false;
  }
}

/** Wall-clock components of `d` in zone `tz`, as a "floating" Date (the components in its UTC fields). */
export function wallIn(d: Date, tz: string): Date {
  const p: Record<string, number> = {};
  for (const x of zoneFormat(tz).formatToParts(d)) if (x.type !== "literal") p[x.type] = Number(x.value);
  return new Date(Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second));
}

/** The instant whose wall clock in `tz` is the floating `f` (a time in a DST gap lands an hour off). */
export function fromWall(f: Date, tz: string): Date {
  let t = f.getTime();
  for (let i = 0; i < 2; i++) t = f.getTime() - (wallIn(new Date(t), tz).getTime() - t);
  return new Date(t);
}

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
  const total = Math.round(min); // round first: rounding only the remainder gave "1h 60m"
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h && m ? `${h}h ${m}m` : h ? `${h}h` : `${m}m`;
}

export function timed(start: Date, minutes: number): Schedule {
  return { kind: "timed", start: start.toISOString(), end: addMinutes(start, minutes).toISOString() };
}

export function formatTime(d: Date, fmt: "12h" | "24h"): string {
  if (fmt === "24h") return format(d, "HH:mm");
  return format(d, d.getMinutes() === 0 ? "h a" : "h:mm a");
}

/** Date order (FEAT-12): how a numeric date reads and which way quick add takes "3/4". */
export type DateOrder = "dmy" | "mdy" | "iso";

/** The order a locale writes dates in; year-first locales (ja, sv, hu…) read as iso. */
export function systemDateOrder(locale?: string): DateOrder {
  try {
    const parts = new Intl.DateTimeFormat(locale, { year: "numeric", month: "numeric", day: "numeric" }).formatToParts(new Date(2000, 10, 25));
    const first = parts.find((p) => p.type === "year" || p.type === "month" || p.type === "day")?.type;
    return first === "year" ? "iso" : first === "day" ? "dmy" : "mdy";
  } catch {
    return "mdy";
  }
}

let order: DateOrder = "mdy";
/** Set once from Settings → Date format (`system` resolves against the OS locale). ponytail: module state like `dayEndHour`; pass nothing, read `dateOrder()`. */
export const setDateOrder = (f: "system" | DateOrder, locale?: string) => void (order = f === "system" ? systemDateOrder(locale) : f);
export const dateOrder = (): DateOrder => order;

/** "Oct 3" / "3 Oct" / "10-03" (with the year when `withYear`) in the chosen order. */
function shortDate(d: Date, withYear: boolean): string {
  if (order === "iso") return format(d, withYear ? "yyyy-MM-dd" : "MM-dd");
  if (order === "dmy") return format(d, withYear ? "d MMM yyyy" : "d MMM");
  return format(d, withYear ? "MMM d, yyyy" : "MMM d");
}

/** Short human label for a date relative to today: Today, Tomorrow, Mon, Oct 3, Oct 3 2027 (day first with DD/MM, numeric with ISO). */
export function relativeDayLabel(date: LocalDate, today: LocalDate): string {
  const diff = daysBetween(today, date);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "Yesterday";
  const d = fromLocalDate(date);
  if (diff > 1 && diff < 7) return format(d, "EEE");
  return shortDate(d, d.getFullYear() !== fromLocalDate(today).getFullYear());
}

/** Same schedule on another day: keeps a timed task's wall-clock time and duration. */
export function moveToDate(s: Schedule, date: LocalDate): Schedule {
  if (s.kind === "timed") return timed(atLocalTime(date, hhmm(new Date(s.start))), durationMinutes(s) ?? 0);
  return { kind: "day", date };
}
