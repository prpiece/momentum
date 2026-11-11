/*
 * Task actions both apps share (PLAN D229): the store mutations plus the recurrence-scope prompt
 * and undo toasts. Desktop's features/tasks/actions.ts adds its drawer and selection housekeeping.
 */
import { effective } from "../domain/recurrence";
import type { Task } from "../domain/types";
import { askScope } from "./ask";
import * as data from "./data";
import { withUndo } from "./undo";

const task = (id: string) => data.useData.getState().tasks[id];

export function toggleDone(id: string, key: string | null = null) {
  const t = task(id);
  if (!t) return;
  if (t.status === "open") withUndo(`Completed “${t.title}”`, () => data.setStatus(id, "done", key));
  else data.setStatus(id, "open");
}

export function setWontDo(id: string, key: string | null = null) {
  const t = task(id);
  if (!t) return;
  if (t.status === "wont_do") data.setStatus(id, "open");
  else withUndo(`Marked “${t.title}” as won't do`, () => data.setStatus(id, "wont_do", key));
}

/** Delete with recurrence scope prompt (single recurring task) and undo toast. False on cancel. */
export async function deleteTasks(ids: string[], key: string | null = null): Promise<boolean> {
  if (!ids.length) return false;
  const first = task(ids[0]);
  if (ids.length === 1 && first?.recurrence) {
    const scope = await askScope("delete");
    if (!scope) return false;
    const k = key ?? effective(first)?.key ?? null;
    withUndo("Deleted", () => (k ? data.deleteOccurrence(first.id, k, scope) : data.deleteTasks([first.id])));
  } else {
    withUndo(ids.length === 1 ? `Deleted “${first?.title ?? "task"}”` : `Deleted ${ids.length} tasks`, () => data.deleteTasks(ids));
  }
  return true;
}

/**
 * Edit a task. Changes to when a recurring task happens (schedule / repeat) ask for scope;
 * other field edits apply to the whole series. Returns the scope used, if one was asked.
 */
export async function editTask(id: string, patch: Partial<Task>, key: string | null = null): Promise<data.Scope | null> {
  const t = task(id);
  if (!t) return null;
  const timing = "schedule" in patch || "recurrence" in patch;
  if (!t.recurrence || !timing) return (data.updateTask(id, patch), null);
  // Turning repeat off, or editing the rule itself, is a series-level change.
  if ("recurrence" in patch && !("schedule" in patch)) return (data.updateTask(id, patch), null);
  const scope = await askScope("edit");
  if (!scope) return null;
  const k = key ?? effective(t)?.key;
  if (!k) return (data.updateTask(id, patch), null);
  data.editOccurrence(id, k, scope, patch);
  return scope;
}
