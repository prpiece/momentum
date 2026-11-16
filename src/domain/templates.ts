import { addDaysLocal, atLocalTime, daysBetween, durationMinutes, hhmm, scheduleDate, timed } from "./dates";
import { isRecord, oneOf } from "./settings";
import { PRIORITIES, type ChecklistItem, type Priority, type Reminder, type Schedule, type Task, type TaskTemplate, type TemplateNode } from "./types";

/** Task templates (D337, FEAT-02): save a task tree, make a fresh copy of it later. Pure. */

export const MAX_TEMPLATES = 50;
const MAX_NODES = 200;
const MAX_DEPTH = 5;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Saves `rootId` and its live subtasks. Day offsets are from the root's date (or the earliest dated subtask when it has none). */
export function templateFromTask(
  rootId: string,
  tasks: Readonly<Record<string, Task>>,
  tagName: (id: string) => string | undefined,
  id: string,
  name: string,
): TaskTemplate | null {
  const root = tasks[rootId];
  if (!root) return null;
  const kids = (pid: string) => Object.values(tasks).filter((t) => t.parentId === pid && !t.deletedAt).sort((a, b) => a.sortOrder - b.sortOrder);
  const dates: string[] = [];
  const collect = (t: Task, depth: number) => {
    const d = scheduleDate(t.schedule);
    if (d) dates.push(d);
    if (depth < MAX_DEPTH) kids(t.id).forEach((k) => collect(k, depth + 1));
  };
  collect(root, 0);
  const anchor = scheduleDate(root.schedule) ?? dates.sort()[0] ?? null;
  let count = 0;
  const node = (t: Task, depth: number): TemplateNode => {
    count++;
    const d = scheduleDate(t.schedule);
    return {
      title: t.title,
      description: t.description,
      priority: t.priority,
      tags: t.tags.map(tagName).filter((n): n is string => !!n),
      checklist: t.checklist.map((i) => i.title),
      durationMin: durationMinutes(t.schedule) ?? t.durationMin,
      when: anchor && d ? { offset: daysBetween(anchor, d), time: t.schedule.kind === "timed" ? hhmm(new Date(t.schedule.start)) : null } : null,
      reminders: t.reminders,
      children: depth < MAX_DEPTH ? kids(t.id).filter(() => count < MAX_NODES).map((k) => node(k, depth + 1)) : [],
    };
  };
  return { id, name: name.trim() || root.title, root: node(root, 0) };
}

/** What a template makes: a tree of new-task fields with dates resolved against an anchor day. */
export type TaskSpec = {
  title: string;
  description: string;
  priority: Priority;
  tagNames: string[];
  checklist: ChecklistItem[];
  durationMin: number | null;
  schedule: Schedule;
  reminders: Reminder[];
  children: TaskSpec[];
};

/** The root lands on `anchor`; the rest keep their spacing from it. `newId` makes checklist item ids. */
export function specFromTemplate(tpl: TaskTemplate, anchor: string, newId: () => string): TaskSpec {
  const spec = (n: TemplateNode): TaskSpec => {
    let schedule: Schedule = { kind: "none" };
    if (n.when) {
      const date = addDaysLocal(anchor, n.when.offset);
      schedule = n.when.time ? timed(atLocalTime(date, n.when.time), n.durationMin ?? 60) : { kind: "day", date };
    }
    return {
      title: n.title,
      description: n.description,
      priority: n.priority,
      tagNames: n.tags,
      checklist: n.checklist.map((title) => ({ id: newId(), title, done: false })),
      durationMin: n.when?.time ? null : n.durationMin,
      schedule,
      reminders: n.reminders,
      children: n.children.map(spec),
    };
  };
  return spec(tpl.root);
}

// ---------- boundary ----------

const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");
const strings = (v: unknown, max: number, len: number) =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && !!x.trim()).slice(0, max).map((x) => x.slice(0, len)) : [];

function parseReminder(v: unknown): Reminder | null {
  if (!isRecord(v)) return null;
  if (v.kind === "before" && typeof v.minutes === "number" && Number.isInteger(v.minutes) && v.minutes >= 0 && v.minutes <= 40320) return { kind: "before", minutes: v.minutes };
  if (v.kind === "dayOf" && typeof v.daysBefore === "number" && Number.isInteger(v.daysBefore) && v.daysBefore >= 0 && v.daysBefore <= 365 && typeof v.time === "string" && HHMM.test(v.time))
    return { kind: "dayOf", daysBefore: v.daysBefore, time: v.time };
  return null;
}

function parseNode(v: unknown, depth: number, budget: { left: number }): TemplateNode | null {
  if (!isRecord(v) || budget.left <= 0) return null;
  budget.left--;
  const w = isRecord(v.when) && typeof v.when.offset === "number" && Number.isInteger(v.when.offset) && Math.abs(v.when.offset) <= 3650 ? v.when : null;
  return {
    title: str(v.title, 500).trim() || "Untitled",
    description: str(v.description, 20000),
    priority: oneOf(PRIORITIES, v.priority) ? v.priority : 0,
    tags: strings(v.tags, 20, 100),
    checklist: strings(v.checklist, 100, 500),
    durationMin: typeof v.durationMin === "number" && Number.isInteger(v.durationMin) && v.durationMin >= 1 && v.durationMin <= 1440 ? v.durationMin : null,
    when: w ? { offset: w.offset as number, time: typeof w.time === "string" && HHMM.test(w.time) ? w.time : null } : null,
    reminders: Array.isArray(v.reminders) ? v.reminders.map(parseReminder).filter((r): r is Reminder => !!r).slice(0, 10) : [],
    children: depth < MAX_DEPTH && Array.isArray(v.children) ? v.children.map((c) => parseNode(c, depth + 1, budget)).filter((c): c is TemplateNode => !!c) : [],
  };
}

/** Boundary parse (settings from disk, sync, import): drops what isn't a template and caps sizes. */
export function parseTemplates(raw: unknown): TaskTemplate[] {
  if (!Array.isArray(raw)) return [];
  const out: TaskTemplate[] = [];
  for (const t of raw) {
    if (!isRecord(t) || typeof t.id !== "string" || !t.id || typeof t.name !== "string" || out.some((x) => x.id === t.id)) continue;
    const root = parseNode(t.root, 0, { left: MAX_NODES });
    if (root) out.push({ id: t.id, name: t.name.trim().slice(0, 100) || root.title, root });
    if (out.length === MAX_TEMPLATES) break;
  }
  return out;
}

/** Saving under a name already in use replaces that template, so saving twice is not a duplicate. */
export function withTemplate(list: readonly TaskTemplate[], t: TaskTemplate): TaskTemplate[] {
  const key = t.name.trim().toLowerCase();
  return [...list.filter((x) => x.name.trim().toLowerCase() !== key), t].slice(-MAX_TEMPLATES);
}
