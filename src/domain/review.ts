import { addDaysLocal, daysBetween, fromLocalDate, toLocalDate, todayLocal } from "./dates";
import { startOfWeek } from "date-fns";
import { dayOf, inSmartList, isOverdue, waitingNow, type TaskVM } from "./taskViews";
import { INBOX_ID, type LocalDate, type Task, type WeekStart } from "./types";
import { followUpDue } from "./waiting";

export const STALE_INBOX_DAYS = 7;

export type WeeklyReview = {
  overdue: TaskVM[];
  /** Waiting for a person whose follow-up date has come. */
  followUps: TaskVM[];
  /** Undated Inbox tasks older than STALE_INBOX_DAYS. */
  staleInbox: TaskVM[];
  someday: TaskVM[];
  /** Tasks finished in `lastWeek`. */
  lastWeekDone: number;
  lastWeek: { from: LocalDate; to: LocalDate };
  /** Open tasks dated in the next 7 days. */
  nextWeek: TaskVM[];
};

/** The GTD-style weekly review (FEAT-04): plain filtered selectors over live tasks, nothing stored. */
export function weeklyReview(active: readonly TaskVM[], tasks: Iterable<Task>, today: LocalDate, ws: WeekStart): WeeklyReview {
  const open = active.filter((vm) => vm.task.status === "open");
  const thisWeek = toLocalDate(startOfWeek(fromLocalDate(today), { weekStartsOn: ws }));
  const lastWeek = { from: addDaysLocal(thisWeek, -7), to: addDaysLocal(thisWeek, -1) };
  let lastWeekDone = 0;
  for (const t of tasks) {
    if (t.status !== "done" || t.deletedAt || !t.completedAt) continue;
    const d = todayLocal(new Date(t.completedAt));
    if (d >= lastWeek.from && d <= lastWeek.to) lastWeekDone++;
  }
  const end = addDaysLocal(today, 7);
  return {
    overdue: open.filter((vm) => isOverdue(vm, today) && !waitingNow(vm, today)),
    followUps: open.filter((vm) => followUpDue(vm.task.waiting, today)),
    staleInbox: open.filter((vm) => vm.task.listId === INBOX_ID && vm.schedule.kind === "none" && !vm.task.parentId && daysBetween(toLocalDate(new Date(vm.task.createdAt)), today) >= STALE_INBOX_DAYS),
    someday: open.filter((vm) => inSmartList("someday", vm, today)),
    lastWeekDone,
    lastWeek,
    nextWeek: open.filter((vm) => dayOf(vm) !== null && dayOf(vm)! >= today && dayOf(vm)! <= end && !waitingNow(vm, today)).sort((a, b) => (dayOf(a) ?? "").localeCompare(dayOf(b) ?? "")),
  };
}
