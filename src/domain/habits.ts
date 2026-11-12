import { startOfWeek } from "date-fns";
import { addDaysLocal, daysBetween, fromLocalDate, toLocalDate } from "./dates";
import type { Instant, LocalDate, WeekStart } from "./types";

export type HabitFrequency =
  | { kind: "daily" }
  /** 0 = Sunday … 6 = Saturday */
  | { kind: "weekdays"; days: number[] }
  | { kind: "perWeek"; count: number };

/**
 * What a day asks for. once / count / amount build a habit (reach the target); `limit` and `quit`
 * are the opposite: a day succeeds unless the logged value goes over the cap (limit) or is above 0 (quit).
 */
export type HabitGoal =
  /** Tap to complete. */
  | { kind: "once" }
  /** Fixed increments toward a target, e.g. 8 glasses. */
  | { kind: "count"; target: number; unit: string }
  /** Manually entered amount toward a target, e.g. 5 km. */
  | { kind: "amount"; target: number; unit: string }
  /** Stay at or under `cap` per day, e.g. 5 minutes. Unlogged days succeed. */
  | { kind: "limit"; cap: number; unit: string }
  /** Avoid entirely; the check-in value counts slips. Unlogged days succeed. */
  | { kind: "quit" };

export type Habit = {
  id: string;
  name: string;
  icon: string;
  color: string;
  goal: HabitGoal;
  frequency: HabitFrequency;
  /** Wall-clock reminder times, `HH:mm`. */
  reminders: string[];
  groupId: string | null;
  sortOrder: number;
  archived: boolean;
  /** Days before this never count against streaks or completion rate. */
  startDate: LocalDate;
  createdAt: Instant;
};

export type HabitGroup = { id: string; name: string; sortOrder: number };

export type Mood = 1 | 2 | 3 | 4 | 5;
export type HabitCheckin = { habitId: string; date: LocalDate; value: number; note: string; mood: Mood | null };

/** value per date for one habit */
export type CheckinMap = ReadonlyMap<LocalDate, number>;

/** Build habits are done by reaching a target; limit and quit habits are "avoid" habits. */
export const isBuild = (h: Pick<Habit, "goal">) => h.goal.kind === "once" || h.goal.kind === "count" || h.goal.kind === "amount";
/** The number the day's value is measured against (cap for limit, 1 for quit). */
export const targetOf = (h: Pick<Habit, "goal">) =>
  h.goal.kind === "once" ? 1 : h.goal.kind === "quit" ? 1 : h.goal.kind === "limit" ? Math.max(0, h.goal.cap) : Math.max(1, h.goal.target);
/** Whether the day succeeded: target reached (build), or not over the cap / no slip (limit, quit). */
export function isDone(h: Pick<Habit, "goal">, value: number | undefined): boolean {
  const v = value ?? 0;
  if (h.goal.kind === "limit") return v <= h.goal.cap;
  if (h.goal.kind === "quit") return v === 0;
  return v >= targetOf(h);
}
/** Unit shown next to amounts ("min", "glasses"); empty when the goal has none. */
export const unitOf = (h: Pick<Habit, "goal">) => (h.goal.kind === "once" || h.goal.kind === "quit" ? "" : h.goal.unit);

/** Short goal text for headers: "5 km a day", "max 5 min a day", "none". Empty for plain once-habits. */
export function goalLabel(g: HabitGoal): string {
  if (g.kind === "once") return "";
  if (g.kind === "quit") return "none";
  const n = (x: number) => (Number.isInteger(x) ? String(x) : x.toFixed(1));
  return (g.kind === "limit" ? `max ${n(g.cap)} ${g.unit} a day` : `${n(g.target)} ${g.unit} a day`).replace("  ", " ");
}

const weekStartOf = (d: LocalDate, ws: WeekStart) => toLocalDate(startOfWeek(fromLocalDate(d), { weekStartsOn: ws }));

/** Whether the habit expects a check-in on `date` (per-week habits accept any day). */
export function isScheduled(h: Pick<Habit, "frequency" | "startDate">, date: LocalDate): boolean {
  if (date < h.startDate) return false;
  const f = h.frequency;
  if (f.kind === "weekdays") return f.days.includes(fromLocalDate(date).getDay());
  return true;
}

function weekDoneCount(h: Habit, checkins: CheckinMap, weekStart: LocalDate): number {
  let n = 0;
  for (let i = 0; i < 7; i++) if (isDone(h, checkins.get(addDaysLocal(weekStart, i)))) n++;
  return n;
}

const weeklyTarget = (h: Habit) => (h.frequency.kind === "perWeek" ? Math.max(1, Math.min(7, h.frequency.count)) : 0);

/** Show it in Today: scheduled today and not done yet (per-week: this week's target not met yet). */
export function isDueToday(h: Habit, checkins: CheckinMap, today: LocalDate, ws: WeekStart): boolean {
  if (h.archived || !isScheduled(h, today)) return false;
  if (h.frequency.kind === "perWeek") return weekDoneCount(h, checkins, weekStartOf(today, ws)) < weeklyTarget(h) || isDone(h, checkins.get(today));
  return true;
}

