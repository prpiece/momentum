import { relativeDayLabel, todayLocal } from "../../domain/dates";
import { parseQuickAdd, withDefaults, type InputOrigin } from "../../domain/quickAdd";
import type { Task } from "../../domain/types";
import { addTask, ensureTags, useData, type NewTask } from "../../stores/data";
import { trackDone } from "../../stores/settings";
import { openTask, toast } from "../../stores/ui";

const nameKey = (s: string) => s.replace(/\s+/g, "").toLowerCase();
export const listByName = (name: string) => Object.values(useData.getState().lists).find((l) => nameKey(l.name) === nameKey(name));
export const listNames = () => Object.values(useData.getState().lists).map((l) => l.name);

/**
 * The one way quick-add text becomes a task (in-app bar and the global Ctrl+Shift+A window).
 * `announce` toasts where the task went when it won't be visible where the user is looking.
 */
export function createFromText(
  text: string,
  defaults: Partial<NewTask>,
  parsing: boolean,
  announce: (t: Task) => boolean,
  origin: InputOrigin = "typed",
  /** A `~List` that doesn't exist; bulk import collects these instead of one toast each (D92). */
  onMissingList: (name: string, fellBackTo: string) => void = (name, to) => toast(`No list named “${name}”; added to ${to}`),
  position: "top" | "bottom" = "top",
): Task | null {
  if (!text.trim()) return null;
  const p = parseQuickAdd(text, new Date(), parsing, listNames(), origin);
  const lists = useData.getState().lists;
  // A subtask lives in its parent's list, so a `~List` token is ignored there.
  const listId = defaults.parentId ? defaults.listId : (p.listName && listByName(p.listName)?.id) || defaults.listId;
  const resolved = withDefaults(p, { schedule: defaults.schedule, priority: defaults.priority });
  const t = addTask({
    ...defaults,
    title: p.title,
    ...(listId ? { listId } : {}),
    ...resolved,
    // The defaults' tags are ids already; the parsed ones are names.
    tags: [...new Set([...(defaults.tags ?? []), ...ensureTags(resolved.tags)])],
  }, position);
  trackDone("task:created-quickadd");
  if (p.chips.length) trackDone("task:token-used");
  if (p.listName && !defaults.parentId && !listByName(p.listName)) onMissingList(p.listName, lists[t.listId]?.name ?? "Inbox");
  else if (announce(t)) {
    const s = t.schedule;
    const today = todayLocal();
    const when = s.kind === "none" ? "" : ` for ${relativeDayLabel(s.kind === "day" ? s.date : todayLocal(new Date(s.start)), today)}`;
    toast(`Added to ${lists[t.listId]?.name ?? "Inbox"}${when}`, { label: "Open", run: () => openTask(t.id) });
  }
  return t;
}
