import { droppedSchedule } from "@core/domain/calendar";
import { addDaysLocal, fromLocalDate, relativeDayLabel, toLocalDate, todayLocal } from "@core/domain/dates";
import type { LocalDate, Schedule } from "@core/domain/types";
import { editOccurrence, updateTask, useData } from "@core/stores/data";
import { applySchedule, currentSchedule, type Ref } from "@core/stores/schedule";
import { useSettings } from "@core/stores/settings";
import { withUndo } from "@core/stores/undo";
import { pickDate } from "./pickDate";
import { choose } from "./Sheet";

/** Today, Tomorrow, This weekend, Next week, Pick a date…, No date (F3). Resolves the day, null for no date, undefined when dismissed. */
export async function askDay(current: LocalDate | null): Promise<LocalDate | null | undefined> {
  const today = todayLocal();
  const dow = fromLocalDate(today).getDay();
  const weekStart = useSettings.getState().settings.weekStart;
  const days = (n: number) => addDaysLocal(today, n);
  const weekend = dow === 6 || dow === 0 ? days(7 - ((dow + 1) % 7)) : days(6 - dow);
  const nextWeek = days(((weekStart - dow + 7) % 7) || 7);
  const label = (d: LocalDate) => fromLocalDate(d).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
  const pick = await choose<LocalDate | "pick" | "none">("Move to", [
    { value: today, label: "Today", icon: "sun", detail: label(today), selected: current === today },
    { value: days(1), label: "Tomorrow", icon: "sunrise", detail: label(days(1)), selected: current === days(1) },
    { value: weekend, label: "This weekend", icon: "coffee", detail: label(weekend) },
    { value: nextWeek, label: "Next week", icon: "arrow-right", detail: label(nextWeek) },
    { value: "pick", label: "Pick a date…", icon: "calendar" },
    { value: "none", label: "No date", icon: "slash" },
  ]);
  if (pick === null) return undefined;
  if (pick === "none") return null;
  if (pick !== "pick") return pick;
  const d = await pickDate("date", current ? fromLocalDate(current) : new Date());
  return d ? toLocalDate(d) : undefined;
}

const moved = (to: Schedule, current: Schedule, date: LocalDate | null): Schedule => (date ? droppedSchedule(current, date, "keepTime", 0) : to);

/**
 * Asks for a day and moves the tasks there, keeping their times. One task goes through
 * applySchedule (it asks the recurrence scope); several move together with one Undo, a
 * recurring one by this occurrence only.
 */
export async function reschedule(refs: Ref[]) {
  if (!refs.length) return;
  const first = currentSchedule(refs[0]);
  const date = await askDay(first.kind === "none" ? null : first.kind === "timed" ? toLocalDate(new Date(first.start)) : first.date);
  if (date === undefined) return;
  const none: Schedule = { kind: "none" };
  if (refs.length === 1) return applySchedule(refs[0], moved(none, first, date));
  const tasks = useData.getState().tasks;
  const where = date ? relativeDayLabel(date, todayLocal()) : "No date";
  withUndo(`Moved ${refs.length} tasks to ${where}`, () => {
    for (const r of refs) {
      const t = tasks[r.id];
      if (!t) continue;
      const schedule = moved(none, currentSchedule(r), date);
      if (t.recurrence && r.key) editOccurrence(t.id, r.key, "this", { schedule });
      else updateTask(t.id, { schedule });
    }
  });
}
