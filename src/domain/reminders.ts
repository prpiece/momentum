import { calendarItems, type CalItem } from "./calendar";
import { addDaysLocal, atLocalTime, formatTime, relativeDayLabel, scheduleDate, toLocalDate } from "./dates";
import { currentStreak, isBuild, isDone, isDueToday, streakAtRiskOn, type CheckinMap, type Habit } from "./habits";
import type { TaskVM } from "./taskViews";
import type { CalendarEvent, Reminder, Schedule, Settings, WeekStart } from "./types";

export const BEFORE_PRESETS = [
  { label: "At start", minutes: 0 },
  { label: "5 min before", minutes: 5 },
  { label: "15 min before", minutes: 15 },
  { label: "30 min before", minutes: 30 },
  { label: "1 hour before", minutes: 60 },
  { label: "1 day before", minutes: 1440 },
];
export const DAY_PRESETS: { label: string; daysBefore: number; time: string }[] = [
  { label: "On the day, 9:00", daysBefore: 0, time: "09:00" },
  { label: "Day before, 9:00", daysBefore: 1, time: "09:00" },
  { label: "Day before, 18:00", daysBefore: 1, time: "18:00" },
  { label: "2 days before, 9:00", daysBefore: 2, time: "09:00" },
];

export function reminderLabel(r: Reminder): string {
  if (r.kind === "before") return BEFORE_PRESETS.find((p) => p.minutes === r.minutes)?.label ?? `${r.minutes} min before`;
  const when = r.daysBefore === 0 ? "On the day" : r.daysBefore === 1 ? "Day before" : `${r.daysBefore} days before`;
  return `${when}, ${r.time}`;
}

export type ReminderTarget =
  | { kind: "task"; id: string; occurrenceKey: string | null }
  | { kind: "habit"; id: string }
  | { kind: "event"; id: string; occurrenceKey: string | null }
  /** The daily summary: opens Today. */
  | { kind: "digest" };

export type Fire = {
  /** Stable identity: includes the fire time, so rescheduling a task re-arms its reminder. */
  key: string;
  at: Date;
  title: string;
  body: string;
  target: ReminderTarget;
};

/**
 * When a task reminder goes off for a given (effective) schedule. "N minutes before" is
 * wall-clock arithmetic, so "1 day before" a 09:00 task is 09:00 the previous day even when
 * a DST change falls in between.
 */
export function reminderAt(s: Schedule, r: Reminder): Date | null {
  if (r.kind === "before") {
    if (s.kind !== "timed") return null;
    const d = new Date(s.start);
    const wall = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()) - r.minutes * 60_000;
    const w = new Date(wall);
    return new Date(w.getUTCFullYear(), w.getUTCMonth(), w.getUTCDate(), w.getUTCHours(), w.getUTCMinutes());
  }
  const date = scheduleDate(s);
  if (!date) return null;
  return atLocalTime(addDaysLocal(date, -r.daysBefore), r.time);
}

/** Task reminders (current occurrence) and habit reminders (if still due) firing in (from, to]. */
export function remindersBetween(
  tasks: readonly TaskVM[],
  habits: readonly Habit[],
  habitValues: (id: string) => CheckinMap,
  from: Date,
  to: Date,
  timeFormat: "12h" | "24h",
  ws: WeekStart,
): Fire[] {
  const out: Fire[] = [];
  const today = toLocalDate(to);
  for (const vm of tasks) {
    const t = vm.task;
    if (t.status !== "open" || !t.reminders.length) continue;
    for (const r of t.reminders) {
      const at = reminderAt(vm.schedule, r);
      if (!at || at <= from || at > to) continue;
      // Worded for the moment it shows: "Today", "Tomorrow" relative to the fire time, not the window's end.
      const day = toLocalDate(at);
      const date = scheduleDate(vm.schedule) ?? day;
      const when =
        vm.schedule.kind === "timed"
          ? `${relativeDayLabel(date, day)} at ${formatTime(new Date(vm.schedule.start), timeFormat)}`
          : `Due ${relativeDayLabel(date, day).toLowerCase()}`;
      out.push({ key: `task:${t.id}:${vm.key ?? ""}:${at.toISOString()}`, at, title: t.title, body: when, target: { kind: "task", id: t.id, occurrenceKey: vm.key } });
    }
  }
  // Habit reminders are wall-clock times on each day in the window.
  for (const h of habits) {
    if (h.archived || !h.reminders.length) continue;
    for (let d = toLocalDate(from); d <= today; d = addDaysLocal(d, 1)) {
      const values = habitValues(h.id);
      if (!isDueToday(h, values, d, ws) || isDone(h, values.get(d))) continue;
      for (const time of h.reminders) {
        const at = atLocalTime(d, time);
        if (at <= from || at > to) continue;
        out.push({ key: `habit:${h.id}:${d}:${time}`, at, title: h.name, body: "Habit reminder", target: { kind: "habit", id: h.id } });
      }
    }
  }
  return out.sort((a, b) => a.at.getTime() - b.at.getTime());
}

