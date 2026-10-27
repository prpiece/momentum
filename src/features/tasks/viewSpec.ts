import { Hash, List, ListFilter, type LucideIcon } from "lucide-react";
import { addDaysLocal } from "../../domain/dates";
import { matchesFilter, nameKey, parseFilter } from "../../domain/filter";
import { inSmartList, type TaskVM } from "../../domain/taskViews";
import { SMART_LISTS, type LocalDate, type SavedFilter, type SmartListId, type Tag, type TaskList, type ViewId } from "../../domain/types";
import type { NewTask } from "../../stores/data";
import { SMART_LIST_NAV } from "../shell/nav";

export type TaskViewSpec = {
  id: ViewId;
  title: string;
  icon: LucideIcon;
  list: TaskList | null;
  tag: Tag | null;
  /** Custom lists render a subtask tree; smart lists and tags are flat. */
  tree: boolean;
  /** Finished tasks show in a collapsible "Completed" group instead of inline. */
  splitCompleted: boolean;
  filter: (vm: TaskVM, today: LocalDate) => boolean;
  /** What a task created from this view's quick add starts with. */
  defaults: (today: LocalDate) => Partial<NewTask>;
  canAdd: boolean;
};

const isSmart = (v: string): v is SmartListId => (SMART_LISTS as readonly string[]).includes(v);

const SMART_DEFAULTS: Partial<Record<SmartListId, (today: LocalDate) => Partial<NewTask>>> = {
  today: (today) => ({ schedule: { kind: "day", date: today } }),
  upcoming: (today) => ({ schedule: { kind: "day", date: addDaysLocal(today, 1) } }),
};

export function taskViewSpec(
  view: ViewId,
  lists: Record<string, TaskList>,
  tags: Record<string, Tag>,
  savedFilters: readonly SavedFilter[],
): TaskViewSpec | null {
  if (isSmart(view)) {
    const nav = SMART_LIST_NAV.find((n) => n.id === view);
    if (!nav) return null;
    const inbox = view === "inbox";
    return {
      id: view,
      title: nav.label,
      icon: nav.icon,
      list: inbox ? (lists.inbox ?? null) : null,
      tag: null,
      tree: inbox,
      splitCompleted: inbox,
      filter: inbox ? (vm) => vm.task.listId === "inbox" : (vm, today) => inSmartList(view, vm, today),
      defaults: SMART_DEFAULTS[view] ?? (() => ({})),
      canAdd: view !== "logbook",
    };
  }
  if (view.startsWith("list:")) {
    const list = lists[view.slice(5)];
    if (!list) return null;
    return {
      id: view,
      title: list.name,
      icon: List,
      list,
      tag: null,
      tree: true,
      splitCompleted: true,
      filter: (vm) => vm.task.listId === list.id,
      defaults: () => ({ listId: list.id }),
      canAdd: true,
    };
  }
  if (view.startsWith("tag:")) {
    const tag = tags[view.slice(4)];
    if (!tag) return null;
    return {
      id: view,
      title: `#${tag.name}`,
      icon: Hash,
      list: null,
      tag,
      tree: false,
      splitCompleted: true,
      filter: (vm) => vm.task.tags.includes(tag.id),
      defaults: () => ({ tags: [tag.id] }),
      canAdd: true,
    };
  }
  if (view.startsWith("filter:")) {
    const saved = savedFilters.find((f) => `filter:${f.id}` === view);
    if (!saved) return null;
    // ponytail: dates in the query resolve when the spec is built (each App render), not per day boundary.
    const f = parseFilter(saved.query, new Date());
    const listId = f.listName === null ? undefined : Object.values(lists).find((l) => nameKey(l.name) === nameKey(f.listName ?? ""))?.id;
    const tagIds = Object.values(tags)
      .filter((t) => f.tags.some((n) => n.toLowerCase() === t.name.toLowerCase()))
      .map((t) => t.id);
    return {
      id: view,
      title: saved.name,
      icon: ListFilter,
      list: null,
      tag: null,
      tree: false,
      splitCompleted: f.status === null,
      filter: (vm, today) => matchesFilter(vm, f, { today, lists, tags }),
      defaults: () => ({
        ...(f.priority !== null ? { priority: f.priority } : {}),
        ...(listId ? { listId } : {}),
        ...(tagIds.length ? { tags: tagIds } : {}),
        ...(f.date?.kind === "on" ? { schedule: { kind: "day" as const, date: f.date.date } } : {}),
      }),
      canAdd: f.status === null || f.status === "open",
    };
  }
  return null;
}
