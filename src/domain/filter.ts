import { toLocalDate } from "./dates";
import { nameKey } from "./fuzzy";
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
  /** `-#tag`, `-~list`, `-!high` leave out what they name. */
  notTags: string[];
  notLists: string[];
  notPriorities: Priority[];
  date: DateFilter | null;
  /** Planning tokens (D267): `someday`, `by fri` (due on or before), `30m` (that long), `waiting @sam`. */
  someday: boolean;
  deadline: LocalDate | null;
  durationMin: number | null;
  waiting: string | null;
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

export { nameKey };

export function parseFilter(query: string, now: Date, listNames: readonly string[] = []): TaskFilter {
  const f: TaskFilter = { text: "", tags: [], priority: null, listName: null, notTags: [], notLists: [], notPriorities: [], date: null, someday: false, deadline: null, durationMin: null, waiting: null, status: null, chips: [] };
  // Keywords are blanked (not removed) so quick-add chip offsets still index into `query`.
  let rest = query;
  for (const m of query.matchAll(/\S+/g)) {
    const key = m[0].toLowerCase();
    const apply = Object.prototype.hasOwnProperty.call(KEYWORDS, key) ? KEYWORDS[key] : undefined;
    if (!apply) continue;
    apply(f);
    const start = m.index ?? 0;
    f.chips.push({ kind: "date", text: m[0], start, end: start + m[0].length });
    rest = rest.slice(0, start) + " ".repeat(m[0].length) + rest.slice(start + m[0].length);
  }
  // A minus before #tag, ~list or !priority excludes it: blank the minus, remember where it was.
  const negated = new Set<number>();
  for (const m of rest.matchAll(/(^|\s)-(?=[#~!]\S)/g)) {
    const at = (m.index ?? 0) + m[1].length;
    negated.add(at + 1);
    rest = rest.slice(0, at) + " " + rest.slice(at + 1);
  }
  if (!rest.trim()) return f;

  const p = parseQuickAdd(rest, now, true, listNames);
  // Repeat phrases mean nothing in a filter; drop their chips.
  const chips = p.chips.filter((c) => c.kind !== "repeat");
  for (const c of chips) {
    if (!negated.has(c.start)) {
      if (c.kind === "tag") f.tags.push(c.value ?? c.text.slice(1));
      else if (c.kind === "list") f.listName ??= c.text.slice(1);
      else if (c.kind === "priority") f.priority ??= parseQuickAdd(c.text, now).priority;
      continue;
    }
    c.start -= 1;
    c.text = `-${c.text}`;
    if (c.kind === "tag") f.notTags.push(c.value ?? c.text.slice(2));
    else if (c.kind === "list") f.notLists.push(c.text.slice(2));
    else if (c.kind === "priority") f.notPriorities.push(parseQuickAdd(c.text.slice(1), now).priority ?? 0);
  }
  f.chips.push(...chips);
  f.chips.sort((a, b) => a.start - b.start);
  f.someday = chips.some((c) => c.kind === "someday");
  f.deadline = p.deadline;
  f.durationMin = p.durationMin;
  f.waiting = p.waiting?.who ?? null;
  if (!f.date && chips.some((c) => c.kind === "date") && (p.schedule.kind === "day" || p.schedule.kind === "timed"))
    f.date = { kind: "on", date: p.schedule.kind === "day" ? p.schedule.date : toLocalDate(new Date(p.schedule.start)) };
  // parseQuickAdd falls back to the whole input when every word was a token.
  f.text = p.chips.length && p.title === rest.trim() ? "" : p.title;
  return f;
}

export const isEmptyFilter = (f: TaskFilter) =>
  !f.text && !f.tags.length && f.priority === null && f.listName === null && f.date === null && f.status === null &&
  !f.notTags.length && !f.notLists.length && !f.notPriorities.length && !f.someday && f.deadline === null && f.durationMin === null && f.waiting === null;

type Ctx = { today: LocalDate; lists: Record<string, TaskList>; tags: Record<string, Tag> };

export function matchesFilter(vm: TaskVM, f: TaskFilter, ctx: Ctx): boolean {
  const t = vm.task;
  if (f.status !== null && t.status !== f.status) return false;
  if (f.priority !== null && t.priority !== f.priority) return false;
  if (f.listName !== null) {
    const list = ctx.lists[t.listId];
    if (!list || nameKey(list.name) !== nameKey(f.listName)) return false;
  }
  if (f.notPriorities.includes(t.priority)) return false;
  if (f.notLists.some((n) => nameKey(ctx.lists[t.listId]?.name ?? "") === nameKey(n))) return false;
  if (f.tags.length || f.notTags.length) {
    const names = new Set(t.tags.map((id) => nameKey(ctx.tags[id]?.name ?? "")));
    if (!f.tags.every((n) => names.has(nameKey(n))) || f.notTags.some((n) => names.has(nameKey(n)))) return false;
  }
  if (f.someday && t.schedule.kind !== "someday") return false;
  if (f.deadline !== null && !(t.deadline !== null && t.deadline <= f.deadline)) return false;
  if (f.durationMin !== null && t.durationMin !== f.durationMin) return false;
  if (f.waiting !== null && !(t.waiting?.kind === "person" && nameKey(t.waiting.who) === nameKey(f.waiting))) return false;
  if (f.date) {
    if (f.date.kind === "none" && vm.schedule.kind !== "none") return false;
    if (f.date.kind === "overdue" && !(t.status === "open" && vm.date !== null && vm.date < ctx.today)) return false;
    if (f.date.kind === "on" && vm.date !== f.date.date) return false;
  }
  return !f.text || matchScore(t.title, f.text) !== null;
}
