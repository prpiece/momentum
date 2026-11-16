import { clean, finalize, type ImportPlan, type PlanList, type PlanTask, type Skipped } from "./importPlan";

/*
 * Google Tasks import: the Takeout file Tasks/Tasks.json, `{ kind: "tasks#taskLists", items: [{ title, items: [task] }] }`.
 * A task has title, notes, status ("needsAction" | "completed"), due (a date at midnight UTC: Google keeps no time),
 * completed (instant) and parent (another task's id). Google Tasks has no repeats or priorities.
 */

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown) => (typeof v === "string" ? v : "");

/** True for a Takeout file or a single task list, so the detector can route it here. */
export function looksLikeGoogleTasks(json: unknown): boolean {
  const kind = isObj(json) ? str(json.kind) : "";
  return kind === "tasks#taskLists" || kind === "tasks#taskList";
}

/** Returns null when the JSON isn't Google Tasks or holds no task. */
export function parseGoogleTasks(input: unknown): ImportPlan | null {
  if (!isObj(input)) return null;
  const rawLists = input.kind === "tasks#taskLists" ? input.items : input.kind === "tasks#taskList" ? [input] : null;
  if (!Array.isArray(rawLists)) return null;
  const lists: PlanList[] = [];
  const tasks: PlanTask[] = [];
  const skipped: Skipped[] = [];
  rawLists.forEach((l, li) => {
    if (!isObj(l) || !Array.isArray(l.items)) return;
    const list = `l${li + 1}`;
    lists.push({ id: list, name: clean(str(l.title)) || "Google Tasks", folder: null });
    l.items.forEach((t, i) => {
      const title = isObj(t) ? clean(str(t.title)) : "";
      if (!isObj(t) || !title) return void skipped.push({ line: null, reason: "task without a title" });
      const due = /^(\d{4}-\d\d-\d\d)/.exec(str(t.due))?.[1];
      const done = t.status === "completed";
      const completed = new Date(str(t.completed));
      tasks.push({
        id: str(t.id) || `${list}-${i}`,
        parent: str(t.parent) || null,
        list,
        section: null,
        title,
        description: str(t.notes).trim(),
        priority: 0,
        status: done ? "done" : "open",
        schedule: due ? { kind: "day", date: due } : { kind: "none" },
        deadline: null,
        durationMin: null,
        rule: null,
        tags: [],
        checklist: [],
        completedAt: done && !Number.isNaN(completed.getTime()) ? completed.toISOString() : null,
      });
    });
  });
  if (!tasks.length) return null;
  return finalize({ lists, sections: [], tasks, skipped, repeatsNotKept: 0 });
}
