import { parseCsv } from "./csv";
import { addDaysLocal, atLocalTime, fromLocalDate, isLocalDate, timed, todayLocal } from "./dates";
import { clean, finalize, keepRule, type ImportPlan, type PlanList, type PlanSection, type PlanTask, type Skipped } from "./importPlan";
import type { Priority, Schedule } from "./types";

/*
 * Todoist import: the per-project CSV export and the JSON backup (Sync API shape).
 *
 * Priority: the CSV column uses the app's numbering (1 = p1, the highest; 4 = none) and the API uses the
 * reverse (4 = p1, 1 = none). Both map to Momentum's 3 high, 2 medium, 1 low, 0 none.
 * Labels: `@label` words in a CSV task's content, `labels` in the JSON. Completed tasks are only in the JSON.
 */

const CSV_PRIORITY: Record<string, Priority> = { "1": 3, "2": 2, "3": 1, "4": 0 };
/** A map lookup that ignores inherited keys like "constructor" (DATA-09). */
const own = <K extends string | number>(m: Record<K, Priority>, k: K): Priority => (Object.prototype.hasOwnProperty.call(m, k) ? m[k] : 0);
const API_PRIORITY: Record<number, Priority> = { 4: 3, 3: 2, 2: 1, 1: 0 };

const DAY_CODES: Record<string, string> = { mon: "MO", tue: "TU", wed: "WE", thu: "TH", fri: "FR", sat: "SA", sun: "SU" };
const DAY_INDEX: Record<string, number> = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
const UNITS: Record<string, string> = { day: "DAILY", week: "WEEKLY", month: "MONTHLY", year: "YEARLY" };

export type TodoistRepeat = { rule: string; time: string | null };

