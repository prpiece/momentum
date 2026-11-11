import { useMemo } from "react";
import { todayLocal } from "../../domain/dates";
import { derive, inSmartList, type Derived } from "../../domain/taskViews";
import { SMART_LISTS, type SmartListId } from "../../domain/types";
import { useData } from "../../stores/data";

export function useDerived(): Derived {
  const tasks = useData((s) => s.tasks);
  const lists = useData((s) => s.lists);
  return derive(tasks, lists);
}

/** Open-task counts for the sidebar badges. */
export function useCounts(): { smart: Record<SmartListId, number>; lists: Record<string, number> } {
  const d = useDerived();
  const today = todayLocal();
  return useMemo(() => {
    const smart: Record<SmartListId, number> = {
      inbox: 0,
      today: 0,
      upcoming: 0,
    };
    const lists: Record<string, number> = {};
    for (const vm of d.active) {
      if (vm.task.status !== "open") continue;
      lists[vm.task.listId] = (lists[vm.task.listId] ?? 0) + 1;
      for (const id of SMART_LISTS) if (inSmartList(id, vm, today)) smart[id]++;
    }
    return { smart, lists };
  }, [d, today]);
}
