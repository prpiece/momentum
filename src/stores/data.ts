import { create } from "zustand";
import * as repo from "../db/repo";
import { after, before, reorder as reorderItems } from "../domain/order";
import { detachOccurrence, effective, scheduleForKey, shiftAnchor, splitSeries } from "../domain/recurrence";
import {
  INBOX_ID,
  MAX_SUBTASK_DEPTH,
  PRIORITY_LABEL,
  type ActivityKind,
  type Folder,
  type Section,
  type Tag,
  type Task,
  type TaskList,
  type TaskStatus,
} from "../domain/types";

export type Scope = "this" | "following" | "all";

type ById<T> = Record<string, T>;
type State = {
  ready: boolean;
  tasks: ById<Task>;
  lists: ById<TaskList>;
  folders: ById<Folder>;
  sections: ById<Section>;
  tags: ById<Tag>;
};

export const uid = () => crypto.randomUUID();
const now = () => new Date().toISOString();
const byId = <T extends { id: string }>(xs: T[]): ById<T> => Object.fromEntries(xs.map((x) => [x.id, x]));

const INBOX: TaskList = {
  id: INBOX_ID,
  name: "Inbox",
  color: null,
  emoji: null,
  folderId: null,
  pinned: false,
  archived: false,
  tint: false,
  layout: "list",
  sortOrder: -1,
};

export type NewTask = Partial<Omit<Task, "id" | "createdAt" | "updatedAt">> & { title: string };

export const useData = create<State>(() => ({ ready: false, tasks: {}, lists: {}, folders: {}, sections: {}, tags: {} }));
const get = useData.getState;
const set = useData.setState;

// ---------- internals ----------

/** Put tasks in the store and persist them. The single write path for tasks. */
function commit(changed: Task[]) {
  if (!changed.length) return;
  set((s) => ({ tasks: { ...s.tasks, ...byId(changed) } }));
  void repo.saveTasks(changed);
}

function log(taskId: string, kind: ActivityKind, detail = "") {
  void repo.logActivity(taskId, kind, detail);
}

const live = () => Object.values(get().tasks).filter((t) => !t.deletedAt);
const childrenOf = (id: string) => live().filter((t) => t.parentId === id);

function descendants(id: string): Task[] {
  const out: Task[] = [];
  const walk = (pid: string) =>
    childrenOf(pid).forEach((c) => {
      out.push(c);
      walk(c.id);
    });
  walk(id);
  return out;
}

export function depthOf(id: string | null): number {
  let d = 0;
  for (let t = id ? get().tasks[id] : undefined; t?.parentId; t = get().tasks[t.parentId]) d++;
  return id ? d + 1 : 0;
}

const siblings = (listId: string, parentId: string | null) =>
  live().filter((t) => t.listId === listId && t.parentId === parentId);

// ---------- hydrate ----------

export async function hydrate() {
  const ws = await repo.loadWorkspace();
  const lists = byId(ws.lists);
  lists[INBOX_ID] ??= INBOX;
  set({
    ready: true,
    tasks: byId(ws.tasks),
    lists,
    folders: byId(ws.folders),
    sections: byId(ws.sections),
    tags: byId(ws.tags),
  });
}

/** Replace the whole store (used by the dev seed in browser mode and by JSON import). */
export function replaceAll(ws: repo.Workspace) {
  const lists = byId(ws.lists);
  lists[INBOX_ID] ??= INBOX;
  set({ ready: true, tasks: byId(ws.tasks), lists, folders: byId(ws.folders), sections: byId(ws.sections), tags: byId(ws.tags) });
}

// ---------- tasks ----------

