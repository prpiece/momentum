import { addDaysLocal, moveToDate, taskMinutes, todayLocal } from "./dates";
import { inSmartList, isOverdue, plannedMinutes, waitingNow, type TaskVM } from "./taskViews";
import { INBOX_ID, type LocalDate, type Task } from "./types";
import { sessionParts } from "./stats";

/** What the Plan my day and Shut down flows can do with a task (FEAT-03). Drop is "won't do", so it stays undoable. */
export const TRIAGE = ["keep", "tomorrow", "someday", "drop"] as const;
export type Triage = (typeof TRIAGE)[number];

/** The task changes for a triage choice, or "drop" for a status change. Keep moves to `today`; a timed task keeps its time. */
export function triagePatch(vm: TaskVM, action: Exclude<Triage, "drop">, today: LocalDate): Partial<Task> {
  if (action === "someday") return { schedule: { kind: "someday" } };
  return { schedule: moveToDate(vm.schedule, action === "keep" ? today : addDaysLocal(today, 1)) };
}

const byDeadlineThenPriority = (a: TaskVM, b: TaskVM) =>
  (a.task.deadline ?? "￿").localeCompare(b.task.deadline ?? "￿") || b.task.priority - a.task.priority || a.task.sortOrder - b.task.sortOrder;

/** Step 1: dated tasks left over from before today. Repeating series are left to Skip missed. */
export const overdueTasks = (active: readonly TaskVM[], today: LocalDate): TaskVM[] =>
  active.filter((vm) => isOverdue(vm, today) && !vm.task.recurrence && !waitingNow(vm, today)).sort(byDeadlineThenPriority);

/** Step 2: what could go on today: open tasks planned for the next 7 days or with no date, in Inbox or a list. Capped. */
export function pickCandidates(active: readonly TaskVM[], today: LocalDate, limit = 30): TaskVM[] {
  const end = addDaysLocal(today, 7);
  return active
    .filter((vm) => vm.task.status === "open" && !vm.task.recurrence && !waitingNow(vm, today) && !inSmartList("today", vm, today) && vm.schedule.kind !== "someday" && !isOverdue(vm, today) && (vm.date === null ? vm.task.listId === INBOX_ID || !vm.task.parentId : vm.date <= end))
    .sort((a, b) => (a.date ?? "￿").localeCompare(b.date ?? "￿") || byDeadlineThenPriority(a, b))
    .slice(0, limit);
}

/** Today's open tasks with their planned total, and how many have no estimate. */
export function todayPlan(active: readonly TaskVM[], today: LocalDate) {
  const vms = active.filter((vm) => inSmartList("today", vm, today));
  return { vms, minutes: plannedMinutes(vms), unestimated: vms.filter((vm) => taskMinutes({ schedule: vm.schedule, durationMin: vm.task.durationMin }) === null).length };
}

/** Shut down: what finished today (by End-of-day rule), the focus time and what is still open in Today. */
export function shutdownSummary(
  tasks: Iterable<Task>,
  sessions: Iterable<{ startAt: string; endAt?: string; seconds: number }>,
  active: readonly TaskVM[],
  today: LocalDate,
) {
  const done: Task[] = [];
  for (const t of tasks) if (t.status === "done" && !t.deletedAt && t.completedAt && todayLocal(new Date(t.completedAt)) === today) done.push(t);
  let focusSeconds = 0;
  for (const s of sessions) for (const p of sessionParts(s)) if (p.day === today) focusSeconds += p.seconds;
  return { done, focusMinutes: focusSeconds / 60, left: active.filter((vm) => inSmartList("today", vm, today) && !vm.task.recurrence) };
}
