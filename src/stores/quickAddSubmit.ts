import { relativeDayLabel, toLocalDate, todayLocal } from "../domain/dates";
import { nameKey } from "../domain/fuzzy";
import { defaultReminders, parseQuickAdd, withDefaults, type InputOrigin } from "../domain/quickAdd";
import type { Task } from "../domain/types";
import { addTask, ensureTags, mayEdit, useData, type NewTask } from "./data";
import { trackDone, useSettings } from "./settings";
import { toast } from "./toast";

/** Opens a task's details from the "Added to …" toast. Each app registers its own (desktop: stores/ui). */
let openTask: (id: string) => void = () => undefined;
export const setTaskOpener = (fn: typeof openTask) => void (openTask = fn);

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
  // Settings → New tasks (D338): a default list, priority and reminder, under any token or view context.
  const nd = useSettings.getState().settings.taskDefaults;
  const defaultList = nd.listId && lists[nd.listId] && !lists[nd.listId].archived ? nd.listId : undefined;
  const listId = defaults.parentId ? defaults.listId : (p.listName && listByName(p.listName)?.id) || defaults.listId || defaultList;
  // The final list, whichever way it was chosen (`~List`, the view, a default): the store drops writes to a view-only one.
  if (listId && !mayEdit(listId)) return null;
  const resolved = withDefaults(p, { schedule: defaults.schedule, priority: defaults.priority ?? (nd.priority || undefined) });
  const reminders = defaults.reminders?.length ? [] : defaultReminders(resolved.schedule ?? { kind: "none" }, nd.reminderMin);
  const t = addTask({
    ...defaults,
    title: p.title,
    ...(listId ? { listId } : {}),
    ...resolved,
    ...(reminders.length ? { reminders } : {}),
    // The defaults' tags are ids already; the parsed ones are names.
    tags: [...new Set([...(defaults.tags ?? []), ...ensureTags(resolved.tags)])],
  }, position);
  trackDone("task:created-quickadd");
  if (p.chips.length) trackDone("task:token-used");
  if (p.listName && !defaults.parentId && !listByName(p.listName)) onMissingList(p.listName, lists[t.listId]?.name ?? "Inbox");
  else if (announce(t)) {
    const s = t.schedule;
    const today = todayLocal();
    const when = s.kind === "none" ? "" : s.kind === "someday" ? " for someday" : ` for ${relativeDayLabel(s.kind === "day" ? s.date : toLocalDate(new Date(s.start)), today)}`;
    toast(`Added to ${lists[t.listId]?.name ?? "Inbox"}${when}`, { label: "Open", run: () => openTask(t.id) });
  }
  return t;
}