export function addTask(input: NewTask, position: "top" | "bottom" = "top"): Task {
  const listId = input.listId ?? INBOX_ID;
  const parentId = input.parentId ?? null;
  const sib = siblings(listId, parentId);
  const t: Task = {
    description: "",
    sectionId: null,
    status: "open",
    priority: 0,
    schedule: { kind: "none" },
    recurrence: null,
    recurrenceParentId: null,
    tags: [],
    checklist: [],
    reminders: [],
    pinned: false,
    completedAt: null,
    deletedAt: null,
    ...input,
    listId,
    parentId,
    sortOrder: input.sortOrder ?? (position === "top" ? before(sib) : after(sib)),
    id: uid(),
    createdAt: now(),
    updatedAt: now(),
  };
  if (t.schedule.kind === "none") t.recurrence = null;
  commit([t]);
  log(t.id, "created");
  return t;
}

export function updateTask(id: string, patch: Partial<Task>) {
  const t = get().tasks[id];
  if (!t) return;
  const next: Task = { ...t, ...patch, updatedAt: now() };
  if (next.schedule.kind === "none") next.recurrence = null;
  const changed = [next];
  if (patch.listId && patch.listId !== t.listId) {
    log(id, "moved", get().lists[patch.listId]?.name ?? "");
    // Subtasks travel with their parent; a moved subtask leaves its parent behind.
    if (t.parentId && get().tasks[t.parentId]?.listId !== patch.listId) next.parentId = null;
    next.sectionId = patch.sectionId ?? null;
    for (const d of descendants(id)) changed.push({ ...d, listId: patch.listId, sectionId: null, updatedAt: now() });
  }
  if (patch.title !== undefined && patch.title !== t.title) log(id, "renamed", patch.title);
  if (patch.priority !== undefined && patch.priority !== t.priority) log(id, "priority", PRIORITY_LABEL[patch.priority]);
  if (patch.schedule && JSON.stringify(patch.schedule) !== JSON.stringify(t.schedule)) log(id, "scheduled");
  commit(changed);
}

/**
 * Complete / reopen / won't-do. For a recurring task this handles the current (or given)
 * occurrence: it is detached as its own finished task and the series moves on.
 */
export function setStatus(id: string, status: TaskStatus, occurrenceKey?: string | null) {
  const t = get().tasks[id];
  if (!t) return;
  const finished = status !== "open";
  const kind: ActivityKind = status === "done" ? "completed" : status === "wont_do" ? "wont_do" : "reopened";
  if (t.recurrence && finished) {
    const key = occurrenceKey ?? effective(t)?.key;
    if (!key) return;
    const { series, single } = detachOccurrence(t, key, uid(), now());
    const done: Task = { ...single, status, completedAt: now() };
    const seriesNext = effective(series) ? series : { ...series, deletedAt: now() };
    commit([seriesNext, done]);
    log(done.id, kind);
    return;
  }
  commit([{ ...t, status, completedAt: finished ? now() : null, updatedAt: now() }]);
  log(id, kind);
}

/** Soft-delete tasks and their subtasks. Returns the affected ids for undo. */
export function deleteTasks(ids: string[]): string[] {
  const all = new Map<string, Task>();
  for (const id of ids) {
    const t = get().tasks[id];
    if (!t) continue;
    all.set(id, t);
    descendants(id).forEach((d) => all.set(d.id, d));
  }
  const at = now();
  commit([...all.values()].map((t) => ({ ...t, deletedAt: at })));
  return [...all.keys()];
}

export function restoreTasks(ids: string[]) {
  commit(ids.map((id) => get().tasks[id]).filter((t): t is Task => !!t).map((t) => ({ ...t, deletedAt: null })));
}

export function duplicateTask(id: string): Task | null {
  const t = get().tasks[id];
  if (!t) return null;
  const copy = (src: Task, parentId: string | null, title = src.title): Task => {
    const c = addTask({ ...src, parentId, title, status: "open", completedAt: null, sortOrder: src.sortOrder + 0.5 });
    childrenOf(src.id).forEach((k) => copy(k, c.id));
    return c;
  };
  return copy(t, t.parentId, `${t.title} (copy)`);
}

