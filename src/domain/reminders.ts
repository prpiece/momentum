import { addDaysLocal, atLocalTime, formatTime, relativeDayLabel, scheduleDate, toLocalDate } from "./dates";
import { isDone, isDueToday, type CheckinMap, type Habit } from "./habits";
import type { TaskVM } from "./taskViews";
import type { Reminder, Schedule, WeekStart } from "./types";

export type ReminderTarget = { kind: "task"; id: string; occurrenceKey: string | null } | { kind: "habit"; id: string };

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
      const date = scheduleDate(vm.schedule);
      const when =
        vm.schedule.kind === "timed"
          ? `${relativeDayLabel(date ?? today, today)} at ${formatTime(new Date(vm.schedule.start), timeFormat)}`
          : `Due ${relativeDayLabel(date ?? today, today).toLowerCase()}`;
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
        out.push({ key: `habit:${h.id}:${d}:${time}`, at, title: `${h.icon} ${h.name}`, body: "Habit reminder", target: { kind: "habit", id: h.id } });
      }
    }
  }
  return out.sort((a, b) => a.at.getTime() - b.at.getTime());
}
