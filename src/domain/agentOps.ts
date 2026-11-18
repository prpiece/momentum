/*
 * What an AI agent may ask the running app to do (ADR 0007, D264). Pure: the main window's
 * `lib/agentApi.ts` runs the parsed ops through the same store actions as the UI.
 * The localhost API is a system boundary, so every argument is validated here and unknown fields are refused.
 */
import { durationMinutes, hhmm, isLocalDate, moveToDate, scheduleDate } from "./dates";
import { describeRule, isValidRule } from "./recurrence";
import { PRIORITY_LABEL, type LocalDate, type Priority, type Reminder, type Schedule, type Tag, type Task, type TaskList } from "./types";

export class AgentError extends Error {}

/** A task as an agent sees it: plain words and ids, no internal fields. */
export type AgentTask = {
  id: string;
  title: string;
  notes: string;
  list: string;
  status: Task["status"];
  priority: "none" | "low" | "medium" | "high";
  /** `YYYY-MM-DD`, `someday`, or null. */
  planned: string | null;
  /** `HH:mm` when the task has a time block. */
  start: string | null;
  deadline: string | null;
  durationMin: number | null;
  tags: string[];
  subtasks: number;
  parentId: string | null;
  /** "Every week", "Daily"...: a repeating task shows its current occurrence, so deleting it needs a scope. */
  repeats: string | null;
  /** True for a repeating series (shown as its current occurrence) and for an occurrence detached from one. */
  isOccurrence: boolean;
  /** The id of the series this belongs to: its own id for the series, the parent series for a detached occurrence. */
  seriesId: string | null;
  /** The task's list is archived: it is left out of list_tasks and search_tasks unless includeArchived is set. */
  archived: boolean;
};

export function agentTask(t: Task, schedule: Schedule, ctx: { lists: Record<string, TaskList>; tags: Record<string, Tag>; subtasks: number }): AgentTask {
  return {
    id: t.id,
    title: t.title,
    notes: t.description,
    list: ctx.lists[t.listId]?.name ?? "Inbox",
    status: t.status,
    priority: PRIORITY_LABEL[t.priority].toLowerCase() as AgentTask["priority"],
    planned: schedule.kind === "someday" ? "someday" : scheduleDate(schedule),
    start: schedule.kind === "timed" ? hhmm(new Date(schedule.start)) : null,
    deadline: t.deadline,
    durationMin: schedule.kind === "timed" ? durationMinutes(schedule) : t.durationMin,
    tags: t.tags.flatMap((id) => ctx.tags[id]?.name ?? []),
    subtasks: ctx.subtasks,
    parentId: t.parentId,
    repeats: t.recurrence ? describeRule(t.recurrence.rule) : null,
    isOccurrence: !!t.recurrence || !!t.recurrenceParentId,
    seriesId: t.recurrence ? t.id : t.recurrenceParentId,
    archived: ctx.lists[t.listId]?.archived ?? false,
  };
}

export type Planned = { kind: "none" } | { kind: "someday" } | { kind: "day"; date: LocalDate };
/** Which occurrences an update to a recurring task changes. */
export type AgentScope = "this" | "following" | "all";
export type TaskPatch = {
  title?: string;
  description?: string;
  priority?: Priority;
  list?: string;
  planned?: Planned;
  deadline?: LocalDate | null;
  durationMin?: number | null;
  tags?: string[];
  /** `HH:mm`: makes the task a time block on its planned day (today when it has none). */
  time?: string;
  pinned?: boolean;
  /** An RRULE body (`FREQ=WEEKLY;BYDAY=MO`), checked with `isValidRule`; null stops repeating. Needs a planned day. */
  repeat?: string | null;
  /** Replaces the reminders. */
  reminders?: Reminder[];
  /** Replaces the checklist by item titles; an item whose title is kept stays ticked. */
  checklist?: string[];
  /** Move under this task (id or prefix), or null for top level. Update only. */
  parentId?: string | null;
};
export type HabitCheckin = { habit: string; date: LocalDate | null; delta: number | null; value: number | null };
export type AgentRequest =
  | { op: "list"; view: string; limit: number; includeArchived: boolean }
  | { op: "search"; text: string; limit: number; status: "open" | "done" | "all"; includeArchived: boolean }
  | { op: "get"; id: string }
  | { op: "add"; text: string; list: string | null; parentId: string | null; fields: TaskPatch | null }
  | { op: "update"; id: string; patch: TaskPatch; scope: AgentScope }
  | { op: "delete"; id: string; withSubtasks: boolean; scope: AgentScope }
  | { op: "restore"; id: string }
  | { op: "trash"; limit: number }
  | { op: "complete"; id: string; scope: "this" | "all" }
  | { op: "reopen"; id: string }
  | { op: "checkin" } & HabitCheckin
  | { op: "events"; from: LocalDate | null; to: LocalDate | null; limit: number }
  | { op: "habits" | "focus" }
  | { op: "lists" | "tags" };

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const MAX_TITLE = 500;
const MAX_TEXT = 1000;
const MAX_NOTES = 50000;
const PRIORITY_WORDS: Record<string, Priority> = { none: 0, low: 1, medium: 2, med: 2, high: 3 };

