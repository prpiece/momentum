import type { ImportPlan } from "../domain/importPlan";
import { addFolder, addList, addSection, addTask, ensureTags, removeFolder, removeList, removeSection, removeTag, useData } from "./data";
import { pushUndo } from "./undo";

/**
 * Create everything in an import plan (Todoist / TickTick) through the normal store actions, as one undoable step:
 * Undo removes the lists (and with them their sections and tasks), the folders and the tags the import created.
 * Lists are always new, even when a list of the same name exists.
 */
export function applyImportPlan(plan: ImportPlan): void {
  const before = useData.getState();
  const oldFolders = new Set(Object.keys(before.folders));
  const oldTags = new Set(Object.keys(before.tags));

  const folders = new Map(plan.folders.map((name) => [name, addFolder(name)?.id ?? null]));
  const lists = new Map(plan.lists.map((l) => [l.id, addList(l.name, l.folder ? (folders.get(l.folder) ?? null) : null).id]));
  const sections = new Map(plan.sections.map((s) => [s.id, addSection(lists.get(s.list) ?? "", s.name).id]));
  const tagIds = new Map(plan.tasks.flatMap((t) => t.tags).map((n) => [n.toLowerCase(), ensureTags([n])[0]]));

  const tasks = new Map<string, string>();
  plan.tasks.forEach((t, i) => {
    const listId = lists.get(t.list);
    if (!listId) return;
    const created = addTask({
      title: t.title,
      description: t.description,
      listId,
      parentId: t.parent ? (tasks.get(t.parent) ?? null) : null,
      sectionId: t.section ? (sections.get(t.section) ?? null) : null,
      status: t.status,
      priority: t.priority,
      schedule: t.schedule,
      deadline: t.deadline,
      durationMin: t.durationMin,
      recurrence: t.rule ? { rule: t.rule, exdates: [] } : null,
      tags: t.tags.flatMap((n) => tagIds.get(n.toLowerCase()) ?? []),
      checklist: t.checklist.map((c) => ({ id: crypto.randomUUID(), title: c.title, done: c.done })),
      completedAt: t.status === "open" ? null : (t.completedAt ?? new Date().toISOString()),
      // ponytail: one commit per task; a batch commit if imports of tens of thousands of tasks get slow.
      sortOrder: i,
    });
    tasks.set(t.id, created.id);
  });

  const made = {
    lists: [...lists.values()],
    sections: [...sections.values()],
    folders: [...folders.values()].flatMap((id) => (id && !oldFolders.has(id) ? [id] : [])),
    tags: Object.keys(useData.getState().tags).filter((id) => !oldTags.has(id)),
  };
  const n = tasks.size;
  pushUndo(`Imported ${n} task${n === 1 ? "" : "s"} in ${made.lists.length} list${made.lists.length === 1 ? "" : "s"}`, () => {
    made.sections.forEach(removeSection);
    made.lists.forEach(removeList);
    made.tags.forEach(removeTag);
    made.folders.forEach(removeFolder);
  });
}
