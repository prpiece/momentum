/*
 * JSON backup format: one entry per database table, holding exactly the DB rows. Import reuses
 * the same row parsers as loading from SQLite (one boundary, one set of rules), then repairs
 * dangling references so foreign keys can't fail halfway through a restore. Pure; unit-tested.
 */
import type { Countdown } from "../domain/countdown";
import type { FocusSession } from "../domain/focus";
import type { Habit, HabitCheckin, HabitGroup } from "../domain/habits";
import { isRecord, parseSettings } from "../domain/settings";
import { INBOX_ID, type Activity, type CalendarEvent, type Folder, type Section, type Settings, type Tag, type Task, type TaskList } from "../domain/types";
import { parseCheckin, parseGroup, parseHabit } from "./habitRows";
import { parseActivity, parseAll, parseEvent, parseFolder, parseList, parseSection, parseTag, parseTask, type Row } from "./rows";
import { parseCountdown, parseSession } from "./miscRows";

export const BACKUP_FORMAT = 1;

/** Parents before children: the order rows must be inserted in. */
export const BACKUP_TABLES = [
  "settings",
  "folders",
  "lists",
  "sections",
  "tags",
  "tasks",
  "task_activity",
  "calendar_events",
  "habit_groups",
  "habits",
  "habit_checkins",
  "countdowns",
  "focus_sessions",
] as const;
export type BackupTable = (typeof BACKUP_TABLES)[number];

export type BackupFile = { app: "Momentum"; format: number; schemaVersion: number; exportedAt: string; tables: Record<BackupTable, Row[]> };

export type Restored = {
  settings: Settings | null;
  folders: Folder[];
  lists: TaskList[];
  sections: Section[];
  tags: Tag[];
  tasks: Task[];
  activity: Activity[];
  events: CalendarEvent[];
  groups: HabitGroup[];
  habits: Habit[];
  checkins: HabitCheckin[];
  countdowns: Countdown[];
  sessions: FocusSession[];
};

export type Validation = { ok: true; data: Restored; dropped: number } | { ok: false; error: string };

const rowsOf = (tables: Record<string, unknown>, name: BackupTable): Row[] => {
  const v = tables[name];
  return Array.isArray(v) ? v.filter(isRecord) : [];
};

export function validateBackup(raw: unknown): Validation {
  if (!isRecord(raw) || raw.app !== "Momentum") return { ok: false, error: "This isn't a Momentum backup file." };
  if (typeof raw.format !== "number" || raw.format > BACKUP_FORMAT) return { ok: false, error: "This backup was made by a newer version of Momentum." };
  if (!isRecord(raw.tables)) return { ok: false, error: "The backup has no data." };
  const t = raw.tables;
  let total = 0;
  const parse = <T,>(name: BackupTable, fn: (r: Row) => T | null): T[] => {
    const rows = rowsOf(t, name);
    total += rows.length;
    return parseAll(rows, fn);
  };

  const settingsRow = rowsOf(t, "settings")[0];
  let settings: Settings | null = null;
  if (settingsRow && typeof settingsRow.value === "string") {
    try {
      settings = parseSettings(JSON.parse(settingsRow.value));
    } catch {
      settings = null;
    }
  }
  if (settingsRow) total++;

  const data: Restored = {
    settings,
    folders: parse("folders", parseFolder),
    lists: parse("lists", parseList),
    sections: parse("sections", parseSection),
    tags: parse("tags", parseTag),
    tasks: parse("tasks", parseTask),
    activity: parse("task_activity", parseActivity),
    events: parse("calendar_events", parseEvent),
    groups: parse("habit_groups", parseGroup),
    habits: parse("habits", parseHabit),
    checkins: parse("habit_checkins", parseCheckin),
    countdowns: parse("countdowns", parseCountdown),
    sessions: parse("focus_sessions", parseSession),
  };
  const repaired = repairReferences(data);
  const count = (r: Restored) => (r.settings ? 1 : 0) + [r.folders, r.lists, r.sections, r.tags, r.tasks, r.activity, r.events, r.groups, r.habits, r.checkins, r.countdowns, r.sessions].reduce((n, a) => n + a.length, 0);
  // Rows lost to validation or orphan cleanup (a re-created Inbox isn't counted as kept).
  const inboxAdded = repaired.lists.length - data.lists.length;
  return { ok: true, data: repaired, dropped: total - (count(repaired) - inboxAdded) };
}

/** Point every reference at something that exists (or clear it), so inserts never violate FKs. */
export function repairReferences(d: Restored): Restored {
  const lists = d.lists.some((l) => l.id === INBOX_ID)
    ? d.lists
    : [{ id: INBOX_ID, name: "Inbox", color: null, icon: null, folderId: null, pinned: false, archived: false, tint: false, layout: "list" as const, sortOrder: -1 }, ...d.lists];
  const folderIds = new Set(d.folders.map((f) => f.id));
  const listIds = new Set(lists.map((l) => l.id));
  const sections = d.sections.filter((s) => listIds.has(s.listId));
  const sectionIds = new Set(sections.map((s) => s.id));
  const taskIds = new Set(d.tasks.map((t) => t.id));
  // A parent chain must stay acyclic: drop parents that lead back to the task itself.
  const parentOf = new Map(d.tasks.map((t) => [t.id, t.parentId]));
  const cyclic = (id: string) => {
    const seen = new Set<string>();
    for (let p = parentOf.get(id); p; p = parentOf.get(p) ?? null) {
      if (p === id || seen.has(p)) return true;
      seen.add(p);
    }
    return false;
  };
  const tasks = d.tasks.map((t) => ({
    ...t,
    listId: listIds.has(t.listId) ? t.listId : INBOX_ID,
    parentId: t.parentId && taskIds.has(t.parentId) && !cyclic(t.id) ? t.parentId : null,
    sectionId: t.sectionId && sectionIds.has(t.sectionId) ? t.sectionId : null,
    recurrenceParentId: t.recurrenceParentId && taskIds.has(t.recurrenceParentId) ? t.recurrenceParentId : null,
  }));
  const eventIds = new Set(d.events.map((e) => e.id));
  const groupIds = new Set(d.groups.map((g) => g.id));
  const habitIds = new Set(d.habits.map((h) => h.id));
  return {
    ...d,
    lists: lists.map((l) => ({ ...l, folderId: l.folderId && folderIds.has(l.folderId) ? l.folderId : null })),
    sections,
    tasks,
    activity: d.activity.filter((a) => taskIds.has(a.taskId)),
    events: d.events.map((e) => ({ ...e, recurrenceParentId: e.recurrenceParentId && eventIds.has(e.recurrenceParentId) ? e.recurrenceParentId : null })),
    habits: d.habits.map((h) => ({ ...h, groupId: h.groupId && groupIds.has(h.groupId) ? h.groupId : null })),
    checkins: d.checkins.filter((c) => habitIds.has(c.habitId)),
    sessions: d.sessions.map((s) => ({ ...s, taskId: s.taskId && taskIds.has(s.taskId) ? s.taskId : null })),
  };
}