type Args = Record<string, unknown>;

/** Control characters become spaces: a title is one line. */
const oneLine = (v: string) => v.replace(/[\u0000-\u001f\u007f]+/g, " ");
function capped(v: string, max: number, what: string) {
  if (v.length > max) throw new AgentError(`${what} is too long (${v.length} characters; the limit is ${max}).`);
  return v;
}

function only(args: Args, allowed: string[]) {
  const extra = Object.keys(args).filter((k) => !allowed.includes(k));
  if (extra.length) throw new AgentError(`Unknown field${extra.length > 1 ? "s" : ""}: ${extra.join(", ")}. Allowed: ${allowed.join(", ") || "none"}.`);
}

function str(args: Args, k: string, required: true): string;
function str(args: Args, k: string, required?: false): string | null;
function str(args: Args, k: string, required = false): string | null {
  const v = args[k];
  if (v === undefined || v === null) {
    if (required) throw new AgentError(`${k} is required.`);
    return null;
  }
  if (typeof v !== "string" || (required && !v.trim())) throw new AgentError(`${k} must be a${required ? " non-empty" : ""} string.`);
  return v;
}

/** Ids are lowercase UUIDs; agents sometimes shout them. */
const idOf = (args: Args) => str(args, "id", true).trim().toLowerCase();

function limitOf(args: Args): number {
  const v = args.limit;
  if (v === undefined || v === null) return DEFAULT_LIMIT;
  if (typeof v !== "number" || !Number.isInteger(v) || v < 1) throw new AgentError("limit must be a positive integer.");
  return Math.min(v, MAX_LIMIT);
}

function scopeOf(args: Args): AgentScope {
  const scope = args.scope ?? "this";
  if (scope !== "this" && scope !== "following" && scope !== "all") throw new AgentError('scope must be "this", "following" or "all".');
  return scope;
}

function statusOf(args: Args): "open" | "done" | "all" {
  const v = args.status ?? "all";
  if (v !== "open" && v !== "done" && v !== "all") throw new AgentError('status must be "open", "done" or "all".');
  return v;
}

function flag(args: Args, k: string): boolean {
  const v = args[k] ?? false;
  if (typeof v !== "boolean") throw new AgentError(`${k} must be true or false.`);
  return v;
}

function dayOf(args: Args, k: string): LocalDate | null {
  const v = args[k];
  if (v === undefined || v === null || v === "") return null;
  if (!isLocalDate(v)) throw new AgentError(`${k} must be YYYY-MM-DD.`);
  return v;
}

function planned(v: unknown): Planned {
  if (v === "none" || v === null || v === "") return { kind: "none" };
  if (v === "someday") return { kind: "someday" };
  if (isLocalDate(v)) return { kind: "day", date: v };
  throw new AgentError('date must be YYYY-MM-DD, "someday" or "none".');
}

const MAX_CHECKLIST = 100;
const MAX_REMINDERS = 10;

/** `[{minutes: 10}]` (before a timed task starts) and `[{daysBefore: 1, time: "09:00"}]` (a day task, at a time N days before). */
function remindersOf(v: unknown): Reminder[] {
  const bad = () => new AgentError('reminders must be a list of {minutes} (before a time block) or {daysBefore, time: "HH:mm"} (before a day task), at most 10; [] clears them.');
  if (!Array.isArray(v) || v.length > MAX_REMINDERS) throw bad();
  return v.map((r): Reminder => {
    if (typeof r !== "object" || r === null || Array.isArray(r)) throw bad();
    const o = r as Args;
    const whole = (x: unknown, max: number) => typeof x === "number" && Number.isInteger(x) && x >= 0 && x <= max;
    if (Object.keys(o).length === 1 && whole(o.minutes, 60 * 24 * 30)) return { kind: "before", minutes: o.minutes as number };
    if (Object.keys(o).length === 2 && whole(o.daysBefore, 365) && typeof o.time === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(o.time)) return { kind: "dayOf", daysBefore: o.daysBefore as number, time: o.time };
    throw bad();
  });
}

