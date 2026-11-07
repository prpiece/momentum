/*
 * Perfect days, weeks, months and years (PLAN D64). Everything here is derived from tasks,
 * habit check-ins, rest days and logged reschedules; nothing about it is stored except the
 * rest days themselves and which celebrations have already played.
 */
import { startOfWeek } from "date-fns";
import { addDaysLocal, fromLocalDate, scheduleDate, toLocalDate } from "./dates";
import { isDone, isScheduled, type CheckinMap, type Habit } from "./habits";
import { nextOccurrence, occurrencesBetween } from "./recurrence";
import type { LocalDate, Task, WeekStart } from "./types";

/** A task moved to a later date on or after its due day ("pushed off"). Logged from v0.4. */
export type Push = { on: LocalDate; from: LocalDate; to: LocalDate };

export type ProgressInput = {
  /** Live top-level tasks in non-archived lists. */
  tasks: readonly Task[];
  habits: readonly Habit[];
  checkins: (habitId: string) => CheckinMap;
  restDays: ReadonlySet<LocalDate>;
  pushes: readonly Push[];
  weekStart: WeekStart;
  today: LocalDate;
};

export type DayKind = "perfect" | "failed" | "neutral" | "rest" | "pending";
export type Day = {
  kind: DayKind;
  /** Tasks due that day, and how many of those were dealt with by the end of it. */
  due: number;
  handled: number;
  /** Check-ins due from daily and weekday habits, and how many reached their goal. */
  habitsDue: number;
  habitsDone: number;
  /** ≥1 task due, ≥1 completed and (if there are habits) ≥1 habit kept. */
  active: boolean;
};

const localOf = (instant: string | null) => (instant ? toLocalDate(new Date(instant)) : null);
export const weekStartOf = (d: LocalDate, ws: WeekStart): LocalDate => toLocalDate(startOfWeek(fromLocalDate(d), { weekStartsOn: ws }));

type Prepared = {
  input: ProgressInput;
  oneOffs: { due: LocalDate; created: LocalDate; handled: LocalDate | null; done: boolean }[];
  series: { created: LocalDate; firstOpen: LocalDate | null; dueDays: Map<LocalDate, number> }[];
};

/** Expands recurrences once for the window [from, today]. */
export function prepare(input: ProgressInput, from: LocalDate): Prepared {
  const oneOffs: Prepared["oneOffs"] = [];
  const series: Prepared["series"] = [];
  const end = fromLocalDate(addDaysLocal(input.today, 1));
  for (const t of input.tasks) {
    const created = localOf(t.createdAt) ?? input.today;
    if (t.recurrence) {
      const dueDays = new Map<LocalDate, number>();
      for (const o of occurrencesBetween(t, fromLocalDate(from), end)) {
        const d = scheduleDate(o.schedule);
        if (d && d <= input.today) dueDays.set(d, (dueDays.get(d) ?? 0) + 1);
      }
      const first = nextOccurrence(t);
      series.push({ created, firstOpen: first ? scheduleDate(first.schedule) : null, dueDays });
      continue;
    }
    const due = scheduleDate(t.schedule);
    if (due) oneOffs.push({ due, created, handled: t.status === "open" ? null : localOf(t.completedAt), done: t.status === "done" });
  }
  return { input, oneOffs, series };
}

export function dayOf(p: Prepared, d: LocalDate): Day {
  const { input } = p;
  let due = 0;
  let handled = 0;
  let completed = 0;
  let open = 0;
  for (const t of p.oneOffs) {
    if (t.handled === d && t.done) completed++;
    if (t.created > d) continue;
    if (t.due === d) {
      due++;
      if (t.handled && t.handled <= d) handled++;
    }
    // Due (or overdue) and still not dealt with by the end of the day.
    if (t.due <= d && (!t.handled || t.handled > d)) open++;
  }
  for (const s of p.series) {
    due += s.dueDays.get(d) ?? 0;
    if (s.created <= d && s.firstOpen && s.firstOpen <= d) open++;
  }
  // Occurrences finished on the day are detached one-offs, so they're counted above.
  let habitsDue = 0;
  let habitsDone = 0;
  let kept = false;
  let hasHabits = false;
  for (const h of input.habits) {
    if (h.archived || !isScheduled(h, d)) continue;
    hasHabits = true;
    const doneToday = isDone(h, input.checkins(h.id).get(d));
    if (doneToday) kept = true;
    if (h.frequency.kind === "perWeek") continue;
    habitsDue++;
    if (doneToday) habitsDone++;
  }
  const pushed = input.pushes.some((x) => x.on === d && x.from <= d);
  const active = due > 0 && completed > 0 && (!hasHabits || kept);
  const base = { due, handled, habitsDue, habitsDone, active };
  if (input.restDays.has(d)) return { ...base, kind: "rest" };
  const perfect = due > 0 && open === 0 && !pushed && habitsDone === habitsDue;
  if (perfect) return { ...base, kind: "perfect" };
  if (d === input.today) return { ...base, kind: "pending" };
  return { ...base, kind: due === 0 ? "neutral" : "failed" };
}

