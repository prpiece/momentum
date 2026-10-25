/*
 * Row <-> domain mapping. This is the DB trust boundary: rows are validated field by field,
 * bad JSON or values degrade to safe defaults, and a row that can't be a Task is dropped.
 * Pure (no Tauri imports) so it is unit-tested.
 */
import { isInstant, isLocalDate } from "../domain/dates";
import { isValidRule } from "../domain/recurrence";
import { isRecord, oneOf } from "../domain/settings";
import {
  LIST_LAYOUTS,
  PRIORITIES,
  TASK_STATUSES,
  type Activity,
  type ActivityKind,
  type ChecklistItem,
  type Folder,
  type Reminder,
  type Schedule,
  type Section,
  type Tag,
  type Task,
  type TaskList,
} from "../domain/types";

export type Row = Record<string, unknown>;

const str = (v: unknown, fallback = "") => (typeof v === "string" ? v : fallback);
const optStr = (v: unknown) => (typeof v === "string" && v !== "" ? v : null);
const num = (v: unknown, fallback = 0) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
const bool = (v: unknown) => v === 1 || v === true;

function json(v: unknown): unknown {
  if (typeof v !== "string") return undefined;
  try {
    return JSON.parse(v);
  } catch {
    return undefined;
  }
}
const arr = (v: unknown): unknown[] => {
  const parsed = json(v);
  return Array.isArray(parsed) ? parsed : [];
};

function parseReminder(v: unknown): Reminder | null {
  if (!isRecord(v)) return null;
  if (v.kind === "before" && typeof v.minutes === "number" && v.minutes >= 0) return { kind: "before", minutes: v.minutes };
  if (v.kind === "dayOf" && typeof v.daysBefore === "number" && typeof v.time === "string" && /^\d{2}:\d{2}$/.test(v.time))
    return { kind: "dayOf", daysBefore: v.daysBefore, time: v.time };
  return null;
}

function parseChecklistItem(v: unknown): ChecklistItem | null {
  if (!isRecord(v) || typeof v.id !== "string" || typeof v.title !== "string") return null;
  return { id: v.id, title: v.title, done: v.done === true };
}

export function scheduleFromRow(r: Row): Schedule {
  if (isInstant(r.start_at) && isInstant(r.end_at)) return { kind: "timed", start: r.start_at, end: r.end_at };
  if (isLocalDate(r.due_date)) return { kind: "day", date: r.due_date };
  return { kind: "none" };
}

export function parseTask(r: Row): Task | null {
  if (typeof r.id !== "string" || typeof r.list_id !== "string") return null;
  const schedule = scheduleFromRow(r);
  const rule = optStr(r.rrule);
  const now = new Date().toISOString();
  return {
    id: r.id,
    title: str(r.title),
    description: str(r.description),
    listId: r.list_id,
    parentId: optStr(r.parent_id),
    sectionId: optStr(r.section_id),
    status: oneOf(TASK_STATUSES, r.status) ? r.status : "open",
    priority: oneOf(PRIORITIES, r.priority) ? r.priority : 0,
    schedule,
    recurrence:
      rule && schedule.kind !== "none" && isValidRule(rule)
        ? { rule, exdates: arr(r.exdates).filter((x): x is string => typeof x === "string") }
        : null,
    recurrenceParentId: optStr(r.recurrence_parent_id),
    tags: arr(r.tags).filter((x): x is string => typeof x === "string"),
    checklist: arr(r.checklist)
      .map(parseChecklistItem)
      .filter((x): x is ChecklistItem => x !== null),
    reminders: arr(r.reminders)
      .map(parseReminder)
      .filter((x): x is Reminder => x !== null),
    sortOrder: num(r.sort_order),
    pinned: bool(r.pinned),
    createdAt: isInstant(r.created_at) ? r.created_at : now,
    updatedAt: isInstant(r.updated_at) ? r.updated_at : now,
    completedAt: isInstant(r.completed_at) ? r.completed_at : null,
    deletedAt: isInstant(r.deleted_at) ? r.deleted_at : null,
  };
}

