import { toLocalDate } from "./dates";
import { parseQuickAdd, type Chip } from "./quickAdd";
import { matchScore, type TaskVM } from "./taskViews";
import type { LocalDate, Priority, Tag, TaskList, TaskStatus } from "./types";

export type DateFilter = { kind: "on"; date: LocalDate } | { kind: "overdue" } | { kind: "none" };

/** A filter query in quick-add grammar (`#tag !high ~list tomorrow`) plus a few filter-only keywords. */
export type TaskFilter = {
  text: string;
  tags: string[];
  priority: Priority | null;
  listName: string | null;
  date: DateFilter | null;
  /** null = any status. */
  status: TaskStatus | null;
  chips: Chip[];
};

const KEYWORDS: Record<string, (f: TaskFilter) => void> = {
  overdue: (f) => void (f.date = { kind: "overdue" }),
  nodate: (f) => void (f.date = { kind: "none" }),
  done: (f) => void (f.status = "done"),
  wontdo: (f) => void (f.status = "wont_do"),
};

/** List names match quick add's `~Name`: whitespace dropped, case ignored. */
export const nameKey = (name: string) => name.replace(/\s+/g, "").toLowerCase();

export function parseFilter(query: string, now: Date): TaskFilter {
  const f: TaskFilter = { text: "", tags: [], priority: null, listName: null, date: null, status: null, chips: [] };
  // Keywords are blanked (not removed) so quick-add chip offsets still index into `query`.
  let rest = query;
  for (const m of query.matchAll(/\S+/g)) {
    const apply = KEYWORDS[m[0].toLowerCase()];
    if (!apply) continue;
    apply(f);
    const start = m.index ?? 0;
    f.chips.push({ kind: "date", text: m[0], start, end: start + m[0].length });
    rest = rest.slice(0, start) + " ".repeat(m[0].length) + rest.slice(start + m[0].length);
  }
  if (!rest.trim()) return f;

  const p = parseQuickAdd(rest, now);
  // Repeat phrases mean nothing in a filter; drop their chips.
  const chips = p.chips.filter((c) => c.kind !== "repeat");
  f.chips.push(...chips);
  f.chips.sort((a, b) => a.start - b.start);
  f.tags = p.tags;
  f.priority = p.priority;
  f.listName = p.listName;
  if (chips.some((c) => c.kind === "date") && p.schedule.kind !== "none")
    f.date = { kind: "on", date: p.schedule.kind === "day" ? p.schedule.date : toLocalDate(new Date(p.schedule.start)) };
  // parseQuickAdd falls back to the whole input when every word was a token.
  f.text = p.chips.length && p.title === rest.trim() ? "" : p.title;
  return f;
}

export const isEmptyFilter = (f: TaskFilter) =>
  !f.text && !f.tags.length && f.priority === null && f.listName === null && f.date === null && f.status === null;

type Ctx = { today: LocalDate; lists: Record<string, TaskList>; tags: Record<string, Tag> };

export function matchesFilter(vm: TaskVM, f: TaskFilter, ctx: Ctx): boolean {
  const t = vm.task;
  if (f.status !== null && t.status !== f.status) return false;
  if (f.priority !== null && t.priority !== f.priority) return false;
  if (f.listName !== null) {
    const list = ctx.lists[t.listId];
    if (!list || nameKey(list.name) !== nameKey(f.listName)) return false;
  }
  if (f.tags.length) {
    const names = new Set(t.tags.map((id) => ctx.tags[id]?.name.toLowerCase()));
    if (!f.tags.every((n) => names.has(n.toLowerCase()))) return false;
  }
  if (f.date) {
    if (f.date.kind === "none" && vm.schedule.kind !== "none") return false;
    if (f.date.kind === "overdue" && !(t.status === "open" && vm.date !== null && vm.date < ctx.today)) return false;
    if (f.date.kind === "on" && vm.date !== f.date.date) return false;
  }
  return !f.text || matchScore(t.title, f.text) !== null;
}
