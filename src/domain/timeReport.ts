import { taskMinutes, todayLocal } from "./dates";
import { sessionParts } from "./stats";
import type { LocalDate, Task } from "./types";

type Session = { taskId: string | null; startAt: string; endAt?: string; seconds: number };
export type TimeRow = { id: string; minutes: number };

/** Focus minutes per task in [from, to], split across days like every other focus stat. Sessions with no task are skipped. */
function minutesByTask(sessions: Iterable<Session>, from: LocalDate, to: LocalDate): Map<string, number> {
  const by = new Map<string, number>();
  for (const s of sessions) {
    if (!s.taskId) continue;
    for (const p of sessionParts(s)) if (p.day >= from && p.day <= to) by.set(s.taskId, (by.get(s.taskId) ?? 0) + p.seconds / 60);
  }
  return by;
}

/**
 * Focus time by list and by tag for a range (FEAT-11). A task with several tags counts in each of them, so tag
 * rows can add up to more than the total. `unlinked` is focus not tied to a task. Biggest first.
 */
export function focusBreakdown(sessions: Iterable<Session>, tasks: Readonly<Record<string, Task>>, from: LocalDate, to: LocalDate) {
  const list = new Map<string, number>();
  const tag = new Map<string, number>();
  let total = 0;
  let unlinked = 0;
  for (const s of sessions) for (const p of sessionParts(s)) if (p.day >= from && p.day <= to) (total += p.seconds / 60, s.taskId || (unlinked += p.seconds / 60));
  for (const [id, min] of minutesByTask(sessions, from, to)) {
    const t = tasks[id];
    if (!t) continue;
    list.set(t.listId, (list.get(t.listId) ?? 0) + min);
    for (const g of t.tags) tag.set(g, (tag.get(g) ?? 0) + min);
  }
  const rows = (m: Map<string, number>): TimeRow[] => [...m].map(([id, minutes]) => ({ id, minutes })).sort((a, b) => b.minutes - a.minutes);
  return { total, unlinked, byList: rows(list), byTag: rows(tag) };
}

/**
 * Estimate against actual on finished tasks that have both (FEAT-11): the median of actual / estimate
 * (above 1 means tasks take longer than planned) over the tasks finished in [from, to], using all their focus time.
 */
export function estimateAccuracy(sessions: Iterable<Session>, tasks: Iterable<Task>, from: LocalDate, to: LocalDate) {
  const actual = minutesByTask(sessions, "0000-00-00", "9999-99-99");
  const ratios: number[] = [];
  let estimated = 0;
  let spent = 0;
  for (const t of tasks) {
    if (t.status !== "done" || t.deletedAt || !t.completedAt) continue;
    const d = todayLocal(new Date(t.completedAt));
    const est = taskMinutes(t);
    const act = actual.get(t.id);
    if (d < from || d > to || !est || !act) continue;
    ratios.push(act / est);
    estimated += est;
    spent += act;
  }
  ratios.sort((a, b) => a - b);
  const mid = ratios.length >> 1;
  const median = ratios.length === 0 ? null : ratios.length % 2 ? ratios[mid] : (ratios[mid - 1] + ratios[mid]) / 2;
  return { count: ratios.length, median, estimated, spent };
}

/** Actual focus minutes on one task (all time), for the drawer line. */
export const actualMinutes = (sessions: Iterable<Session>, taskId: string): number | null => {
  let n = 0;
  for (const s of sessions) if (s.taskId === taskId) n += s.seconds / 60;
  return n > 0 ? n : null;
};
