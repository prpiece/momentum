import { relativeDayLabel, todayLocal } from "../../domain/dates";
import { parseQuickAdd } from "../../domain/quickAdd";
import type { Task } from "../../domain/types";
import { addTask, ensureTags, useData, type NewTask } from "../../stores/data";
import { openTask, toast } from "../../stores/ui";

export const listByName = (name: string) =>
  Object.values(useData.getState().lists).find((l) => l.name.replace(/\s+/g, "").toLowerCase() === name.toLowerCase());

/**
 * The one way quick-add text becomes a task (in-app bar and the global Ctrl+Shift+A window).
 * `announce` toasts where the task went when it won't be visible where the user is looking.
 */
export function createFromText(text: string, defaults: Partial<NewTask>, parsing: boolean, announce: (t: Task) => boolean): Task | null {
  if (!text.trim()) return null;
  const p = parseQuickAdd(text, new Date(), parsing);
  const lists = useData.getState().lists;
  const listId = (p.listName && listByName(p.listName)?.id) || defaults.listId;
  const t = addTask({
    ...defaults,
    title: p.title,
    ...(listId ? { listId } : {}),
    ...(p.schedule.kind !== "none" ? { schedule: p.schedule } : {}),
    ...(p.priority !== null ? { priority: p.priority } : {}),
    tags: [...new Set([...(defaults.tags ?? []), ...ensureTags(p.tags)])],
    recurrence: p.rule ? { rule: p.rule, exdates: [] } : null,
  });
  if (p.listName && !listByName(p.listName)) toast(`No list named “${p.listName}”; added to ${lists[t.listId]?.name ?? "Inbox"}`);
  else if (announce(t)) {
    const s = t.schedule;
    const today = todayLocal();
    const when = s.kind === "none" ? "" : ` for ${relativeDayLabel(s.kind === "day" ? s.date : todayLocal(new Date(s.start)), today)}`;
    toast(`Added to ${lists[t.listId]?.name ?? "Inbox"}${when}`, { label: "Open", run: () => openTask(t.id) });
  }
  return t;
}