/** "Starting now" alerts for timed tasks (still open) and events whose start falls in (from, to]. */
export function startsBetween(items: readonly CalItem[], from: Date, to: Date, timeFormat: "12h" | "24h"): Fire[] {
  const out: Fire[] = [];
  for (const i of items) {
    if (i.allDay || !i.start || !i.end || i.done || (i.source !== "task" && i.source !== "event")) continue;
    if (i.start <= from || i.start > to) continue;
    const target: ReminderTarget = i.source === "task" ? { kind: "task", id: i.id, occurrenceKey: i.key } : { kind: "event", id: i.id, occurrenceKey: i.key };
    const body = `Starting now · ${formatTime(i.start, timeFormat)}–${formatTime(i.end, timeFormat)}`;
    out.push({ key: `start:${i.uid}:${i.start.toISOString()}`, at: i.start, title: i.title, body, target });
  }
  return out;
}

/** The daily summary at `time` on each day in (from, to]: what is due that day and what is overdue. Skipped when both are zero. */
export function digestBetween(tasks: readonly TaskVM[], time: string, from: Date, to: Date): Fire[] {
  const out: Fire[] = [];
  for (let d = toLocalDate(from); d <= toLocalDate(to); d = addDaysLocal(d, 1)) {
    const at = atLocalTime(d, time);
    if (at <= from || at > to) continue;
    let due = 0;
    let overdue = 0;
    for (const vm of tasks) {
      if (vm.task.status !== "open" || !vm.date) continue;
      if (vm.date === d) due++;
      else if (vm.date < d) overdue++;
    }
    if (!due && !overdue) continue;
    const parts = [due && `${due} due today`, overdue && `${overdue} overdue`].filter(Boolean);
    out.push({ key: `digest:${d}`, at, title: "Your day in Momentum", body: parts.join(" · "), target: { kind: "digest" } });
  }
  return out;
}

/**
 * "Keep your streak" nudges at `time` on each day in (from, to] where a running streak can still be
 * saved. The streak is read as of `from`'s day. Habits at risk on the same day share one notification.
 */
export function streakFires(habits: readonly Habit[], habitValues: (id: string) => CheckinMap, time: string, from: Date, to: Date, ws: WeekStart): Fire[] {
  const today = toLocalDate(from);
  const byDay = new Map<string, { habit: Habit; count: number; unit: string }[]>();
  for (const h of habits) {
    if (h.archived || !isBuild(h)) continue;
    const values = habitValues(h.id);
    const { count, unit } = currentStreak(h, values, today, ws);
    if (!count) continue;
    for (let d = today; d <= toLocalDate(to); d = addDaysLocal(d, 1)) {
      const at = atLocalTime(d, time);
      if (at <= from || at > to || !streakAtRiskOn(h, values, d, ws)) continue;
      byDay.set(d, [...(byDay.get(d) ?? []), { habit: h, count, unit }]);
    }
  }
  return [...byDay].map(([d, list]) => {
    const [first] = list;
    const single = list.length === 1;
    const plural = (x: { count: number; unit: string }) => `${x.count} ${x.unit}${x.count === 1 ? "" : "s"}`;
    return {
      key: `streak:${d}:${time}`,
      at: atLocalTime(d, time),
      title: single ? `Keep your ${first.count}-${first.unit} ${first.habit.name} streak` : "Keep your streaks alive",
      body: single ? "Check in before the streak breaks" : list.map((x) => `${x.habit.name} (${plural(x)})`).join(", "),
      target: { kind: "habit", id: first.habit.id } as const,
    };
  }).sort((a, b) => a.at.getTime() - b.at.getTime());
}

/** One notification per target and moment: an explicit "at start" reminder and a start alert don't both fire. */
export function dedupeFires(fires: readonly Fire[]): Fire[] {
  const seen = new Set<string>();
  return fires.filter((f) => {
    const id = `${f.target.kind}:${"id" in f.target ? f.target.id : ""}:${f.at.getTime()}`;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

export type FireSources = {
  active: readonly TaskVM[];
  events: readonly CalendarEvent[];
  habits: readonly Habit[];
  habitValues: (id: string) => CheckinMap;
  settings: Pick<Settings, "timeFormat" | "weekStart" | "notify" | "streakReminder">;
};

/**
 * Every notification the settings allow in (from, to], one per target and moment, soonest first.
 * `startFrom` narrows the "starting now" alerts (desktop skips stale ones after a gap).
 */
export function upcomingFires(src: FireSources, from: Date, to: Date, startFrom = from): Fire[] {
  const { timeFormat, weekStart, notify: n } = src.settings;
  if (!n.enabled) return [];
  const items = n.starts ? calendarItems({ tasks: src.active, events: src.events, colorOf: () => "", showCompleted: false }, toLocalDate(startFrom), toLocalDate(to)) : [];
  const wanted = (f: Fire) => (f.target.kind === "habit" ? n.habitReminders : n.taskReminders);
  return dedupeFires([
    ...remindersBetween(src.active, src.habits, src.habitValues, from, to, timeFormat, weekStart).filter(wanted),
    ...startsBetween(items, startFrom, to, timeFormat),
    ...(n.digest ? digestBetween(src.active, n.digestTime, from, to) : []),
    ...(n.habitReminders && src.settings.streakReminder.on ? streakFires(src.habits, src.habitValues, src.settings.streakReminder.time, from, to, weekStart) : []),
  ]).sort((a, b) => a.at.getTime() - b.at.getTime());
}