export function taskToRow(t: Task): Row {
  const s = t.schedule;
  return {
    id: t.id,
    title: t.title,
    description: t.description,
    list_id: t.listId,
    parent_id: t.parentId,
    section_id: t.sectionId,
    status: t.status,
    priority: t.priority,
    due_date: s.kind === "day" ? s.date : null,
    start_at: s.kind === "timed" ? s.start : null,
    end_at: s.kind === "timed" ? s.end : null,
    rrule: t.recurrence?.rule ?? null,
    exdates: JSON.stringify(t.recurrence?.exdates ?? []),
    recurrence_parent_id: t.recurrenceParentId,
    tags: JSON.stringify(t.tags),
    checklist: JSON.stringify(t.checklist),
    reminders: JSON.stringify(t.reminders),
    sort_order: t.sortOrder,
    pinned: t.pinned ? 1 : 0,
    created_at: t.createdAt,
    updated_at: t.updatedAt,
    completed_at: t.completedAt,
    deleted_at: t.deletedAt,
  };
}

export function parseList(r: Row): TaskList | null {
  if (typeof r.id !== "string") return null;
  return {
    id: r.id,
    name: str(r.name, "Untitled"),
    color: optStr(r.color),
    emoji: optStr(r.emoji),
    folderId: optStr(r.folder_id),
    pinned: bool(r.pinned),
    archived: bool(r.archived),
    tint: bool(r.tint),
    layout: oneOf(LIST_LAYOUTS, r.layout) ? r.layout : "list",
    sortOrder: num(r.sort_order),
  };
}

export const listToRow = (l: TaskList): Row => ({
  id: l.id,
  name: l.name,
  color: l.color,
  emoji: l.emoji,
  folder_id: l.folderId,
  pinned: l.pinned ? 1 : 0,
  archived: l.archived ? 1 : 0,
  tint: l.tint ? 1 : 0,
  layout: l.layout,
  sort_order: l.sortOrder,
});

export const parseFolder = (r: Row): Folder | null =>
  typeof r.id === "string"
    ? { id: r.id, name: str(r.name, "Folder"), sortOrder: num(r.sort_order), collapsed: bool(r.collapsed) }
    : null;
export const folderToRow = (f: Folder): Row => ({
  id: f.id,
  name: f.name,
  sort_order: f.sortOrder,
  collapsed: f.collapsed ? 1 : 0,
});

export const parseSection = (r: Row): Section | null =>
  typeof r.id === "string" && typeof r.list_id === "string"
    ? { id: r.id, listId: r.list_id, name: str(r.name, "Section"), sortOrder: num(r.sort_order) }
    : null;
export const sectionToRow = (s: Section): Row => ({ id: s.id, list_id: s.listId, name: s.name, sort_order: s.sortOrder });

export const parseTag = (r: Row): Tag | null =>
  typeof r.id === "string" && typeof r.name === "string" ? { id: r.id, name: r.name, color: optStr(r.color) } : null;
export const tagToRow = (t: Tag): Row => ({ id: t.id, name: t.name, color: t.color });

const ACTIVITY_KINDS: readonly ActivityKind[] = [
  "created",
  "completed",
  "reopened",
  "wont_do",
  "moved",
  "scheduled",
  "priority",
  "renamed",
];
export const parseActivity = (r: Row): Activity | null =>
  typeof r.id === "number" && typeof r.task_id === "string" && isInstant(r.at) && oneOf(ACTIVITY_KINDS, r.kind)
    ? { id: r.id, taskId: r.task_id, at: r.at, kind: r.kind, detail: str(r.detail) }
    : null;

export const parseAll = <T>(rows: Row[], parse: (r: Row) => T | null): T[] =>
  rows.map(parse).filter((x): x is T => x !== null);
