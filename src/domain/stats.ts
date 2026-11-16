import { startOfWeek } from "date-fns";
import { addDaysLocal, atLocalTime, fromLocalDate, getDayEndHour, toLocalDate, todayLocal } from "./dates";
import type { LocalDate, Task, WeekStart } from "./types";

export type Bucket = { start: LocalDate; label: string; value: number };

const localDay = (iso: string) => todayLocal(new Date(iso));

/** The day a focus session counts on: same End-of-day rule as completed tasks (HAB-03). */
export const sessionDay = localDay;

/**
 * A session's seconds per day. One that crosses the day boundary (midnight, or the End-of-day hour) is split
 * in proportion to the time on each side, since pauses leave no timestamps (HAB-25).
 */
export function sessionParts(s: { startAt: string; endAt?: string; seconds: number }): { day: LocalDate; seconds: number }[] {
  const start = Date.parse(s.startAt);
  const end = s.endAt ? Date.parse(s.endAt) : NaN;
  const first = localDay(s.startAt);
  if (!(end > start)) return [{ day: first, seconds: s.seconds }];
  const hh = `${String(getDayEndHour()).padStart(2, "0")}:00`;
  const parts: { day: LocalDate; seconds: number }[] = [];
  let day = first;
  let from = start;
  for (;;) {
    const edge = atLocalTime(addDaysLocal(day, 1), hh).getTime();
    if (edge >= end) break;
    parts.push({ day, seconds: (s.seconds * (edge - from)) / (end - start) });
    day = addDaysLocal(day, 1);
    from = edge;
  }
  parts.push({ day, seconds: (s.seconds * (end - from)) / (end - start) });
  return parts;
}

/** Seconds of focus credited to `day`. */
export const secondsOn = (sessions: Iterable<{ startAt: string; endAt?: string; seconds: number }>, day: LocalDate): number => {
  let n = 0;
  for (const s of sessions) for (const p of sessionParts(s)) if (p.day === day) n += p.seconds;
  return n;
};

/** Focus minutes per day for the `n` days ending `today`; unrounded, so totals round once at the end (HAB-16). */
export function focusPerDay(sessions: Iterable<{ startAt: string; endAt?: string; seconds: number }>, today: LocalDate, n: number): Bucket[] {
  const by = new Map<LocalDate, number>();
  for (const s of sessions) for (const p of sessionParts(s)) by.set(p.day, (by.get(p.day) ?? 0) + p.seconds / 60);
  return Array.from({ length: n }, (_, i) => {
    const d = addDaysLocal(today, i - n + 1);
    return { start: d, label: d, value: by.get(d) ?? 0 };
  });
}

/** Tasks completed per local day for the `n` days ending `today`. */
export function completedPerDay(tasks: readonly Task[], today: LocalDate, n: number): Bucket[] {
  const counts = new Map<LocalDate, number>();
  for (const t of tasks) if (t.status === "done" && t.completedAt && !t.deletedAt) counts.set(localDay(t.completedAt), (counts.get(localDay(t.completedAt)) ?? 0) + 1);
  return Array.from({ length: n }, (_, i) => {
    const d = addDaysLocal(today, i - n + 1);
    return { start: d, label: d, value: counts.get(d) ?? 0 };
  });
}

/** Per-week sums of daily buckets for the `n` weeks ending this week. */
export function perWeek(values: (d: LocalDate) => number, today: LocalDate, n: number, ws: WeekStart): Bucket[] {
  const thisWeek = toLocalDate(startOfWeek(fromLocalDate(today), { weekStartsOn: ws }));
  return Array.from({ length: n }, (_, i) => {
    const start = addDaysLocal(thisWeek, (i - n + 1) * 7);
    let value = 0;
    for (let k = 0; k < 7; k++) value += values(addDaysLocal(start, k));
    return { start, label: start, value };
  });
}

export function completedPerWeek(tasks: readonly Task[], today: LocalDate, n: number, ws: WeekStart): Bucket[] {
  const days = new Map(completedPerDay(tasks, today, n * 7 + 7).map((b) => [b.start, b.value]));
  return perWeek((d) => days.get(d) ?? 0, today, n, ws);
}

/** "Nice" axis maximum and tick step for a bar chart. */
export function niceScale(max: number, ticks = 3): { top: number; step: number } {
  if (max <= 0) return { top: ticks, step: 1 };
  const raw = max / ticks;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag;
  const niceStep = Number.isInteger(step) ? step : Math.ceil(step);
  return { top: Math.ceil(max / niceStep) * niceStep, step: niceStep };
}

/** Days in a row (ending today, or yesterday while today is still empty) with at least one completion, and the best run. */
export function dayStreaks(perDay: readonly Bucket[]): { current: number; best: number } {
  let best = 0;
  let run = 0;
  for (const b of perDay) {
    run = b.value > 0 ? run + 1 : 0;
    best = Math.max(best, run);
  }
  let current = 0;
  let i = perDay.length - 1;
  if (i >= 0 && perDay[i].value === 0) i--;
  for (; i >= 0 && perDay[i].value > 0; i--) current++;
  return { current, best };
}

/** Heatmap intensity 0–4 relative to the busiest day (0 only for empty days). */
export const heatLevel = (v: number, max: number): number => (v <= 0 || max <= 0 ? 0 : Math.max(1, Math.ceil((v / max) * 4)));