export function moveTasks(ids: string[], listId: string, sectionId: string | null = null) {
  for (const id of ids) updateTask(id, { listId, sectionId });
}

/** Drag reorder among siblings (already sorted for display). */
export function reorderTask(id: string, toIndex: number, siblingIds: string[]) {
  const items = siblingIds.map((sid) => get().tasks[sid]).filter((t): t is Task => !!t);
  commit(
    reorderItems(items, id, toIndex)
      .map((c) => {
        const t = get().tasks[c.id];
        return t && { ...t, sortOrder: c.sortOrder, updatedAt: now() };
      })
      .filter((t): t is Task => !!t),
  );
}

/** Make `id` a subtask of `parentId` (or top-level). Refuses cycles and the depth limit. */
export function setParent(id: string, parentId: string | null): boolean {
  const t = get().tasks[id];
  if (!t) return false;
  if (parentId) {
    const p = get().tasks[parentId];
    if (!p || parentId === id || descendants(id).some((d) => d.id === parentId)) return false;
    const subtreeHeight = Math.max(0, ...descendants(id).map((d) => depthOf(d.id) - depthOf(id)));
    if (depthOf(parentId) + 1 + subtreeHeight > MAX_SUBTASK_DEPTH) return false;
    updateTask(id, { parentId, listId: p.listId, sortOrder: after(childrenOf(parentId)) });
    return true;
  }
  updateTask(id, { parentId: null });
  return true;
}

// ---------- recurring scope edits ----------

/** Apply `patch` to one occurrence, this-and-following, or the whole series. */
export function editOccurrence(id: string, key: string, scope: Scope, patch: Partial<Task>) {
  const t = get().tasks[id];
  if (!t?.recurrence) return updateTask(id, patch);
  if (scope === "this") {
    const { series, single } = detachOccurrence(t, key, uid(), now());
    const { recurrence: _r, ...rest } = patch;
    commit([series, { ...single, ...rest }]);
    return;
  }
  if (scope === "following") {
    const { head, tail } = splitSeries(t, key, uid(), now());
    const tailNext: Task = { ...tail, ...patch };
    if (tailNext.schedule.kind === "none") tailNext.recurrence = null;
    commit(head ? [head, tailNext] : [{ ...tailNext, id: t.id }]);
    return;
  }
  const occ = scheduleForKey(t.schedule, key);
  const schedule = patch.schedule ? shiftAnchor(t.schedule, occ, patch.schedule) : t.schedule;
  updateTask(id, { ...patch, schedule });
}

export function deleteOccurrence(id: string, key: string, scope: Scope): string[] {
  const t = get().tasks[id];
  if (!t?.recurrence || scope === "all") return deleteTasks([id]);
  if (scope === "this") {
    commit([{ ...t, recurrence: { ...t.recurrence, exdates: [...t.recurrence.exdates, key] }, updatedAt: now() }]);
    return [];
  }
  const { head } = splitSeries(t, key, uid(), now());
  if (!head) return deleteTasks([id]);
  commit([head]);
  return [];
}

// ---------- lists, folders, sections, tags ----------

export function addList(name: string, folderId: string | null = null): TaskList {
  const l: TaskList = { ...INBOX, id: uid(), name, folderId, sortOrder: after(Object.values(get().lists)) };
  set((s) => ({ lists: { ...s.lists, [l.id]: l } }));
  void repo.saveList(l);
  return l;
}

export function updateList(id: string, patch: Partial<TaskList>) {
  const l = get().lists[id];
  if (!l) return;
  const next = { ...l, ...patch };
  set((s) => ({ lists: { ...s.lists, [id]: next } }));
  void repo.saveList(next);
}

/** Deletes the list and (via FK cascade) its tasks. */
export function removeList(id: string) {
  if (id === INBOX_ID) return;
  set((s) => {
    const { [id]: _gone, ...lists } = s.lists;
    const tasks = Object.fromEntries(Object.entries(s.tasks).filter(([, t]) => t.listId !== id));
    return { lists, tasks };
  });
  void repo.deleteList(id);
}

