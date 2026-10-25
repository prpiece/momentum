import type { Activity, ActivityKind, CalendarEvent, Folder, Section, Tag, Task, TaskList } from "../domain/types";
import { select, upsert, write } from "./client";
import {
  eventToRow,
  folderToRow,
  listToRow,
  parseActivity,
  parseAll,
  parseEvent,
  parseFolder,
  parseList,
  parseSection,
  parseTag,
  parseTask,
  sectionToRow,
  tagToRow,
  taskToRow,
  type Row,
} from "./rows";

export type Workspace = {
  tasks: Task[];
  events: CalendarEvent[];
  lists: TaskList[];
  folders: Folder[];
  sections: Section[];
  tags: Tag[];
};

export async function loadWorkspace(): Promise<Workspace> {
  // Soft-deleted rows only exist to make undo cheap within a session.
  await write(["DELETE FROM tasks WHERE deleted_at IS NOT NULL"], ["DELETE FROM calendar_events WHERE deleted_at IS NOT NULL"]);
  const [tasks, events, lists, folders, sections, tags] = await Promise.all(
    ["tasks", "calendar_events", "lists", "folders", "sections", "tags"].map((t) => select<Row>(`SELECT * FROM ${t}`)),
  );
  return {
    tasks: parseAll(tasks, parseTask),
    events: parseAll(events, parseEvent),
    lists: parseAll(lists, parseList),
    folders: parseAll(folders, parseFolder),
    sections: parseAll(sections, parseSection),
    tags: parseAll(tags, parseTag),
  };
}

export const saveTasks = (tasks: Task[]) => write(...tasks.map((t) => upsert("tasks", taskToRow(t))));
export const saveEvents = (events: CalendarEvent[]) => write(...events.map((e) => upsert("calendar_events", eventToRow(e))));
export const saveList = (l: TaskList) => write(upsert("lists", listToRow(l)));
export const saveFolder = (f: Folder) => write(upsert("folders", folderToRow(f)));
export const saveSection = (s: Section) => write(upsert("sections", sectionToRow(s)));
export const saveTag = (t: Tag) => write(upsert("tags", tagToRow(t)));

const del = (table: string) => (id: string) => write([`DELETE FROM ${table} WHERE id = $1`, [id]]);
export const deleteList = del("lists");
export const deleteFolder = del("folders");
export const deleteSection = del("sections");
export const deleteTag = del("tags");

export const logActivity = (taskId: string, kind: ActivityKind, detail = "") =>
  write([
    "INSERT INTO task_activity (task_id, at, kind, detail) VALUES ($1, $2, $3, $4)",
    [taskId, new Date().toISOString(), kind, detail],
  ]);

export async function loadActivity(taskId: string): Promise<Activity[]> {
  const rows = await select<Row>("SELECT * FROM task_activity WHERE task_id = $1 ORDER BY id DESC LIMIT 100", [taskId]);
  return parseAll(rows, parseActivity);
}

/** Upsert a whole workspace, parents before children so foreign keys hold. */
export function saveWorkspace(ws: Workspace) {
  const byId = new Map(ws.tasks.map((t) => [t.id, t]));
  // Bounded walk: a corrupt import with a parent cycle must not hang.
  const depth = (t: Task, n = 0): number => {
    const parent = t.parentId ? byId.get(t.parentId) : undefined;
    return parent && n < 50 ? depth(parent, n + 1) : n;
  };
  const tasks = [...ws.tasks].sort((a, b) => depth(a) - depth(b) || Number(!!a.recurrenceParentId) - Number(!!b.recurrenceParentId));
  return write(
    ...ws.folders.map((f) => upsert("folders", folderToRow(f))),
    ...ws.lists.map((l) => upsert("lists", listToRow(l))),
    ...ws.sections.map((s) => upsert("sections", sectionToRow(s))),
    ...ws.tags.map((t) => upsert("tags", tagToRow(t))),
    ...tasks.map((t) => upsert("tasks", taskToRow(t))),
    ...[...ws.events].sort((a, b) => Number(!!a.recurrenceParentId) - Number(!!b.recurrenceParentId)).map((e) => upsert("calendar_events", eventToRow(e))),
  );
}
