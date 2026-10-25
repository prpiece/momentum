import { effective } from "../../domain/recurrence";
import type { Task } from "../../domain/types";
import { withUndo } from "../../lib/undo";
import * as data from "../../stores/data";
import { askScope, closeDrawer, setSelection, useUi } from "../../stores/ui";

/*
 * UI-level task actions: the store mutations plus the prompts (recurrence scope),
 * undo toasts and selection/drawer housekeeping every view wants.
 */

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

/** Delete with recurrence scope prompt (single recurring task) and undo toast. */
export async function deleteTasks(ids: string[], key: string | null = null) {
  if (!ids.length) return;
  const first = task(ids[0]);
  if (ids.length === 1 && first?.recurrence) {
    const scope = await askScope("delete");
    if (!scope) return;
    const k = key ?? effective(first)?.key ?? null;
    withUndo("Deleted", () => (k ? data.deleteOccurrence(first.id, k, scope) : data.deleteTasks([first.id])));
  } else {
    withUndo(ids.length === 1 ? `Deleted “${first?.title ?? "task"}”` : `Deleted ${ids.length} tasks`, () =>
      data.deleteTasks(ids),
    );
  }
  const { drawer, selection } = useUi.getState();
  if (drawer && ids.includes(drawer.id)) closeDrawer();
  setSelection(selection.filter((s) => !ids.includes(s)));
}

/**
 * Edit a task. Changes to when a recurring task happens (schedule / repeat) ask for scope;
 * other field edits apply to the whole series.
 */
export async function editTask(id: string, patch: Partial<Task>, key: string | null = null) {
  const t = task(id);
  if (!t) return;
  const timing = "schedule" in patch || "recurrence" in patch;
  if (!t.recurrence || !timing) return data.updateTask(id, patch);
  // Turning repeat off, or editing the rule itself, is a series-level change.
  if ("recurrence" in patch && !("schedule" in patch)) return data.updateTask(id, patch);
  const scope = await askScope("edit");
  if (!scope) return;
  const k = key ?? effective(t)?.key;
  if (!k) return data.updateTask(id, patch);
  data.editOccurrence(id, k, scope, patch);
  if (scope === "this") closeDrawer();
}

export function bulkEdit(ids: string[], label: string, patch: (t: Task) => Partial<Task>) {
  withUndo(label, () => ids.forEach((id) => task(id) && data.updateTask(id, patch(task(id)))));
}
