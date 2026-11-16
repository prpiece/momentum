import { format } from "date-fns";
import { addDaysLocal, fromLocalDate, scheduleDate, taskMinutes, todayLocal, wallKey } from "./dates";
import { fold } from "./fuzzy";
import { effective } from "./recurrence";
import { blockerOpen, followUpDue, isWaiting } from "./waiting";
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

/**
 * A task as list views see it: recurring tasks show their current occurrence. `blocked`: it waits on a
 * task that is still open (set by `derive`, which sees every task; a lone `toVM` assumes it is).
 */
export type TaskVM = { task: Task; schedule: Schedule; date: LocalDate | null; key: string | null; blocked: boolean };

const vmCache = new WeakMap<Task, TaskVM | null>();

/** Null for a recurring series with no occurrences left. Cached per (immutable) task object. */
export function toVM(task: Task): TaskVM | null {
  const hit = vmCache.get(task);
  if (hit !== undefined) return hit;
  const eff = effective(task);
  const vm = eff && { task, schedule: eff.schedule, date: scheduleDate(eff.schedule), key: eff.key, blocked: task.waiting?.kind === "task" };
  vmCache.set(task, vm);
  return vm;
}

/** Still waiting for a person or an open task (D267): out of Today and Upcoming, in Waiting. */
export const waitingNow = (vm: TaskVM, today: LocalDate) => isWaiting(vm.task.waiting, vm.blocked, today);

/** The day a view files a task under. A timed block follows End-of-day like "today" does (HAB-13); the rest use their date. */
const dayOf = (vm: TaskVM): LocalDate | null => (vm.schedule.kind === "timed" ? todayLocal(new Date(vm.schedule.start)) : vm.date);

export function inSmartList(id: SmartListId, vm: TaskVM, today: LocalDate): boolean {
  const t = vm.task;
  if (t.status !== "open") return false;
  const waiting = waitingNow(vm, today);
  switch (id) {
    case "inbox":
      return t.listId === INBOX_ID;
    case "today":
      // Overdue items stay visible in Today until handled; so do deadlines that have come and a person's follow-up.
      if (waiting || vm.schedule.kind === "someday") return false;
      return (dayOf(vm) !== null && dayOf(vm)! <= today) || (t.deadline !== null && t.deadline <= today) || followUpDue(t.waiting, today);
    case "upcoming":
      // Not also in Today through a deadline or a follow-up that has come (HAB-11).
      return !waiting && dayOf(vm) !== null && dayOf(vm)! > today && !(t.deadline !== null && t.deadline <= today) && !followUpDue(t.waiting, today);
    case "someday":
      return vm.schedule.kind === "someday";
    case "waiting":
      return waiting;
  }
}

/**
 * What a smart view holds with Show completed on (D165): its open tasks, plus the finished ones
 * that belong there. Today keeps what was finished today; Upcoming, finished tasks dated later.
 */
export function inSmartScope(id: SmartListId, vm: TaskVM, today: LocalDate): boolean {
  const t = vm.task;
  if (t.status === "open") return inSmartList(id, vm, today);
  switch (id) {
    case "inbox":
      return t.listId === INBOX_ID;
    case "today":
      return t.completedAt !== null && todayLocal(new Date(t.completedAt)) === today;
    case "upcoming":
      return vm.date !== null && vm.date > today;
    case "someday":
      return vm.schedule.kind === "someday";
    case "waiting":
      return t.waiting !== null;
  }
}

/** The planned minutes of a set of tasks (Today's header, D267): durations of the open ones. */
export const plannedMinutes = (vms: readonly TaskVM[]) =>
  vms.reduce((sum, vm) => sum + (vm.task.status === "open" ? (taskMinutes({ schedule: vm.schedule, durationMin: vm.task.durationMin }) ?? 0) : 0), 0);

/** The deadline has passed (red chip). */
export const deadlinePassed = (t: Pick<Task, "deadline" | "status">, today: LocalDate) => t.status === "open" && t.deadline !== null && t.deadline < today;

/** A timed block is overdue once it has ended before today, so one running past midnight isn't (HAB-12). */
export const isOverdue = (vm: TaskVM, today: LocalDate) => {
  if (vm.task.status !== "open" || vm.date === null) return false;
  const s = vm.schedule;
  return (s.kind === "timed" ? todayLocal(new Date(Math.max(Date.parse(s.start), Date.parse(s.end) - 1))) : vm.date) < today;
};

/** Sortable key: all-day items sort before timed items on the same day; undated last. */
function dateKey(vm: TaskVM): string {
  if (vm.schedule.kind === "timed") return wallKey(new Date(vm.schedule.start));
  return vm.date ?? "￿";
}

