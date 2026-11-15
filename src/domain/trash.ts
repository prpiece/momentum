/*
 * The Trash (D287): soft-deleted tasks, kept for 30 days. Pure: takes the task map.
 */
import { effective } from "./recurrence";
import type { Task } from "./types";

export const TRASH_DAYS = 30;
const DAY = 86_400_000;

export type TrashItem = { task: Task; /** Trashed with it: restored and purged together. */ ids: string[]; daysLeft: number };

/** What the Trash lists, newest first: one row per deletion. A subtask deleted with its parent isn't a row of its own, and a series that ended by finishing its last occurrence isn't a deletion. */
export function trashItems(tasks: Readonly<Record<string, Task>>, now: number): TrashItem[] {
  const all = Object.values(tasks);
  const kids = (id: string) => all.filter((t) => t.parentId === id);
  return all
    .filter((t) => t.deletedAt && !(t.recurrence && !effective(t)))
    .filter((t) => !(t.parentId && tasks[t.parentId]?.deletedAt === t.deletedAt))
    .map((task) => {
      const ids = [task.id];
      const seen = new Set(ids);
      for (let i = 0; i < ids.length; i++)
        for (const k of kids(ids[i])) if (k.deletedAt === task.deletedAt && !seen.has(k.id)) (seen.add(k.id), ids.push(k.id));
      const left = Math.ceil((Date.parse(task.deletedAt!) + TRASH_DAYS * DAY - now) / DAY);
      return { task, ids, daysLeft: Math.max(0, left) };
    })
    .sort((a, b) => b.task.deletedAt!.localeCompare(a.task.deletedAt!));
}
