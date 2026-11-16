import { todayLocal } from "../domain/dates";
import { specFromTemplate, templateFromTask, withTemplate, type TaskSpec } from "../domain/templates";
import { addTask, ensureTags, uid, useData } from "./data";
import { useSettings } from "./settings";
import { toast } from "./toast";

/** Saves a task and its subtasks as a template (D337); the same name replaces the old one. Returns its name. */
export function saveAsTemplate(taskId: string): string | null {
  const { tasks, tags } = useData.getState();
  const tpl = templateFromTask(taskId, tasks, (id) => tags[id]?.name, uid(), tasks[taskId]?.title ?? "");
  if (!tpl) return null;
  const { settings, update } = useSettings.getState();
  update({ templates: withTemplate(settings.templates, tpl) });
  toast(`Saved template “${tpl.name}”`);
  return tpl.name;
}

/** Makes the template's tasks in `listId` (Inbox by default), the first dated one on `anchor` (today by default). Returns the root's id. */
export function createFromTemplate(templateId: string, listId = "inbox", anchor = todayLocal()): string | null {
  const tpl = useSettings.getState().settings.templates.find((t) => t.id === templateId);
  if (!tpl) return null;
  const make = (s: TaskSpec, parentId: string | null): string => {
    const { tagNames, children, ...fields } = s;
    const t = addTask({ ...fields, listId, parentId, tags: ensureTags(tagNames) }, parentId ? "bottom" : "top");
    children.forEach((c) => make(c, t.id));
    return t.id;
  };
  return make(specFromTemplate(tpl, anchor, uid), null);
}

export function deleteTemplate(templateId: string) {
  const { settings, update } = useSettings.getState();
  update({ templates: settings.templates.filter((t) => t.id !== templateId) });
}