export function addFolder(name: string): Folder {
  const f: Folder = { id: uid(), name, sortOrder: after(Object.values(get().folders)), collapsed: false };
  set((s) => ({ folders: { ...s.folders, [f.id]: f } }));
  void repo.saveFolder(f);
  return f;
}

export function updateFolder(id: string, patch: Partial<Folder>) {
  const f = get().folders[id];
  if (!f) return;
  const next = { ...f, ...patch };
  set((s) => ({ folders: { ...s.folders, [id]: next } }));
  void repo.saveFolder(next);
}

/** Lists inside move to the top level (FK ON DELETE SET NULL does the same on disk). */
export function removeFolder(id: string) {
  set((s) => {
    const { [id]: _gone, ...folders } = s.folders;
    const lists = Object.fromEntries(
      Object.entries(s.lists).map(([k, l]) => [k, l.folderId === id ? { ...l, folderId: null } : l]),
    );
    return { folders, lists };
  });
  void repo.deleteFolder(id);
}

export function addSection(listId: string, name: string): Section {
  const sec: Section = {
    id: uid(),
    listId,
    name,
    sortOrder: after(Object.values(get().sections).filter((x) => x.listId === listId)),
  };
  set((s) => ({ sections: { ...s.sections, [sec.id]: sec } }));
  void repo.saveSection(sec);
  return sec;
}

export function updateSection(id: string, patch: Partial<Section>) {
  const sec = get().sections[id];
  if (!sec) return;
  const next = { ...sec, ...patch };
  set((s) => ({ sections: { ...s.sections, [id]: next } }));
  void repo.saveSection(next);
}

export function removeSection(id: string) {
  set((s) => {
    const { [id]: _gone, ...sections } = s.sections;
    const tasks = Object.fromEntries(
      Object.entries(s.tasks).map(([k, t]) => [k, t.sectionId === id ? { ...t, sectionId: null } : t]),
    );
    return { sections, tasks };
  });
  void repo.deleteSection(id);
}

/** Resolve tag names (case-insensitive) to ids, creating missing tags. */
export function ensureTags(names: string[]): string[] {
  const existing = Object.values(get().tags);
  return names.map((name) => {
    const hit = existing.find((t) => t.name.toLowerCase() === name.toLowerCase());
    if (hit) return hit.id;
    const tag: Tag = { id: uid(), name, color: null };
    existing.push(tag);
    set((s) => ({ tags: { ...s.tags, [tag.id]: tag } }));
    void repo.saveTag(tag);
    return tag.id;
  });
}

export function updateTag(id: string, patch: Partial<Tag>) {
  const t = get().tags[id];
  if (!t) return;
  const next = { ...t, ...patch };
  set((s) => ({ tags: { ...s.tags, [id]: next } }));
  void repo.saveTag(next);
}

export function removeTag(id: string) {
  commit(live().filter((t) => t.tags.includes(id)).map((t) => ({ ...t, tags: t.tags.filter((x) => x !== id) })));
  set((s) => {
    const { [id]: _gone, ...tags } = s.tags;
    return { tags };
  });
  void repo.deleteTag(id);
}

// ---------- undo ----------

/**
 * Run `fn` and return a function that reverts exactly the tasks it touched
 * (restoring old versions, soft-deleting tasks it created). Covers delete, bulk edits,
 * recurring completion: anything that goes through `commit`.
 */
export function undoable(fn: () => void): () => void {
  const before = get().tasks;
  fn();
  const afterFn = get().tasks;
  const touched = Object.keys(afterFn).filter((id) => afterFn[id] !== before[id]);
  return () => {
    const at = now();
    commit(touched.map((id) => before[id] ?? { ...afterFn[id], deletedAt: at }));
  };
}
