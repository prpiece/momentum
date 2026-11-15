import * as core from "./core.bundle.js";
import type { Task, TaskList } from "./core.bundle.js";

/**
 * The tasks a chat command sees: the app's own `derive` (ADR 0008), so Today, Overdue, Inbox and
 * the rest agree with the apps. That drops archived lists and resolves a wait on a finished task,
 * and tasks whose list is gone (the app deletes them with the list) are dropped here.
 */
export function chatViews(tasks: Task[], lists: TaskList[]) {
  const byList = Object.fromEntries(lists.map((l) => [l.id, l]));
  const live = tasks.filter((t) => !t.deletedAt && (t.listId === core.INBOX_ID || byList[t.listId]));
  return core.derive(Object.fromEntries(live.map((t) => [t.id, t])), byList).active;
}