/** "every 2 weeks", "every monday at 9am", "every weekday", "every other day"… → an RRULE, or null when it doesn't map. */
export function todoistRepeat(text: string): TodoistRepeat | null {
  let s = text.toLowerCase().trim().replace(/^every!/, "every");
  let time: string | null = null;
  const at = /\s+(?:at|@)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/.exec(s);
  if (at) {
    let h = Number(at[1]);
    if (at[3] === "pm" && h < 12) h += 12;
    if (at[3] === "am" && h === 12) h = 0;
    if (h > 23) return null;
    time = `${String(h).padStart(2, "0")}:${at[2] ?? "00"}`;
    s = s.slice(0, at.index);
  }
  const unit = /^every (?:(\d+) |(other) )?(day|week|month|year)s?$/.exec(s);
  if (unit) {
    const interval = unit[2] ? 2 : Number(unit[1] ?? 1);
    if (interval < 1) return null;
    return { rule: `FREQ=${UNITS[unit[3]]}${interval > 1 ? `;INTERVAL=${interval}` : ""}`, time };
  }
  if (/^every (?:week|work)day$/.test(s)) return { rule: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR", time };
  if (/^every weekend$/.test(s)) return { rule: "FREQ=WEEKLY;BYDAY=SA,SU", time };
  const days = /^every ((?:mon|tue|wed|thu|fri|sat|sun)[a-z]*(?:\s*(?:,|and|&)\s*(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*)*)$/.exec(s);
  if (days) {
    const codes = days[1].split(/\s*(?:,|and|&)\s*/).map((d) => DAY_CODES[d.slice(0, 3)]);
    if (codes.every(Boolean)) return { rule: `FREQ=WEEKLY;BYDAY=${[...new Set(codes)].join(",")}`, time };
  }
  return null;
}

/** First day on or after `from` that falls on one of the rule's BYDAY weekdays (or `from` itself). */
function firstOccurrence(rule: string, from: string): string {
  const by = /BYDAY=([A-Z,]+)/.exec(rule)?.[1].split(",");
  if (!by) return from;
  for (let i = 0; i < 7; i++) {
    const d = addDaysLocal(from, i);
    if (by.includes(Object.keys(DAY_INDEX).find((k) => DAY_INDEX[k] === fromLocalDate(d).getDay()) ?? "")) return d;
  }
  return from;
}

type Due = { schedule: Schedule; rule: string | null; lost: boolean };
const NO_DUE: Due = { schedule: { kind: "none" }, rule: null, lost: false };
const ABSOLUTE = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?\s*(Z|[+-]\d{2}:?\d{2})?)?$/;

function scheduleOf(date: string, hhmm: string | null, minutes: number | null): Schedule {
  return hhmm ? timed(atLocalTime(date, hhmm), minutes ?? 60) : { kind: "day", date };
}

/** A Todoist due date: `2025-03-04`, `2025-03-04 14:00`, `2025-03-04T14:00:00Z`, or a recurring phrase. */
function dueOf(date: string, repeatText: string | null, isRecurring: boolean, minutes: number | null, today: string): Due {
  const abs = ABSOLUTE.exec(date.trim());
  let rule: string | null = null;
  let lost = false;
  if (isRecurring && repeatText) {
    const r = todoistRepeat(repeatText);
    if (r) rule = r.rule;
    else lost = true;
  }
  if (abs && isLocalDate(abs[1])) {
    const base = abs[1];
    if (abs[2] === undefined) return { schedule: { kind: "day", date: base }, rule, lost };
    const hhmm = `${abs[2].padStart(2, "0")}:${abs[3]}`;
    if (abs[4]) {
      const start = new Date(`${base}T${hhmm}:00${abs[4] === "Z" ? "Z" : abs[4].replace(/^([+-]\d{2})(\d{2})$/, "$1:$2")}`);
      if (!Number.isNaN(start.getTime())) return { schedule: timed(start, minutes ?? 60), rule, lost };
    }
    return { schedule: scheduleOf(base, hhmm, minutes), rule, lost };
  }
  // Text only ("every monday"): start from the next matching day.
  const r = todoistRepeat(date);
  if (r) return { schedule: scheduleOf(firstOccurrence(r.rule, today), r.time, minutes), rule: r.rule, lost };
  if (/^every/i.test(date.trim())) return { ...NO_DUE, lost: true };
  return NO_DUE;
}

const text = (v: unknown) => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");
const rec = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

/** `name` titles the list for a per-project CSV. Returns null when the text has no tasks. */
export function parseTodoist(input: string, name: string, today = todayLocal()): ImportPlan | null {
  const plan = input.startsWith("{") || input.startsWith("[") ? fromJson(input, name, today) : fromCsv(input, name, today);
  return plan && plan.tasks.length ? plan : null;
}

type Collected = { lists: PlanList[]; sections: PlanSection[]; tasks: PlanTask[]; skipped: Skipped[]; repeatsNotKept: number };

function fromCsv(input: string, name: string, today: string): ImportPlan | null {
  const rows = parseCsv(input);
  const h = rows.findIndex((r) => r[0]?.trim().toUpperCase() === "TYPE" && r.some((c) => c.trim().toUpperCase() === "CONTENT"));
  if (h < 0) return null;
  const col = (n: string) => rows[h].findIndex((c) => c.trim().toUpperCase() === n);
  const c = Object.fromEntries(["TYPE", "CONTENT", "DESCRIPTION", "PRIORITY", "INDENT", "DATE", "DURATION", "DURATION_UNIT", "DEADLINE"].map((n) => [n, col(n)]));
  const cell = (r: string[], n: string) => (c[n] >= 0 ? (r[c[n]] ?? "").trim() : "");

  const out: Collected = { lists: [{ id: "l1", name: clean(name) || "Todoist", folder: null }], sections: [], tasks: [], skipped: [], repeatsNotKept: 0 };
  let section: string | null = null;
  const stack: string[] = []; // task ids by indent level
  let last: PlanTask | null = null;
  rows.slice(h + 1).forEach((r, i) => {
    const line = h + i + 2;
    const type = cell(r, "TYPE").toLowerCase();
    if (!r.some((x) => x.trim())) return;
    if (type === "section") {
      const n = clean(cell(r, "CONTENT"));
      if (!n) return void out.skipped.push({ line, reason: "section without a name" });
      section = `s${out.sections.length + 1}`;
      out.sections.push({ id: section, list: "l1", name: n });
      stack.length = 0;
      return;
    }
    if (type === "note") {
      const n = cell(r, "CONTENT");
      if (last && n) last.description = last.description ? `${last.description}\n\n${n}` : n;
      else if (!last) out.skipped.push({ line, reason: "note before any task" });
      return;
    }
    if (type !== "task") {
      if (type !== "meta") out.skipped.push({ line, reason: `unknown row type "${cell(r, "TYPE")}"` });
      return;
    }
    const raw = cell(r, "CONTENT");
    const tags: string[] = [];
    const title = clean(raw.replace(/(^|\s)@([^\s@]+)/g, (_m, sp: string, t: string) => (tags.push(t), sp)));
    if (!title) return void out.skipped.push({ line, reason: "task without a title" });
    const indent = Math.min(Math.max(Number.parseInt(cell(r, "INDENT"), 10) || 1, 1), stack.length + 1);
    stack.length = indent - 1;
    const amount = Number(cell(r, "DURATION"));
    const minutes = cell(r, "DURATION_UNIT").toLowerCase() === "minute" && amount > 0 ? Math.round(amount) : null;
    const dateText = cell(r, "DATE");
    const due = dateText ? dueOf(dateText, dateText, /^every/i.test(dateText), minutes, today) : NO_DUE;
    const rule = keepRule(due.rule, due.schedule);
    if (dateText && /^every/i.test(dateText) && !rule) out.repeatsNotKept++;
    const deadline = cell(r, "DEADLINE").slice(0, 10);
    const t: PlanTask = {
      id: `t${out.tasks.length + 1}`,
      parent: stack[indent - 2] ?? null,
      list: "l1",
      section,
      title,
      description: cell(r, "DESCRIPTION"),
      priority: own(CSV_PRIORITY, cell(r, "PRIORITY")),
      status: "open",
      schedule: due.schedule,
      deadline: isLocalDate(deadline) ? deadline : null,
      durationMin: due.schedule.kind === "timed" ? null : minutes,
      rule,
      tags,
      checklist: [],
      completedAt: null,
    };
    stack[indent - 1] = t.id;
    out.tasks.push(t);
    last = t;
  });
  return finalize(out);
}

function fromJson(input: string, name: string, today: string): ImportPlan | null {
  const root = rec(JSON.parse(input));
  if (!root || !Array.isArray(root.items)) return null;
  const out: Collected = { lists: [], sections: [], tasks: [], skipped: [], repeatsNotKept: 0 };
  const listOf = new Map<string, string>();
  const sectionOf = new Map<string, string>();
  const listFor = (pid: string, title: string, inbox = false) => {
    let id = listOf.get(pid);
    if (!id) {
      id = `l${out.lists.length + 1}`;
      listOf.set(pid, id);
      out.lists.push({ id, name: clean(title) || "Todoist", folder: null, ...(inbox ? { inbox } : {}) });
    }
    return id;
  };
  for (const p of Array.isArray(root.projects) ? root.projects : []) {
    const o = rec(p);
    if (o && o.id !== undefined && !o.is_deleted && !o.is_archived) listFor(text(o.id), text(o.name), o.inbox_project === true);
  }
  const order = (x: unknown, key: string) => Number(rec(x)?.[key]) || 0;
  const sorted = (xs: unknown, key: string) => (Array.isArray(xs) ? xs : []).map((x, i) => [x, i] as const).sort((a, b) => order(a[0], key) - order(b[0], key) || a[1] - b[1]);
  for (const [s] of sorted(root.sections, "section_order")) {
    const o = rec(s);
    const list = o && listOf.get(text(o.project_id));
    if (!o || !list || o.is_deleted || !clean(text(o.name))) continue;
    const id = `s${out.sections.length + 1}`;
    sectionOf.set(text(o.id), id);
    out.sections.push({ id, list, name: clean(text(o.name)) });
  }
  const ids = new Set<string>();
  sorted(root.items, "child_order").forEach(([item, i]) => {
    const o = rec(item);
    const skip = (reason: string) => void out.skipped.push({ line: i + 1, reason });
    if (!o) return skip("not a task");
    if (o.is_deleted) return;
    const title = clean(text(o.content));
    if (!title) return skip("task without a title");
    const pid = text(o.project_id);
    // A project we didn't list (archived or missing) still gets a list if its tasks are there.
    const list = listOf.get(pid) ?? (pid ? undefined : listFor("", name));
    if (!list) return skip("task in an archived or missing project");
    const due = rec(o.due);
    const dur = rec(o.duration);
    const minutes = dur && text(dur.unit) === "minute" && Number(dur.amount) > 0 ? Math.round(Number(dur.amount)) : null;
    const d = due && text(due.date) ? dueOf(text(due.date), text(due.string), due.is_recurring === true, minutes, today) : NO_DUE;
    const rule = keepRule(d.rule, d.schedule);
    if (due?.is_recurring === true && !rule) out.repeatsNotKept++;
    const dl = text(rec(o.deadline)?.date).slice(0, 10);
    const done = o.checked === true || o.checked === 1 || o.is_completed === true || !!text(o.completed_at);
    const id = text(o.id) || `i${i}`;
    if (ids.has(id)) return skip("duplicate task id");
    ids.add(id);
    out.tasks.push({
      id,
      parent: text(o.parent_id) || null,
      list,
      section: sectionOf.get(text(o.section_id)) ?? null,
      title,
      description: text(o.description),
      priority: own(API_PRIORITY, Number(o.priority)),
      status: done ? "done" : "open",
      schedule: d.schedule,
      deadline: isLocalDate(dl) ? dl : null,
      durationMin: d.schedule.kind === "timed" ? null : minutes,
      rule,
      tags: Array.isArray(o.labels) ? o.labels.map((l) => clean(text(l))).filter(Boolean) : [],
      checklist: [],
      completedAt: text(o.completed_at) && !Number.isNaN(Date.parse(text(o.completed_at))) ? new Date(text(o.completed_at)).toISOString() : null,
    });
  });
  return finalize(out);
}
