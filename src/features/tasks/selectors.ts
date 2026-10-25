import { useMemo } from "react";
import { todayLocal } from "../../domain/dates";
import { inSmartList, toVM, type TaskVM } from "../../domain/taskViews";
import { SMART_LISTS, type SmartListId, type Task, type TaskList } from "../../domain/types";
import { useData } from "../../stores/data";

export type Derived = {
  /** Live (not deleted, not exhausted) tasks as view models. */
  vms: TaskVM[];
  byId: Map<string, TaskVM>;
  childrenOf: (id: string) => TaskVM[];
  /** Live tasks in non-archived lists: what smart lists, calendar and search see. */
  active: TaskVM[];
};

let memo: { tasks: Record<string, Task>; lists: Record<string, TaskList>; out: Derived } | null = null;

/** Derived once per store change, shared by every view. */
export function derive(tasks: Record<string, Task>, lists: Record<string, TaskList>): Derived {
  if (memo && memo.tasks === tasks && memo.lists === lists) return memo.out;
  const vms: TaskVM[] = [];
  const kids = new Map<string, TaskVM[]>();
  for (const t of Object.values(tasks)) {
    if (t.deletedAt) continue;
    const vm = toVM(t);
    if (!vm) continue;
    vms.push(vm);
    if (t.parentId) {
      const arr = kids.get(t.parentId);
      if (arr) arr.push(vm);
      else kids.set(t.parentId, [vm]);
    }
  }
  for (const arr of kids.values()) arr.sort((a, b) => a.task.sortOrder - b.task.sortOrder);
  const out: Derived = {
    vms,
    byId: new Map(vms.map((v) => [v.task.id, v])),
    childrenOf: (id) => kids.get(id) ?? [],
    active: vms.filter((v) => !lists[v.task.listId]?.archived),
  };
  memo = { tasks, lists, out };
  return out;
}

export function useDerived(): Derived {
  const tasks = useData((s) => s.tasks);
  const lists = useData((s) => s.lists);
  return derive(tasks, lists);
}

/** Open-task counts for the sidebar badges. */
export function useCounts(): { smart: Record<SmartListId, number>; lists: Record<string, number>; tags: Record<string, number> } {
  const d = useDerived();
  const today = todayLocal();
  return useMemo(() => {
    const smart: Record<SmartListId, number> = {
      inbox: 0,
      today: 0,
      tomorrow: 0,
      next7: 0,
      overdue: 0,
      unscheduled: 0,
      high: 0,
      completed: 0,
      wontdo: 0,
    };
    const lists: Record<string, number> = {};
    const tags: Record<string, number> = {};
    for (const vm of d.active) {
      if (vm.task.status !== "open") continue;
      lists[vm.task.listId] = (lists[vm.task.listId] ?? 0) + 1;
      for (const tag of vm.task.tags) tags[tag] = (tags[tag] ?? 0) + 1;
      for (const id of SMART_LISTS) if (id !== "completed" && id !== "wontdo" && inSmartList(id, vm, today)) smart[id]++;
    }
    return { smart, lists, tags };
  }, [d, today]);
}