/** `saved`: a view's own Manual order (task ids); tasks it doesn't list follow, by their usual order (D331). */
export function sortVMs(vms: readonly TaskVM[], sortBy: SortBy, saved?: readonly string[]): TaskVM[] {
  const rank = new Map(saved?.map((id, i) => [id, i]));
  const cmp: Record<SortBy, (a: TaskVM, b: TaskVM) => number> = {
    manual: (a, b) => (rank.get(a.task.id) ?? Infinity) - (rank.get(b.task.id) ?? Infinity) || a.task.sortOrder - b.task.sortOrder,
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

/** Each of the next seven days is its own group, so a task can be dragged onto a day (D253). */
function dateBucket(vm: TaskVM, today: LocalDate): [string, string] {
  if (!vm.date) return ["5", "No date"];
  if (vm.date < today) return ["0", "Overdue"];
  if (vm.date === today) return ["1", "Today"];
  if (vm.date === addDaysLocal(today, 1)) return [`2:${vm.date}`, "Tomorrow"];
  if (vm.date <= addDaysLocal(today, 6)) return [`2:${vm.date}`, format(fromLocalDate(vm.date), "EEEE d MMM")];
  return ["4", "Later"];
}

/** Groups keep the incoming (already sorted) item order. Tag grouping may place a task in several groups. */
export function groupVMs(vms: readonly TaskVM[], groupBy: GroupBy, ctx: GroupCtx): Group[] {
  if (groupBy === "none") return [{ key: "all", label: "", items: [...vms] }];
  const groups = new Map<string, Group>();
  const listOrder = new Map<string, number>(); // numeric: a padded string sorts negatives wrongly (HAB-20)
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
      const key = `${t.listId}`;
      listOrder.set(key, list?.sortOrder ?? 0);
      put(key, list?.name ?? "Unknown list", vm);
    } else {
      const names = t.tags.map((id) => ctx.tags.get(id)?.name).filter((n): n is string => !!n);
      if (!names.length) put("￿", "No tag", vm);
      for (const n of names) put(n.toLowerCase(), `#${n}`, vm);
    }
  }
  return [...groups.values()].sort((a, b) => (listOrder.get(a.key) ?? 0) - (listOrder.get(b.key) ?? 0) || a.key.localeCompare(b.key));
}

/**
 * A row of a task tree. `shownKids` is how many children the view nests under it (drives the
 * expand toggle); `childCount`/`doneChildCount` count all its subtasks, in the view or not.
 */
export type TreeRow = { vm: TaskVM; depth: number; shownKids: number; childCount: number; doneChildCount: number };

/** Depth-first rows for a task tree; collapsed parents hide their descendants. Counts come from `allChildrenOf`. */
export function flattenTree(
  roots: readonly TaskVM[],
  childrenOf: (id: string) => TaskVM[],
  collapsed: ReadonlySet<string>,
  allChildrenOf: (id: string) => TaskVM[] = childrenOf,
): TreeRow[] {
  const rows: TreeRow[] = [];
  const walk = (vm: TaskVM, depth: number) => {
    const kids = childrenOf(vm.task.id);
    const all = allChildrenOf(vm.task.id);
    rows.push({
      vm,
      depth,
      shownKids: kids.length,
      childCount: all.length,
      doneChildCount: all.filter((k) => k.task.status !== "open").length,
    });
    if (!collapsed.has(vm.task.id)) for (const k of kids) walk(k, depth + 1);
  };
  for (const r of roots) walk(r, 0);
  return rows;
}

/**
 * The tasks a view shows at the top level (D196): those whose parent isn't in the view too.
 * The rest appear inside their parent: nested in lists, counted on cards.
 */
export function topLevelIn(vms: readonly TaskVM[]): TaskVM[] {
  const ids = new Set(vms.map((v) => v.task.id));
  return vms.filter((v) => !v.task.parentId || !ids.has(v.task.parentId));
}

/**
 * Lower is better; null = no match. Every query word must hit: exact 0, prefix 1,
 * word-start 2, substring 3.
 */
export function matchScore(text: string, query: string): number | null {
  const hay = fold(text);
  const words = fold(query).split(/\s+/).filter(Boolean);
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

export type Derived = {
  /** Live (not deleted, not exhausted) tasks as view models. */
  vms: TaskVM[];
  byId: Map<string, TaskVM>;
  childrenOf: (id: string) => TaskVM[];
  /** Live tasks in non-archived lists: what smart lists, calendar and search see. */
  active: TaskVM[];
  /** Active top-level tasks: what the calendar's Arrange panel and the focus picker offer (D196). */
  roots: TaskVM[];
};

let memo: { tasks: Record<string, Task>; lists: Record<string, TaskList>; out: Derived } | null = null;

/** Derived once per store change, shared by every view. */
export function derive(tasks: Record<string, Task>, lists: Record<string, TaskList>): Derived {
  if (memo && memo.tasks === tasks && memo.lists === lists) return memo.out;
  const vms: TaskVM[] = [];
  const kids = new Map<string, TaskVM[]>();
  for (const t of Object.values(tasks)) {
    if (t.deletedAt) continue;
    let vm = toVM(t);
    if (!vm) continue;
    // A wait on a task resolves once that task is finished or gone, from any device: derived, not stored.
    if (t.waiting?.kind === "task" && blockerOpen(t.waiting, tasks) !== vm.blocked) vm = { ...vm, blocked: !vm.blocked };
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
    roots: [],
  };
  out.roots = out.active.filter((v) => !v.task.parentId);
  memo = { tasks, lists, out };
  return out;
}
