import { isLocalDate } from "./dates";
import { isRecord } from "./settings";
import type { LocalDate, Task, Waiting } from "./types";

/*
 * Waiting for (D267). A waiting task leaves Today and Upcoming and sits in the Waiting list. It comes
 * back on its follow-up date (a person) or once the task it waits on is finished or gone (a task).
 */

/** Boundary parse (DB rows, backups, the agent API). Anything malformed is no wait. */
export function parseWaiting(v: unknown): Waiting | null {
  if (!isRecord(v)) return null;
  if (v.kind === "person" && typeof v.who === "string" && v.who.trim() && isLocalDate(v.followUp))
    return { kind: "person", who: v.who.trim().slice(0, 100), followUp: v.followUp };
  if (v.kind === "task" && typeof v.taskId === "string" && v.taskId) return { kind: "task", taskId: v.taskId };
  return null;
}

/**
 * Whether `taskId` waiting as `w` would wait on itself or close a loop (A waits on B waits on A).
 * Such a wait is refused before it is stored.
 */
export function waitLoops(taskId: string, w: Waiting | null, tasks: Readonly<Record<string, Pick<Task, "waiting">>>): boolean {
  const seen = new Set<string>([taskId]);
  for (let next = w; next?.kind === "task"; next = tasks[next.taskId]?.waiting ?? null) {
    if (seen.has(next.taskId)) return true;
    seen.add(next.taskId);
  }
  return false;
}

/** The task a wait is still blocked on is open and not deleted. */
export const blockerOpen = (w: Waiting | null, tasks: Readonly<Record<string, Pick<Task, "status" | "deletedAt">>>) =>
  w?.kind === "task" && tasks[w.taskId]?.status === "open" && !tasks[w.taskId]?.deletedAt;

/** Open tasks waiting on `taskId` (FEAT-21): what finishing it unblocks. */
export const blockedBy = <T extends Pick<Task, "id" | "waiting" | "status" | "deletedAt">>(taskId: string, tasks: Readonly<Record<string, T>>): T[] =>
  Object.values(tasks).filter((t) => t.waiting?.kind === "task" && t.waiting.taskId === taskId && t.status === "open" && !t.deletedAt);

const counts = new WeakMap<object, Map<string, number>>();
/** How many open tasks wait on each task id, computed once per tasks object so every row can ask. */
export function blockingCount(taskId: string, tasks: Readonly<Record<string, Pick<Task, "waiting" | "status" | "deletedAt">>>): number {
  let m = counts.get(tasks);
  if (!m) {
    m = new Map();
    for (const t of Object.values(tasks)) if (t.waiting?.kind === "task" && t.status === "open" && !t.deletedAt) m.set(t.waiting.taskId, (m.get(t.waiting.taskId) ?? 0) + 1);
    counts.set(tasks, m);
  }
  return m.get(taskId) ?? 0;
}

/**
 * Still waiting: a person before the follow-up date, or a task while `blocked` (its blocker is open,
 * computed by `derive`). Once it comes back the task returns to its normal views, wait still shown.
 */
export function isWaiting(w: Waiting | null, blocked: boolean, today: LocalDate): boolean {
  if (!w) return false;
  return w.kind === "person" ? today < w.followUp : blocked;
}

/** A person's wait that has come back today or earlier: it shows in Today as a follow-up. */
export const followUpDue = (w: Waiting | null, today: LocalDate) => w?.kind === "person" && w.followUp <= today;
