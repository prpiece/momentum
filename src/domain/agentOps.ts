/*
 * What an AI agent may ask the running app to do (ADR 0007, D264). Pure: the main window's
 * `lib/agentApi.ts` runs the parsed ops through the same store actions as the UI.
 * The localhost API is a system boundary, so every argument is validated here and unknown fields are refused.
 */
import { durationMinutes, hhmm, isLocalDate, moveToDate, scheduleDate } from "./dates";
import { PRIORITY_LABEL, type LocalDate, type Priority, type Schedule, type Tag, type Task, type TaskList } from "./types";

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
};
export type AgentRequest =
  | { op: "list"; view: string; limit: number }
  | { op: "search"; text: string; limit: number }
  | { op: "get"; id: string }
  | { op: "add"; text: string; list: string | null; parentId: string | null }
  | { op: "update"; id: string; patch: TaskPatch; scope: AgentScope }
  | { op: "delete"; id: string; withSubtasks: boolean }
  | { op: "restore"; id: string }
  | { op: "trash"; limit: number }
  | { op: "complete" | "reopen"; id: string }
  | { op: "habits" };

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const PRIORITY_WORDS: Record<string, Priority> = { none: 0, low: 1, medium: 2, med: 2, high: 3 };

type Args = Record<string, unknown>;

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

function limitOf(args: Args): number {
  const v = args.limit;
  if (v === undefined || v === null) return DEFAULT_LIMIT;
  if (typeof v !== "number" || !Number.isInteger(v) || v < 1) throw new AgentError("limit must be a positive integer.");
  return Math.min(v, MAX_LIMIT);
}

function planned(v: unknown): Planned {
  if (v === "none" || v === null || v === "") return { kind: "none" };
  if (v === "someday") return { kind: "someday" };
  if (isLocalDate(v)) return { kind: "day", date: v };
  throw new AgentError('date must be YYYY-MM-DD, "someday" or "none".');
}

/** Validates an update's fields. Anything outside the allow-list is refused rather than ignored. */
export function parsePatch(args: Args): TaskPatch {
  only(args, ["id", "scope", "title", "description", "priority", "list", "date", "deadline", "durationMin", "tags"]);
  const p: TaskPatch = {};
  if ("title" in args) p.title = str(args, "title", true).trim();
  if ("description" in args) p.description = str(args, "description") ?? "";
  if ("priority" in args) {
    const v = args.priority;
    const n = typeof v === "string" ? (/^\d$/.test(v) ? Number(v) : PRIORITY_WORDS[v.toLowerCase()]) : v;
    if (typeof n !== "number" || !(n in PRIORITY_LABEL)) throw new AgentError("priority must be none, low, medium or high.");
    p.priority = n as Priority;
  }
  if ("list" in args) p.list = str(args, "list", true).trim();
  if ("date" in args) p.planned = planned(args.date);
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
    if (!Array.isArray(v) || names.some((n) => !n || /^#|\s/.test(n))) throw new AgentError("tags must be a list of single-word names.");
    // "work" and "Work" are one tag.
    p.tags = names.filter((n, i) => names.findIndex((m) => m.toLowerCase() === n.toLowerCase()) === i);
  }
  if (Object.keys(p).length === 0) throw new AgentError("Nothing to update: give at least one field.");
  return p;
}

export function parseRequest(op: unknown, raw: unknown): AgentRequest {
  if (raw !== undefined && raw !== null && (typeof raw !== "object" || Array.isArray(raw))) throw new AgentError("args must be an object.");
  const args = (raw ?? {}) as Args;
  switch (op) {
    case "list":
      only(args, ["view", "limit"]);
      return { op, view: str(args, "view")?.trim() || "today", limit: limitOf(args) };
    case "search":
      only(args, ["text", "limit"]);
      return { op, text: str(args, "text", true).trim(), limit: limitOf(args) };
    case "get":
    case "complete":
    case "reopen":
      only(args, ["id"]);
      return { op, id: str(args, "id", true).trim() };
    case "add":
      only(args, ["text", "list", "parentId"]);
      return { op, text: str(args, "text", true), list: str(args, "list")?.trim() || null, parentId: str(args, "parentId")?.trim() || null };
    case "update": {
      const scope = args.scope ?? "this";
      if (scope !== "this" && scope !== "following" && scope !== "all") throw new AgentError('scope must be "this", "following" or "all".');
      return { op, id: str(args, "id", true).trim(), patch: parsePatch(args), scope };
    }
    case "delete": {
      only(args, ["id", "withSubtasks"]);
      const w = args.withSubtasks ?? false;
      if (typeof w !== "boolean") throw new AgentError("withSubtasks must be true or false.");
      return { op, id: str(args, "id", true).trim(), withSubtasks: w };
    }
    case "restore":
      only(args, ["id"]);
      return { op, id: str(args, "id", true).trim() };
    case "trash":
      only(args, ["limit"]);
      return { op, limit: limitOf(args) };
    case "habits":
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
