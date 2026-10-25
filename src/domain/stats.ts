import { startOfWeek } from "date-fns";
import { addDaysLocal, fromLocalDate, toLocalDate } from "./dates";
import { completionRate, type CheckinMap, type Habit } from "./habits";
import type { LocalDate, Task, WeekStart } from "./types";

export type Bucket = { start: LocalDate; label: string; value: number };

const localDay = (iso: string) => toLocalDate(new Date(iso));

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

/** Average completion rate across habits that expected anything in the window (null if none did). */
export function habitConsistency(habits: readonly Habit[], values: (id: string) => CheckinMap, from: LocalDate, to: LocalDate, today: LocalDate, ws: WeekStart): number | null {
  const rates = habits
    .filter((h) => !h.archived)
    .map((h) => completionRate(h, values(h.id), from, to, today, ws))
    .filter((r): r is number => r !== null);
  return rates.length ? rates.reduce((a, b) => a + b, 0) / rates.length : null;
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
