import type { Task } from "../../domain/types";
import { announce } from "../../lib/announce";
import { withUndo } from "../../stores/undo";
import * as data from "../../stores/data";
import { closeDrawer, setSelection, useUi } from "../../stores/ui";
import * as shared from "../../stores/taskActions";

/*
 * UI-level task actions: the store mutations plus the prompts (recurrence scope),
 * undo toasts and selection/drawer housekeeping every view wants.
 */

const task = (id: string) => data.useData.getState().tasks[id];

export function toggleDone(id: string, key: string | null = null) {
  const t = task(id);
  shared.toggleDone(id, key);
  // Completing speaks through its undo toast; reopening has none, so say it (FEAT-15).
  if (t && t.status !== "open" && task(id)?.status === "open") announce(`Reopened ${t.title}`);
}

export function setWontDo(id: string, key: string | null = null) {
  const t = task(id);
  shared.setWontDo(id, key);
  if (t?.status === "wont_do" && task(id)?.status === "open") announce(`Reopened ${t.title}`);
}

/** Delete with recurrence scope prompt and undo, then close the drawer and drop the selection. */
export async function deleteTasks(ids: string[], key: string | null = null) {
  if (!(await shared.deleteTasks(ids, key))) return;
  const { drawer, selection } = useUi.getState();
  if (drawer && ids.includes(drawer.id)) closeDrawer();
  setSelection(selection.filter((s) => !ids.includes(s)));
}

/** Edit a task (scope prompt for recurring timing changes); editing just this occurrence closes the drawer. */
export async function editTask(id: string, patch: Partial<Task>, key: string | null = null) {
  if ((await shared.editTask(id, patch, key)) === "this") closeDrawer();
}

export function bulkEdit(ids: string[], label: string, patch: (t: Task) => Partial<Task>) {
  withUndo(label, () => ids.forEach((id) => task(id) && data.updateTask(id, patch(task(id)))));
}