/** Validates an update's fields. Anything outside the allow-list is refused rather than ignored. */
export function parsePatch(args: Args): TaskPatch {
  only(args, ["id", "scope", "title", "description", "priority", "list", "date", "time", "deadline", "durationMin", "tags", "pinned", "repeat", "reminders", "checklist", "parentId"]);
  const p = patchFields(args);
  if ("parentId" in args) {
    const v = args.parentId;
    if (v === null || v === "" || v === "none") p.parentId = null;
    else if (typeof v === "string") p.parentId = v.trim().toLowerCase();
    else throw new AgentError('parentId must be a task id or "none".');
  }
  if (Object.keys(p).length === 0) throw new AgentError("Nothing to update: give at least one field.");
  return p;
}

/** The task fields shared by add and update. */
function patchFields(args: Args): TaskPatch {
  const p: TaskPatch = {};
  if ("time" in args) {
    const v = args.time;
    if (typeof v !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(v)) throw new AgentError("time must be HH:mm (24-hour).");
    p.time = v;
  }
  if ("pinned" in args) p.pinned = flag(args, "pinned");
  if ("repeat" in args) {
    const v = args.repeat;
    if (v === null || v === "" || v === "none") p.repeat = null;
    else if (typeof v === "string" && isValidRule(v.trim().replace(/^RRULE:/i, ""))) p.repeat = v.trim().replace(/^RRULE:/i, "");
    else throw new AgentError('repeat must be an RRULE such as "FREQ=WEEKLY;BYDAY=MO,WE" (daily or slower), or "none".');
  }
  if ("reminders" in args) p.reminders = remindersOf(args.reminders);
  if ("checklist" in args) {
    const v = args.checklist;
    if (!Array.isArray(v) || v.length > MAX_CHECKLIST || v.some((x) => typeof x !== "string" || !oneLine(x).trim())) throw new AgentError(`checklist must be a list of at most ${MAX_CHECKLIST} non-empty item titles.`);
    p.checklist = v.map((x: string) => capped(oneLine(x).trim(), MAX_TITLE, "checklist item"));
  }
  if ("title" in args) p.title = capped(oneLine(str(args, "title", true)).trim(), MAX_TITLE, "title");
  if ("description" in args) p.description = capped(str(args, "description") ?? "", MAX_NOTES, "description");
  if ("priority" in args) {
    const v = args.priority;
    const n = typeof v === "string" ? (/^\d$/.test(v) ? Number(v) : PRIORITY_WORDS[v.toLowerCase()]) : v;
    if (typeof n !== "number" || !(n in PRIORITY_LABEL)) throw new AgentError("priority must be none, low, medium or high.");
    p.priority = n as Priority;
  }
  if ("list" in args) p.list = str(args, "list", true).trim();
  if ("date" in args) p.planned = planned(args.date);
  if (p.planned && p.planned.kind !== "day" && p.time) throw new AgentError('time needs a day: use a YYYY-MM-DD date (or leave date out), not "none" or "someday".');
  if ("deadline" in args) {
    const v = args.deadline;
    if (v === null || v === "" || v === "none") p.deadline = null;
    else if (isLocalDate(v)) p.deadline = v;
    else throw new AgentError('deadline must be YYYY-MM-DD or "none".');
  }
  if ("durationMin" in args) {
    const v = args.durationMin;
    if (v === null || v === 0 || v === "none") p.durationMin = null;
    else if (typeof v === "number" && Number.isInteger(v) && v > 0 && v <= 24 * 60) p.durationMin = v;
    else throw new AgentError("durationMin must be whole minutes between 1 and 1440, or none.");
  }
  if ("tags" in args) {
    const v = args.tags;
    const names = Array.isArray(v) ? v.map((x) => (typeof x === "string" ? x.trim().replace(/^#/, "") : "")) : [];
    if (!Array.isArray(v) || names.some((n) => !n || /[#\s\u0000-\u001f\u200b-\u200f\u2060\ufeff]/.test(n))) throw new AgentError("tags must be a list of single-word names.");
    // "work" and "Work" are one tag.
    p.tags = names.filter((n, i) => names.findIndex((m) => m.toLowerCase() === n.toLowerCase()) === i);
  }
  return p;
}

export function parseRequest(op: unknown, raw: unknown): AgentRequest {
  if (raw !== undefined && raw !== null && (typeof raw !== "object" || Array.isArray(raw))) throw new AgentError("args must be an object.");
  const args = (raw ?? {}) as Args;
  switch (op) {
    case "list":
      only(args, ["view", "limit", "includeArchived"]);
      return { op, view: str(args, "view")?.trim() || "today", limit: limitOf(args), includeArchived: flag(args, "includeArchived") };
    case "search":
      only(args, ["text", "limit", "status", "includeArchived"]);
      return { op, text: str(args, "text", true).trim(), limit: limitOf(args), status: statusOf(args), includeArchived: flag(args, "includeArchived") };
    case "get":
    case "reopen":
      only(args, ["id"]);
      return { op, id: idOf(args) };
    case "complete": {
      only(args, ["id", "scope"]);
      // "following" is the same as "all": a series ends from here on.
      const scope = args.scope ?? "this";
      if (scope !== "this" && scope !== "all" && scope !== "following") throw new AgentError('scope must be "this" or "all".');
      return { op, id: idOf(args), scope: scope === "this" ? "this" : "all" };
    }
    case "add": {
      only(args, ["text", "list", "parentId", "date", "time", "deadline", "durationMin", "priority", "tags"]);
      const list = str(args, "list")?.trim() || null;
      const parentId = str(args, "parentId")?.trim().toLowerCase() || null;
      if (list && parentId) throw new AgentError("Give list or parentId, not both: a subtask is in its parent's list.");
      // Structured fields win over what the parser picks out of the text, so an agent need not rely on the grammar.
      const fields = patchFields(args);
      delete fields.list; // add has its own list handling
      return { op, text: capped(oneLine(str(args, "text", true)).trim(), MAX_TEXT, "text"), list, parentId, fields: Object.keys(fields).length ? fields : null };
    }
    case "update": {
      const scope = scopeOf(args);
      return { op, id: idOf(args), patch: parsePatch(args), scope };
    }
    case "delete": {
      only(args, ["id", "withSubtasks", "scope"]);
      const w = args.withSubtasks ?? false;
      if (typeof w !== "boolean") throw new AgentError("withSubtasks must be true or false.");
      return { op, id: idOf(args), withSubtasks: w, scope: scopeOf(args) };
    }
    case "restore":
      only(args, ["id"]);
      return { op, id: idOf(args) };
    case "trash":
      only(args, ["limit"]);
      return { op, limit: limitOf(args) };
    case "checkin": {
      only(args, ["habit", "date", "delta", "value"]);
      const int = (k: string) => {
        const v = args[k];
        if (v === undefined || v === null) return null;
        if (typeof v !== "number" || !Number.isInteger(v) || Math.abs(v) > 100000) throw new AgentError(`${k} must be a whole number.`);
        return v;
      };
      const [delta, value] = [int("delta"), int("value")];
      if (delta !== null && value !== null) throw new AgentError("Give delta or value, not both.");
      if (value !== null && value < 0) throw new AgentError("value can't be negative.");
      return { op, habit: str(args, "habit", true).trim(), date: dayOf(args, "date"), delta, value };
    }
    case "events": {
      only(args, ["from", "to", "limit"]);
      const [from, to] = [dayOf(args, "from"), dayOf(args, "to")];
      if (from && to && to < from) throw new AgentError("to is before from.");
      return { op, from, to, limit: limitOf(args) };
    }
    case "habits":
    case "focus":
    case "lists":
    case "tags":
      only(args, []);
      return { op };
    default:
      throw new AgentError(`Unknown operation: ${String(op)}.`);
  }
}

/** The schedule after a planned-date change: a time block keeps its time and length; an undated task gets a day, never a time. */
export function applyPlanned(current: Schedule, p: Planned): Schedule {
  if (p.kind !== "day") return p;
  return current.kind === "none" || current.kind === "someday" ? p : moveToDate(current, p.date);
}