export const WEEK_RATE = 0.9;
export const WEEK_ACTIVE_DAYS = 3;

/** A "very good" week: ≥3 active days, ≥90% of due tasks and habit check-ins done, weekly habits met. */
export function weekQualifies(p: Prepared, weekStart: LocalDate): boolean {
  const { input } = p;
  let active = 0;
  let due = 0;
  let done = 0;
  for (let i = 0; i < 7; i++) {
    const d = addDaysLocal(weekStart, i);
    if (d > input.today) break;
    const day = dayOf(p, d);
    if (day.kind === "rest") continue;
    if (day.active) active++;
    due += day.due + day.habitsDue;
    done += day.handled + day.habitsDone;
  }
  if (active < WEEK_ACTIVE_DAYS || due === 0 || done / due < WEEK_RATE) return false;
  const weekEnd = addDaysLocal(weekStart, 6);
  return input.habits.every((h) => {
    if (h.archived || h.frequency.kind !== "perWeek" || h.startDate > weekEnd) return true;
    const values = input.checkins(h.id);
    let n = 0;
    for (let i = 0; i < 7; i++) if (isDone(h, values.get(addDaysLocal(weekStart, i)))) n++;
    return n >= Math.min(7, h.frequency.count);
  });
}

/** Qualifying weeks in a row, ending with the week that starts on `weekStart`. */
export function weekRun(p: Prepared, weekStart: LocalDate, max = 60): number {
  let n = 0;
  for (let w = weekStart; n < max && weekQualifies(p, w); w = addDaysLocal(w, -7)) n++;
  return n;
}

/** Perfect days in a row up to today. Neutral and rest days are skipped; today counts once it's perfect. */
export function dayRun(p: Prepared, max = 400): number {
  let n = 0;
  for (let i = 0, d = p.input.today; i < max; i++, d = addDaysLocal(d, -1)) {
    const k = dayOf(p, d).kind;
    if (k === "perfect") n++;
    else if (k === "failed") break;
  }
  return n;
}

/** The longest perfect-day run from `from` to today, by the same rule as `dayRun`. */
export function bestDayRun(p: Prepared, from: LocalDate): number {
  let best = 0;
  let n = 0;
  for (let d = from; d <= p.input.today; d = addDaysLocal(d, 1)) {
    const k = dayOf(p, d).kind;
    if (k === "perfect") best = Math.max(best, ++n);
    else if (k === "failed") n = 0;
  }
  return best;
}

/** Perfect days from `start` to `end`, inclusive. */
export function perfectDays(p: Prepared, start: LocalDate, end: LocalDate): number {
  let n = 0;
  for (let d = start; d <= end; d = addDaysLocal(d, 1)) if (dayOf(p, d).kind === "perfect") n++;
  return n;
}

export type Tier = "day" | "week" | "month" | "year";
/** What a qualifying week's run is worth: every 52nd a year, every 4th a month. */
export const tierOfRun = (run: number): Tier => (run % 52 === 0 ? "year" : run % 4 === 0 ? "month" : "week");

/** A habit streak worth a celebration. */
export const STREAK_MILESTONES = [7, 30, 100, 365] as const;

/** Trophy ladders (D86): each kind climbs through levels, starting small. */
export const TROPHIES = [
  { id: "tasks", name: "Tasks done", unit: "tasks", levels: [10, 25, 50, 100, 250, 500, 1000, 2500] },
  { id: "focus", name: "Focus time", unit: "hours", levels: [1, 5, 10, 25, 50, 100, 250, 500] },
  { id: "habit", name: "Habit streak", unit: "days", levels: [3, 7, 14, 30, 60, 100, 200, 365] },
  { id: "days", name: "Perfect days", unit: "days", levels: [1, 5, 10, 25, 50, 100] },
  { id: "weeks", name: "Perfect weeks", unit: "in a row", levels: [1, 4, 12, 26, 52] },
] as const;
export type Trophy = (typeof TROPHIES)[number];
export type TrophyId = Trophy["id"];
export type TrophyCounts = Record<TrophyId, number>;

/** Levels reached: 0 = none yet, `levels.length` = the top. */
export const levelOf = (t: Trophy, count: number): number => t.levels.filter((l) => count >= l).length;

/**
 * The count each ladder measures. Perfect days and weeks come from the prepared window.
 * ponytail: perfect days only count within that window (~14 months); keep a running total if the top level needs longer.
 */
export function trophyCounts(p: Prepared, from: LocalDate, all: { doneTasks: number; focusMinutes: number; bestHabitDays: number }): TrophyCounts {
  let days = 0;
  for (let d = from; d <= p.input.today; d = addDaysLocal(d, 1)) if (dayOf(p, d).kind === "perfect") days++;
  let run = 0;
  let best = 0;
  for (let w = weekStartOf(from, p.input.weekStart); w <= p.input.today; w = addDaysLocal(w, 7)) {
    run = weekQualifies(p, w) ? run + 1 : 0;
    best = Math.max(best, run);
  }
  return { tasks: all.doneTasks, focus: all.focusMinutes / 60, habit: all.bestHabitDays, days, weeks: best };
}