/** Whether a check-in on `d` would still save the streak: daily habits on each unfinished scheduled day, per-week habits on the week's last day while its target is unmet. */
export function streakAtRiskOn(h: Habit, checkins: CheckinMap, d: LocalDate, ws: WeekStart): boolean {
  if (h.frequency.kind === "perWeek") {
    const w = weekStartOf(d, ws);
    return d === addDaysLocal(w, 6) && weekDoneCount(h, checkins, w) < weeklyTarget(h);
  }
  return isScheduled(h, d) && !isDone(h, checkins.get(d));
}

export type Streak = { count: number; unit: "day" | "week" };

/**
 * Current streak. Daily / weekday habits count consecutive *scheduled* days that were done;
 * unscheduled days neither break nor extend it, and an unfinished today doesn't break it yet.
 * Per-week habits count consecutive weeks that met the target; the current week only adds once met.
 */
export function currentStreak(h: Habit, checkins: CheckinMap, today: LocalDate, ws: WeekStart): Streak {
  if (h.frequency.kind === "perWeek") {
    let week = weekStartOf(today, ws);
    let count = weekDoneCount(h, checkins, week) >= weeklyTarget(h) ? 1 : 0;
    week = addDaysLocal(week, -7);
    while (addDaysLocal(week, 6) >= h.startDate && weekDoneCount(h, checkins, week) >= weeklyTarget(h)) {
      count++;
      week = addDaysLocal(week, -7);
    }
    return { count, unit: "week" };
  }
  let count = 0;
  let d = today;
  if (isScheduled(h, d) && !isDone(h, checkins.get(d)) && isBuild(h)) d = addDaysLocal(d, -1);
  for (; d >= h.startDate; d = addDaysLocal(d, -1)) {
    if (!isScheduled(h, d)) continue;
    if (!isDone(h, checkins.get(d))) break;
    count++;
  }
  return { count, unit: "day" };
}

/** Longest run ever, same rules as `currentStreak`. */
export function bestStreak(h: Habit, checkins: CheckinMap, today: LocalDate, ws: WeekStart): Streak {
  let best = 0;
  let run = 0;
  if (h.frequency.kind === "perWeek") {
    for (let w = weekStartOf(h.startDate, ws); w <= today; w = addDaysLocal(w, 7)) {
      if (weekDoneCount(h, checkins, w) >= weeklyTarget(h)) best = Math.max(best, ++run);
      else if (addDaysLocal(w, 6) < today) run = 0; // the current, unfinished week can't break a run
    }
    return { count: best, unit: "week" };
  }
  for (let d = h.startDate; d <= today; d = addDaysLocal(d, 1)) {
    if (!isScheduled(h, d)) continue;
    if (isDone(h, checkins.get(d))) best = Math.max(best, ++run);
    else if (d < today || !isBuild(h)) run = 0;
  }
  return { count: best, unit: "day" };
}

/**
 * Share of expected check-ins that happened in [from, to] (clipped to the habit's start).
 * Per-week habits: share of weeks that met the target (the current unfinished week is skipped
 * unless already met). Returns null when nothing was expected yet.
 */
export function completionRate(h: Habit, checkins: CheckinMap, from: LocalDate, to: LocalDate, today: LocalDate, ws: WeekStart): number | null {
  const start = from < h.startDate ? h.startDate : from;
  const end = to > today ? today : to;
  if (end < start) return null;
  if (h.frequency.kind === "perWeek") {
    let met = 0;
    let total = 0;
    for (let w = weekStartOf(start, ws); w <= end; w = addDaysLocal(w, 7)) {
      const ok = weekDoneCount(h, checkins, w) >= weeklyTarget(h);
      if (addDaysLocal(w, 6) >= today && !ok) continue;
      total++;
      if (ok) met++;
    }
    return total ? met / total : null;
  }
  let done = 0;
  let total = 0;
  for (let d = start; d <= end; d = addDaysLocal(d, 1)) {
    if (!isScheduled(h, d)) continue;
    const ok = isDone(h, checkins.get(d));
    if (d === today && !ok && isBuild(h)) continue; // today still in progress
    total++;
    if (ok) done++;
  }
  return total ? done / total : null;
}

export function frequencyLabel(f: HabitFrequency): string {
  if (f.kind === "daily") return "Every day";
  if (f.kind === "perWeek") return `${f.count}× a week`;
  const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  if (f.days.length === 5 && [1, 2, 3, 4, 5].every((d) => f.days.includes(d))) return "Weekdays";
  return [...f.days].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)).map((d) => names[d]).join(", ");
}

/** Days between two dates inclusive (helper for review ranges). */
export const spanDays = (a: LocalDate, b: LocalDate) => daysBetween(a, b) + 1;
