import { parseCsv } from "./csv";
import { timed, toLocalDate } from "./dates";
import { clean, finalize, keepRule, type ImportPlan, type PlanList, type PlanSection, type PlanTask, type Skipped } from "./importPlan";
import type { LocalDate, Priority, Schedule } from "./types";

/*
 * TickTick import: the CSV backup (Settings → Account → Generate Backup). It starts with a few metadata lines,
 * then a header row beginning "Folder Name","List Name","Title".
 *
 * Folder → Momentum folder; List → list; Column Name (kanban) → section; parentId → subtask; Tags → tags;
 * Priority 0/1/3/5 → none/low/medium/high; Status 0 open, 1 and 2 done, -1 won't do; Repeat is an RRULE.
 * "Is Check list" content: ▫ lines are open checklist items and ▪ lines done ones.
 */

const PRIORITY: Record<string, Priority> = { "0": 0, "1": 1, "3": 2, "5": 3 };

/** TickTick writes `2025-03-04T14:00:00+0000`. */
const instantOf = (s: string): Date | null => {
  const d = new Date(s.trim().replace(/([+-]\d{2})(\d{2})$/, "$1:$2"));
  return Number.isNaN(d.getTime()) ? null : d;
};

/** The calendar date an instant has in `timeZone` (an all-day task is stored as midnight in the user's zone). */
function dateIn(d: Date, timeZone: string): LocalDate {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  } catch {
    return toLocalDate(d);
  }
}

function scheduleOf(start: string, due: string, allDay: boolean, tz: string): Schedule {
  const s = instantOf(start);
  const e = instantOf(due);
  const first = s ?? e;
  if (!first) return { kind: "none" };
  if (allDay) return { kind: "day", date: dateIn(first, tz || "UTC") };
  const end = s && e && e > s ? e : null;
  const sched = timed(first, 60);
  return end && sched.kind === "timed" ? { ...sched, end: end.toISOString() } : sched;
}

/** Returns null when there is no header row or no task under it. */
export function parseTickTick(input: string): ImportPlan | null {
  const rows = parseCsv(input);
  const h = rows.findIndex((r) => r[0]?.trim() === "Folder Name" && r.some((c) => c.trim() === "Title"));
  if (h < 0) return null;
  const idx = (n: string) => rows[h].findIndex((c) => c.trim() === n);
  const c = Object.fromEntries(
    ["Folder Name", "List Name", "Title", "Tags", "Content", "Is Check list", "Start Date", "Due Date", "Repeat", "Priority", "Status", "Completed Time", "Timezone", "Is All Day", "Column Name", "taskId", "parentId"].map((n) => [n, idx(n)]),
  );
  const cell = (r: string[], n: string) => (c[n] >= 0 ? (r[c[n]] ?? "").trim() : "");

  const lists: PlanList[] = [];
  const sections: PlanSection[] = [];
  const tasks: PlanTask[] = [];
  const skipped: Skipped[] = [];
  let repeatsNotKept = 0;
  const listIds = new Map<string, string>();
  const sectionIds = new Map<string, string>();

  rows.slice(h + 1).forEach((r, i) => {
    const line = h + i + 2;
    if (!r.some((x) => x.trim())) return;
    const title = clean(cell(r, "Title"));
    if (!title) return void skipped.push({ line, reason: "task without a title" });
    const listName = clean(cell(r, "List Name")) || "TickTick";
    const folder = clean(cell(r, "Folder Name")) || null;
    const listKey = `${folder ?? ""}\u0000${listName}`;
    let list = listIds.get(listKey);
    if (!list) {
      list = `l${lists.length + 1}`;
      listIds.set(listKey, list);
      lists.push({ id: list, name: listName, folder });
    }
    const col = clean(cell(r, "Column Name"));
    let section: string | null = null;
    if (col) {
      section = sectionIds.get(`${list}\u0000${col}`) ?? null;
      if (!section) {
        section = `s${sections.length + 1}`;
        sectionIds.set(`${list}\u0000${col}`, section);
        sections.push({ id: section, list, name: col });
      }
    }
    const schedule = scheduleOf(cell(r, "Start Date"), cell(r, "Due Date"), /^(true|y|yes|1)$/i.test(cell(r, "Is All Day")), cell(r, "Timezone"));
    const repeat = cell(r, "Repeat").split(/\r?\n/).find((l) => /^(RRULE:)?FREQ=/i.test(l.trim()))?.trim().replace(/^RRULE:/i, "") ?? "";
    const rule = repeat ? keepRule(repeat, schedule) : null;
    if (cell(r, "Repeat") && !rule) repeatsNotKept++;

    // ▫ / ▪ lines (a checklist's content) are its items; any other lines are notes.
    const checklist: PlanTask["checklist"] = [];
    const notes: string[] = [];
    for (const l of cell(r, "Content").split(/\r?\n/)) {
      const m = /^\s*([▫▪])\s*(.*)$/.exec(l);
      if (m) {
        if (clean(m[2])) checklist.push({ title: clean(m[2]), done: m[1] === "▪" });
      } else notes.push(l);
    }
    const status = cell(r, "Status");
    const completed = instantOf(cell(r, "Completed Time"));
    tasks.push({
      id: cell(r, "taskId") || `i${tasks.length}`,
      parent: cell(r, "parentId") || null,
      list,
      section,
      title,
      description: notes.join("\n").trim(),
      priority: Object.prototype.hasOwnProperty.call(PRIORITY, cell(r, "Priority")) ? PRIORITY[cell(r, "Priority")] : 0,
      status: status === "1" || status === "2" ? "done" : status === "-1" ? "wont_do" : "open",
      schedule,
      deadline: null,
      durationMin: null,
      rule,
      tags: cell(r, "Tags").split(",").map(clean).filter(Boolean),
      checklist,
      completedAt: completed && (status === "1" || status === "2") ? completed.toISOString() : null,
    });
  });
  if (!tasks.length) return null;
  return finalize({ lists, sections, tasks, skipped, repeatsNotKept });
}
