import { addDaysLocal, scheduleDate, wallKey } from "./dates";
import { effective } from "./recurrence";
import {
  INBOX_ID,
  PRIORITY_LABEL,
  type GroupBy,
  type LocalDate,
  type Schedule,
  type SmartListId,
  type SortBy,
  type Tag,
  type Task,
  type TaskList,
} from "./types";

/** A task as list views see it: recurring tasks show their current occurrence. */
export type TaskVM = { task: Task; schedule: Schedule; date: LocalDate | null; key: string | null };

const vmCache = new WeakMap<Task, TaskVM | null>();

/** Null for a recurring series with no occurrences left. Cached per (immutable) task object. */
export function toVM(task: Task): TaskVM | null {
  const hit = vmCache.get(task);
  if (hit !== undefined) return hit;
  const eff = effective(task);
  const vm = eff && { task, schedule: eff.schedule, date: scheduleDate(eff.schedule), key: eff.key };
  vmCache.set(task, vm);
  return vm;
}

export function inSmartList(id: SmartListId, vm: TaskVM, today: LocalDate): boolean {
  const t = vm.task;
  const open = t.status === "open";
  switch (id) {
    case "inbox":
      return open && t.listId === INBOX_ID;
    case "today":
      // Overdue items stay visible in Today until handled.
      return open && vm.date !== null && vm.date <= today;
    case "tomorrow":
      return open && vm.date === addDaysLocal(today, 1);
    case "next7":
      return open && vm.date !== null && vm.date >= today && vm.date <= addDaysLocal(today, 6);
    case "overdue":
      return open && vm.date !== null && vm.date < today;
    case "unscheduled":
      return open && vm.schedule.kind === "none";
    case "high":
      return open && t.priority === 3;
    case "completed":
      return t.status === "done";
    case "wontdo":
      return t.status === "wont_do";
  }
}

/** Sortable key: all-day items sort before timed items on the same day; undated last. */
function dateKey(vm: TaskVM): string {
  if (vm.schedule.kind === "timed") return wallKey(new Date(vm.schedule.start));
  return vm.date ?? "￿";
}

export function sortVMs(vms: readonly TaskVM[], sortBy: SortBy): TaskVM[] {
  const cmp: Record<SortBy, (a: TaskVM, b: TaskVM) => number> = {
    manual: (a, b) => a.task.sortOrder - b.task.sortOrder,
    date: (a, b) => dateKey(a).localeCompare(dateKey(b)) || b.task.priority - a.task.priority,
    priority: (a, b) => b.task.priority - a.task.priority || dateKey(a).localeCompare(dateKey(b)),
    created: (a, b) => b.task.createdAt.localeCompare(a.task.createdAt),
    title: (a, b) => a.task.title.localeCompare(b.task.title, undefined, { sensitivity: "base" }),
  };
  const by = cmp[sortBy];
  // Done tasks sink, pinned tasks float; ties fall back to manual order for stability.
  return [...vms].sort(
    (a, b) =>
      Number(a.task.status !== "open") - Number(b.task.status !== "open") ||
      Number(b.task.pinned) - Number(a.task.pinned) ||
      by(a, b) ||
      a.task.sortOrder - b.task.sortOrder,
  );
}

export type Group = { key: string; label: string; items: TaskVM[] };

type GroupCtx = { today: LocalDate; lists: ReadonlyMap<string, TaskList>; tags: ReadonlyMap<string, Tag> };

function dateBucket(vm: TaskVM, today: LocalDate): [string, string] {
  if (!vm.date) return ["5", "No date"];
  if (vm.date < today) return ["0", "Overdue"];
  if (vm.date === today) return ["1", "Today"];
  if (vm.date === addDaysLocal(today, 1)) return ["2", "Tomorrow"];
  if (vm.date <= addDaysLocal(today, 6)) return ["3", "Next 7 days"];
  return ["4", "Later"];
}

/** Groups keep the incoming (already sorted) item order. Tag grouping may place a task in several groups. */
export function groupVMs(vms: readonly TaskVM[], groupBy: GroupBy, ctx: GroupCtx): Group[] {
  if (groupBy === "none") return [{ key: "all", label: "", items: [...vms] }];
  const groups = new Map<string, Group>();
  const put = (key: string, label: string, vm: TaskVM) => {
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { key, label, items: [] }));
    g.items.push(vm);
  };
  for (const vm of vms) {
    const t = vm.task;
    if (groupBy === "date") {
      const [k, label] = dateBucket(vm, ctx.today);
      put(k, label, vm);
    } else if (groupBy === "priority") {
      put(String(3 - t.priority), PRIORITY_LABEL[t.priority], vm);
    } else if (groupBy === "list") {
      const list = ctx.lists.get(t.listId);
      put(`${String(list?.sortOrder ?? 0).padStart(12, "0")}${t.listId}`, list?.name ?? "Unknown list", vm);
    } else {
      const names = t.tags.map((id) => ctx.tags.get(id)?.name).filter((n): n is string => !!n);
      if (!names.length) put("￿", "No tag", vm);
      for (const n of names) put(n.toLowerCase(), `#${n}`, vm);
    }
  }
  return [...groups.values()].sort((a, b) => a.key.localeCompare(b.key));
}

export type TreeRow = { vm: TaskVM; depth: number; childCount: number; doneChildCount: number };

/** Depth-first rows for a task tree; collapsed parents hide their descendants. */
export function flattenTree(
  roots: readonly TaskVM[],
  childrenOf: (id: string) => TaskVM[],
  collapsed: ReadonlySet<string>,
): TreeRow[] {
  const rows: TreeRow[] = [];
  const walk = (vm: TaskVM, depth: number) => {
    const kids = childrenOf(vm.task.id);
    rows.push({
      vm,
      depth,
      childCount: kids.length,
      doneChildCount: kids.filter((k) => k.task.status !== "open").length,
    });
    if (!collapsed.has(vm.task.id)) for (const k of kids) walk(k, depth + 1);
  };
  for (const r of roots) walk(r, 0);
  return rows;
}

/**
 * Lower is better; null = no match. Every query word must hit: exact 0, prefix 1,
 * word-start 2, substring 3.
 */
export function matchScore(text: string, query: string): number | null {
  const hay = text.toLowerCase();
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return null;
  let score = 0;
  for (const w of words) {
    if (hay === w) continue;
    if (hay.startsWith(w)) score += 1;
    else if (new RegExp(`(^|[\\s\\-_/#(])${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(hay)) score += 2;
    else if (hay.includes(w)) score += 3;
    else return null;
  }
  return score;
}
