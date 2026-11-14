import { isValidRule } from "./recurrence";
import { MAX_SUBTASK_DEPTH, type LocalDate, type Priority, type Schedule } from "./types";

/**
 * What an import from another app will create, as plain data with temporary ids (D280).
 * The parsers (`importTodoist`, `importTickTick`) build it; `stores/importPlan.ts` applies it.
 * Every list is new, even when a list of the same name exists.
 */
export type PlanList = { id: string; name: string; /** Folder name (TickTick), or null. */ folder: string | null };
export type PlanSection = { id: string; list: string; name: string };
export type PlanTask = {
  id: string;
  /** Another plan task's id, same list; parents come before children in `tasks`. */
  parent: string | null;
  list: string;
  section: string | null;
  title: string;
  description: string;
  priority: Priority;
  status: "open" | "done" | "wont_do";
  schedule: Schedule;
  deadline: LocalDate | null;
  durationMin: number | null;
  /** A valid RRULE body; only set when the task has a day or time to repeat from. */
  rule: string | null;
  tags: string[];
  checklist: { title: string; done: boolean }[];
  completedAt: string | null;
};
export type Skipped = { line: number | null; reason: string };
export type PlanCounts = {
  lists: number;
  folders: number;
  sections: number;
  tasks: number;
  subtasks: number;
  tags: number;
  completed: number;
  repeatsKept: number;
  repeatsNotKept: number;
  skipped: number;
};
export type ImportPlan = {
  folders: string[];
  lists: PlanList[];
  sections: PlanSection[];
  tasks: PlanTask[];
  skipped: Skipped[];
  counts: PlanCounts;
};

/** What a parser hands to `finalize`: tasks in any order, parents possibly missing. */
export type RawPlan = Omit<ImportPlan, "counts" | "folders"> & { repeatsNotKept: number };

/** Drops bad references, orders parents before children, caps nesting at MAX_SUBTASK_DEPTH and counts. */
export function finalize(raw: RawPlan): ImportPlan {
  const skipped = [...raw.skipped];
  const seen = new Set<string>();
  const input = raw.tasks.filter((t) => {
    if (seen.has(t.id)) skipped.push({ line: null, reason: `duplicate id for "${t.title}"` });
    return !seen.has(t.id) && !!seen.add(t.id);
  });
  const byId = new Map(input.map((t) => [t.id, t]));
  const parentOf = (t: PlanTask) => {
    const p = t.parent ? byId.get(t.parent) : undefined;
    if (!p || p.id === t.id || p.list !== t.list) return null;
    for (let a: PlanTask | undefined = p, n = 0; a; a = a.parent ? byId.get(a.parent) : undefined) {
      if (a.id === t.id || ++n > input.length) return null; // a cycle
    }
    return p;
  };
  const kids = new Map<string | null, PlanTask[]>();
  for (const t of input) {
    const key = parentOf(t)?.id ?? null;
    kids.set(key, [...(kids.get(key) ?? []), t]);
  }
  const tasks: PlanTask[] = [];
  const walk = (parent: string | null, chain: string[]) => {
    for (const t of kids.get(parent) ?? []) {
      // Deeper than the limit: a sibling of the deepest allowed level.
      const up = chain.slice(0, MAX_SUBTASK_DEPTH);
      tasks.push({ ...t, parent: up.length ? up[up.length - 1] : null });
      walk(t.id, [...chain, t.id]);
    }
  };
  walk(null, []);
  const folders = [...new Set(raw.lists.flatMap((l) => (l.folder ? [l.folder] : [])))];
  const tags = new Set(tasks.flatMap((t) => t.tags.map((n) => n.toLowerCase())));
  const repeatsKept = tasks.filter((t) => t.rule).length;
  return {
    folders,
    lists: raw.lists,
    sections: raw.sections,
    tasks,
    skipped,
    counts: {
      lists: raw.lists.length,
      folders: folders.length,
      sections: raw.sections.length,
      tasks: tasks.length,
      subtasks: tasks.filter((t) => t.parent).length,
      tags: tags.size,
      completed: tasks.filter((t) => t.status !== "open").length,
      repeatsKept,
      repeatsNotKept: raw.repeatsNotKept,
      skipped: skipped.length,
    },
  };
}

/** A rule is kept only if it parses and the task has something to repeat from. */
export const keepRule = (rule: string | null, schedule: Schedule) => (rule && isValidRule(rule) && (schedule.kind === "day" || schedule.kind === "timed") ? rule : null);

export const clean = (s: string | undefined) => (s ?? "").replace(/\s+/g, " ").trim();
