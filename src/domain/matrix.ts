import { addDaysLocal, daysBetween, moveToDate } from "./dates";
import type { TaskVM } from "./taskViews";
import { PRIORITIES, type LocalDate, type Priority, type Schedule, type Task } from "./types";

/**
 * Eisenhower quadrants are derived, never stored: a task's quadrant follows from its priority
 * and due date under the user's rules, so it can never disagree with them.
 */
export type Quadrant = 1 | 2 | 3 | 4;
export const QUADRANTS: readonly Quadrant[] = [1, 2, 3, 4];

export const QUADRANT_INFO: Record<Quadrant, { title: string; hint: string; important: boolean; urgent: boolean }> = {
  1: { title: "Do First", hint: "Urgent & important", important: true, urgent: true },
  2: { title: "Schedule", hint: "Important, not urgent", important: true, urgent: false },
  3: { title: "Delegate", hint: "Urgent, not important", important: false, urgent: true },
  4: { title: "Eliminate", hint: "Neither urgent nor important", important: false, urgent: false },
};

export type MatrixRules = {
  /** Priorities that count as important. Default: medium and high. */
  importantPriorities: Priority[];
  /** Due within this many days (or overdue) counts as urgent. Default: 2. */
  urgentDays: number;
};

export const DEFAULT_RULES: MatrixRules = { importantPriorities: [2, 3], urgentDays: 2 };

export const isImportant = (t: Pick<Task, "priority">, r: MatrixRules) => r.importantPriorities.includes(t.priority);

export const isUrgent = (date: LocalDate | null, today: LocalDate, r: MatrixRules) =>
  date !== null && daysBetween(today, date) <= r.urgentDays;

export function quadrantOf(vm: Pick<TaskVM, "task" | "date">, today: LocalDate, r: MatrixRules): Quadrant {
  const imp = isImportant(vm.task, r);
  const urg = isUrgent(vm.date, today, r);
  return imp ? (urg ? 1 : 2) : urg ? 3 : 4;
}

/**
 * The smallest change that puts a task into quadrant `q`: only the attributes that disagree
 * with the target are touched. Becoming important raises priority to the highest important
 * level; losing importance drops it to the highest unimportant level. Becoming urgent dues it
 * today (keeping a time of day); losing urgency moves it just past the urgency window.
 */
export function patchForQuadrant(
  vm: { task: Pick<Task, "priority">; date: LocalDate | null; schedule: Schedule },
  q: Quadrant,
  today: LocalDate,
  r: MatrixRules,
): Partial<Task> {
  const want = QUADRANT_INFO[q];
  const patch: Partial<Task> = {};
  if (want.important !== isImportant(vm.task, r)) {
    const pool = PRIORITIES.filter((p) => r.importantPriorities.includes(p) === want.important);
    // PRIORITIES is ascending, so the last entry is the highest qualifying level.
    patch.priority = pool[pool.length - 1] ?? vm.task.priority;
  }
  if (want.urgent !== isUrgent(vm.date, today, r)) {
    const target = want.urgent ? today : addDaysLocal(today, r.urgentDays + 1);
    patch.schedule = moveToDate(vm.schedule, target);
  }
  return patch;
}
