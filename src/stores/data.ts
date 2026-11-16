import { create } from "zustand";
import { onWriteError } from "../db/client";
import * as repo from "../db/repo";
import { canAddChild, canNest, childFolders } from "../domain/folders";
import { after, before, reorder as reorderItems } from "../domain/order";
import { detachOccurrence, effective, shiftSeries, splitSeries } from "../domain/recurrence";
import { scheduleDate } from "../domain/dates";
import { waitLoops } from "../domain/waiting";
import { toast } from "./toast";
import {
  INBOX_ID,
  type CalendarEvent,
  type Schedule,
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
  events: ById<CalendarEvent>;
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
  icon: null,
  folderId: null,
  pinned: false,
  archived: false,
  tint: false,
  layout: "list",
  sortOrder: -1,
};

export type NewTask = Partial<Omit<Task, "id" | "createdAt" | "updatedAt">> & { title: string };

export const useData = create<State>(() => ({ ready: false, tasks: {}, events: {}, lists: {}, folders: {}, sections: {}, tags: {} }));
const get = useData.getState;
const set = useData.setState;

// ---------- internals ----------

/** Whether the user may change a list (view-only shares say no). Plugged in by stores/social.ts; sync writes bypass it. */
let canEditList: (listId: string) => boolean = () => true;
export const setEditGuard = (fn: (listId: string) => boolean) => void (canEditList = fn);
const viewOnlyToast = () => toast("This list is shared with you as view-only.");
/** For UI paths that create (a new section) rather than change a row: true, or says why not. */
export function mayEdit(listId: string): boolean {
  if (!canEditList(listId)) viewOnlyToast();
  return canEditList(listId);
}

/** Put tasks in the store and persist them. The single write path for tasks; it refuses view-only lists (H11). */
function commit(all: Task[]) {
  const changed = all.filter((t) => canEditList(t.listId) && canEditList(get().tasks[t.id]?.listId ?? t.listId));
  if (changed.length < all.length) viewOnlyToast();
  if (!changed.length) return;
  set((s) => ({ tasks: { ...s.tasks, ...byId(changed) } }));
  void repo.saveTasks(changed);
}

export function commitEvents(changed: CalendarEvent[]) {
  if (!changed.length) return;
  set((s) => ({ events: { ...s.events, ...byId(changed) } }));
  void repo.saveEvents(changed);
}

function log(taskId: string, kind: ActivityKind, detail = "") {
  if (get().tasks[taskId]?.deletedAt) return; // a trashed task's history would only sync as an orphan
  void repo.logActivity(taskId, kind, detail);
}

const live = () => Object.values(get().tasks).filter((t) => !t.deletedAt);
const childrenOf = (id: string) => live().filter((t) => t.parentId === id);

function descendants(id: string): Task[] {
  const out: Task[] = [];
  const seen = new Set([id]); // a parent cycle (bad sync data) must not loop
  const walk = (pid: string) =>
    childrenOf(pid).forEach((c) => {
      if (seen.has(c.id)) return;
      seen.add(c.id);
      out.push(c);
      walk(c.id);
    });
  walk(id);
  return out;
}

export function depthOf(id: string | null): number {
  let d = 0;
  const seen = new Set<string>();
  for (let t = id ? get().tasks[id] : undefined; t?.parentId && !seen.has(t.id); t = get().tasks[t.parentId]) {
    seen.add(t.id);
    d++;
  }
  return id ? d + 1 : 0;
}

/** Whether `id` may sit under `parentId`: it exists and is live, no cycle, within MAX_SUBTASK_DEPTH. The one guard for every parent change (DATA-05). */
function canParent(id: string, parentId: string): boolean {
  const p = get().tasks[parentId];
  if (!p || p.deletedAt || parentId === id) return false;
  const seen = new Set<string>();
  for (let a: Task | undefined = p; a; a = a.parentId ? get().tasks[a.parentId] : undefined) {
    if (a.id === id) return false;
    if (seen.has(a.id)) break;
    seen.add(a.id);
  }
  const height = Math.max(0, ...descendants(id).map((d) => depthOf(d.id) - depthOf(id)));
  return depthOf(parentId) + 1 + height <= MAX_SUBTASK_DEPTH;
}

/**
 * HAB-19 / D330: setting a parent to waiting or someday copies that state onto its open subtasks, as part of the same
 * commit (one undo step). Each subtask stays editable on its own. Clearing it on the parent clears only the subtasks that
 * still carry the identical value. Nothing here runs when a subtask itself is edited.
 */
function inheritedByOpenSubtasks(was: Task, now: Task): Task[] {
  const wait = (w: Task["waiting"]) => JSON.stringify(w);
  const waitChanged = wait(was.waiting) !== wait(now.waiting);
  const somedayWas = was.schedule.kind === "someday";
  const somedayNow = now.schedule.kind === "someday";
  if (!waitChanged && somedayWas === somedayNow) return [];
  const all = get().tasks;
  const blocker = now.waiting?.kind === "task" ? now.waiting.taskId : null;
  const related = (id: string) => {
    // The blocker, its ancestors and its descendants can't wait on it (a task never waits on itself or its own descendant).
    for (let a = blocker ? all[blocker] : undefined, n = 0; a && n < 50; a = a.parentId ? all[a.parentId] : undefined, n++) if (a.id === id) return true;
    for (let a: Task | undefined = all[id], n = 0; a && n < 50; a = a.parentId ? all[a.parentId] : undefined, n++) if (a.id === blocker) return true;
    return false;
  };
  const out: Task[] = [];
  for (const d of descendants(was.id)) {
    if (d.status !== "open") continue;
    let next = d;
    if (waitChanged) {
      if (now.waiting && !related(d.id) && !waitLoops(d.id, now.waiting, all)) next = { ...next, waiting: now.waiting };
      else if (!now.waiting && wait(d.waiting) === wait(was.waiting)) next = { ...next, waiting: null };
    }
    if (somedayNow && !somedayWas) next = { ...next, schedule: { kind: "someday" }, recurrence: null };
    else if (somedayWas && !somedayNow && next.schedule.kind === "someday") next = { ...next, schedule: { kind: "none" } };
    if (next !== d) out.push({ ...next, updatedAt: now.updatedAt });
  }
  return out;
}

const siblings = (listId: string, parentId: string | null) =>
  live().filter((t) => t.listId === listId && t.parentId === parentId);

// ---------- hydrate ----------

/** Rows edited while the load was reading keep their store version: the read can't have seen those edits (SYNC-14). */
const keepEdited = <T,>(loaded: ById<T>, then: ById<T>, now: ById<T>): ById<T> => {
  for (const id of Object.keys(now)) if (now[id] !== then[id]) loaded[id] = now[id];
  return loaded;
};

export async function hydrate(purge = true) {
  reloadOnWriteError();
  const [tasksThen, eventsThen] = [get().tasks, get().events];
  const ws = await repo.loadWorkspace(purge);
  const lists = byId(ws.lists);
  lists[INBOX_ID] ??= INBOX;
  set({
    ready: true,
    tasks: keepEdited(byId(ws.tasks), tasksThen, get().tasks),
    events: keepEdited(byId(ws.events), eventsThen, get().events),
    lists,
    folders: byId(ws.folders),
    sections: byId(ws.sections),
    tags: byId(ws.tags),
  });
}

// A write the database refused (UNIQUE, CHECK, disk full) must not leave the UI showing a state that will vanish at restart (DATA-11).
let reloading = false;
let listening = false; // registered by the first hydrate, which every app (and no mocked-client test) runs at startup
const reloadOnWriteError = () => {
  if (listening) return;
  listening = true;
  onWriteError(() => {
    if (reloading) return;
    reloading = true;
    void hydrate(false).finally(() => (reloading = false));
  });
};

/** Replace the whole store (used by the dev seed in browser mode and by JSON import). */
export function replaceAll(ws: repo.Workspace) {
  const lists = byId(ws.lists);
  lists[INBOX_ID] ??= INBOX;
  set({ ready: true, tasks: byId(ws.tasks), events: byId(ws.events), lists, folders: byId(ws.folders), sections: byId(ws.sections), tags: byId(ws.tags) });
}

// ---------- tasks ----------

export function addTask(input: NewTask, position: "top" | "bottom" = "top"): Task {
  const listId = input.listId ?? INBOX_ID;
  const parentId = input.parentId && canParent("", input.parentId) ? input.parentId : null;
  const sib = siblings(listId, parentId);
  const t: Task = {
    description: "",
    sectionId: null,
    status: "open",
    priority: 0,
    schedule: { kind: "none" },
    deadline: null,
    durationMin: null,
    waiting: null,
    recurrence: null,
    recurrenceParentId: null,
    // A subtask starts with its parent's tags (D267); later edits don't flow down.
    tags: parentId ? [...(get().tasks[parentId]?.tags ?? [])] : [],
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
  if (t.schedule.kind === "none" || t.schedule.kind === "someday") t.recurrence = null;
  if (parentId && input.tags) t.tags = [...new Set([...(get().tasks[parentId]?.tags ?? []), ...input.tags])];
  commit([t]);
  log(t.id, "created");
  return t;
}

export function updateTask(id: string, patch: Partial<Task>) {
  const t = get().tasks[id];
  if (!t) return;
  if (patch.parentId && patch.parentId !== t.parentId && !canParent(id, patch.parentId)) patch = { ...patch, parentId: t.parentId };
  const next: Task = { ...t, ...patch, updatedAt: now() };
  if (next.schedule.kind === "none" || next.schedule.kind === "someday") next.recurrence = null;
  if (patch.waiting !== undefined && waitLoops(id, patch.waiting, get().tasks)) next.waiting = t.waiting;
  const changed = [next];
  changed.push(...inheritedByOpenSubtasks(t, next));
  if (patch.listId && patch.listId !== t.listId) {
    log(id, "moved", get().lists[patch.listId]?.name ?? "");
    // Subtasks travel with their parent; a moved subtask leaves its parent behind.
    if (patch.parentId === undefined && t.parentId && get().tasks[t.parentId]?.listId !== patch.listId) next.parentId = null;
    next.sectionId = patch.sectionId ?? null;
    for (const d of descendants(id)) changed.push({ ...d, listId: patch.listId, sectionId: null, updatedAt: now() });
  }
  if (patch.title !== undefined && patch.title !== t.title) log(id, "renamed", patch.title);
  if (patch.priority !== undefined && patch.priority !== t.priority) log(id, "priority", PRIORITY_LABEL[patch.priority]);
  if (patch.schedule && JSON.stringify(patch.schedule) !== JSON.stringify(t.schedule)) {
    const from = scheduleDate(t.schedule);
    const to = scheduleDate(patch.schedule);
    log(id, "scheduled", from && to ? `${from} → ${to}` : "");
  }
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
  // Subtasks are part of their parent: finishing it finishes the open ones too (D58). Reopening doesn't reopen them.
  const kids = finished ? descendants(id).filter((d) => d.status === "open").map((d) => ({ ...d, status, completedAt: now(), updatedAt: now() })) : [];
  commit([{ ...t, status, completedAt: finished ? now() : null, updatedAt: now() }, ...kids]);
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

/** Restore tasks, and any trashed ancestors, so a restored subtask never hangs under a hidden parent. */
export function restoreTasks(ids: string[]) {
  const all = new Map<string, Task>();
  for (const id of ids) {
    for (let t: Task | undefined = get().tasks[id]; t && !all.has(t.id) && (t.id === id || t.deletedAt); t = t.parentId ? get().tasks[t.parentId] : undefined) all.set(t.id, t);
  }
  commit([...all.values()].map((t) => ({ ...t, deletedAt: null })));
}

/** Permanently drop trashed tasks (Trash: Delete forever), with their subtasks. */
export function purgeTasks(ids: string[]) {
  const gone = new Set<string>();
  const walk = (id: string) => {
    if (gone.has(id)) return;
    gone.add(id);
    Object.values(get().tasks).filter((t) => t.parentId === id).forEach((c) => walk(c.id));
  };
  ids.forEach(walk);
  set((s) => ({ tasks: Object.fromEntries(Object.entries(s.tasks).filter(([k]) => !gone.has(k))) }));
  void repo.purgeTasks([...gone]);
}

export function duplicateTask(id: string): Task | null {
  const t = get().tasks[id];
  if (!t) return null;
  const copy = (src: Task, parentId: string | null, sortOrder: number, title = src.title): Task => {
    const c = addTask({ ...src, parentId, title, status: "open", completedAt: null, sortOrder });
    childrenOf(src.id).forEach((k) => copy(k, c.id, k.sortOrder));
    return c;
  };
  // Just after the original: halfway to the next sibling, so repeated copies keep distinct orders (DATA-08).
  const next = siblings(t.listId, t.parentId).filter((x) => x.sortOrder > t.sortOrder).reduce((m, x) => Math.min(m, x.sortOrder), Infinity);
  return copy(t, t.parentId, Number.isFinite(next) ? (t.sortOrder + next) / 2 : t.sortOrder + 1, `${t.title} (copy)`);
}

export function moveTasks(ids: string[], listId: string, sectionId: string | null = null) {
  // A subtask whose ancestor is also moving travels with it; moving it on its own would detach it (UI-10).
  const picked = new Set(ids);
  const hasPickedAncestor = (id: string) => {
    for (let p = get().tasks[id]?.parentId, n = 0; p && n < 50; p = get().tasks[p]?.parentId, n++) if (picked.has(p)) return true;
    return false;
  };
  for (const id of ids) if (!hasPickedAncestor(id)) updateTask(id, { listId, sectionId });
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
    if (!canParent(id, parentId)) return false;
    const p = get().tasks[parentId];
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
    if (tailNext.schedule.kind === "none" || tailNext.schedule.kind === "someday") tailNext.recurrence = null;
    commit(head ? [head, tailNext] : [{ ...tailNext, id: t.id }]);
    return;
  }
  // Unscheduling the whole series ends it as a single undated task.
  if (patch.schedule?.kind === "none" || patch.schedule?.kind === "someday") return updateTask(id, { ...patch, recurrence: null });
  const base = { ...t, recurrence: patch.recurrence !== undefined ? patch.recurrence : t.recurrence };
  updateTask(id, { ...patch, ...(patch.schedule ? shiftSeries(base, key, patch.schedule) : {}) });
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

// ---------- calendar events ----------

export type NewEvent = Partial<Omit<CalendarEvent, "id" | "createdAt" | "updatedAt">> & { title: string; schedule: Schedule };

export function addEvent(input: NewEvent): CalendarEvent {
  const e: CalendarEvent = {
    notes: "",
    spanDays: 1,
    color: null,
    recurrence: null,
    recurrenceParentId: null,
    source: "local",
    subscriptionId: null,
    countdown: null,
    pinned: false,
    deletedAt: null,
    ...input,
    id: uid(),
    createdAt: now(),
    updatedAt: now(),
  };
  commitEvents([e]);
  return e;
}

export function updateEvent(id: string, patch: Partial<CalendarEvent>) {
  const e = get().events[id];
  if (e) commitEvents([{ ...e, ...patch, updatedAt: now() }]);
}

export function deleteEvents(ids: string[]) {
  const at = now();
  commitEvents(ids.map((id) => get().events[id]).filter((e): e is CalendarEvent => !!e).map((e) => ({ ...e, deletedAt: at })));
}

export function editEventOccurrence(id: string, key: string, scope: Scope, patch: Partial<CalendarEvent>) {
  const e = get().events[id];
  if (!e?.recurrence) return updateEvent(id, patch);
  if (scope === "this") {
    const { series, single } = detachOccurrence(e, key, uid(), now());
    return commitEvents([series, { ...single, ...patch, recurrence: null }]);
  }
  if (scope === "following") {
    const { head, tail } = splitSeries(e, key, uid(), now());
    return commitEvents(head ? [head, { ...tail, ...patch }] : [{ ...tail, ...patch, id: e.id }]);
  }
  const base = { ...e, recurrence: patch.recurrence !== undefined ? patch.recurrence : e.recurrence };
  updateEvent(id, { ...patch, ...(patch.schedule ? shiftSeries(base, key, patch.schedule) : {}) });
}

export function deleteEventOccurrence(id: string, key: string, scope: Scope) {
  const e = get().events[id];
  if (!e?.recurrence || scope === "all") return deleteEvents([id]);
  if (scope === "this") return commitEvents([{ ...e, recurrence: { ...e.recurrence, exdates: [...e.recurrence.exdates, key] }, updatedAt: now() }]);
  const { head } = splitSeries(e, key, uid(), now());
  if (head) commitEvents([head]);
  else deleteEvents([id]);
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
  if (!canEditList(id) && Object.keys(patch).some((k) => k !== "layout")) return viewOnlyToast(); // the view mode is a personal choice
  const next = { ...l, ...patch };
  set((s) => ({ lists: { ...s.lists, [id]: next } }));
  void repo.saveList(next);
}

/** Deletes the list and (via FK cascade) its tasks. */
export function removeList(id: string) {
  if (id === INBOX_ID) return;
  if (!canEditList(id)) return viewOnlyToast();
  set((s) => {
    const { [id]: _gone, ...lists } = s.lists;
    // parent_id cascades in the DB: a subtask in another list goes with its parent, and so do the list's sections.
    const gone = new Set(Object.values(s.tasks).filter((t) => t.listId === id).map((t) => t.id));
    for (let grew = true; grew; ) {
      grew = false;
      for (const t of Object.values(s.tasks)) if (t.parentId && gone.has(t.parentId) && !gone.has(t.id) && gone.add(t.id)) grew = true;
    }
    const tasks = Object.fromEntries(Object.entries(s.tasks).filter(([k]) => !gone.has(k)));
    const sections = Object.fromEntries(Object.entries(s.sections).filter(([, x]) => x.listId !== id));
    return { lists, tasks, sections };
  });
  void repo.deleteList(id);
}

/** A subfolder past the depth cap is refused (returns null). */
export function addFolder(name: string, parentId: string | null = null): Folder | null {
  if (parentId && !canAddChild(get().folders, parentId)) return null;
  const f: Folder = { id: uid(), name, parentId, sortOrder: after(childFolders(get().folders, parentId)), collapsed: false };
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

/** Re-parent a folder (with its subtree); refuses cycles and depth overflow. Returns whether it moved. */
export function moveFolder(id: string, parentId: string | null): boolean {
  const f = get().folders[id];
  if (!f || f.parentId === parentId || !canNest(get().folders, id, parentId)) return false;
  const next = { ...f, parentId, sortOrder: after(childFolders(get().folders, parentId)) };
  set((s) => ({ folders: { ...s.folders, [id]: next } }));
  void repo.saveFolder(next);
  return true;
}

/** Child lists and folders move up one level, into the deleted folder's parent. */
export function removeFolder(id: string) {
  const { folders: allFolders, lists: allLists } = get();
  const up = allFolders[id]?.parentId ?? null;
  const kids = childFolders(allFolders, id).map((c) => ({ ...c, parentId: up }));
  const lists = Object.values(allLists).filter((l) => l.folderId === id).map((l) => ({ ...l, folderId: up }));
  set((s) => {
    const { [id]: _gone, ...folders } = s.folders;
    return {
      folders: { ...folders, ...Object.fromEntries(kids.map((k) => [k.id, k])) },
      lists: { ...s.lists, ...Object.fromEntries(lists.map((l) => [l.id, l])) },
    };
  });
  // Rows move out before the delete so ON DELETE SET NULL never fires on them.
  kids.forEach((k) => void repo.saveFolder(k));
  lists.forEach((l) => void repo.saveList(l));
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
  if (!canEditList(sec.listId)) return viewOnlyToast();
  const next = { ...sec, ...patch };
  set((s) => ({ sections: { ...s.sections, [id]: next } }));
  void repo.saveSection(next);
}

/** Move a section to `toIndex` among its list's sections (one sortOrder write). */
export function moveSection(id: string, toIndex: number) {
  const sec = get().sections[id];
  if (!sec) return;
  const siblings = Object.values(get().sections).filter((x) => x.listId === sec.listId);
  for (const o of reorderItems(siblings, id, toIndex)) updateSection(o.id, { sortOrder: o.sortOrder });
}

export function removeSection(id: string) {
  const sec = get().sections[id];
  if (sec && !canEditList(sec.listId)) return viewOnlyToast();
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

/** Returns false (with a toast) when the new name is another tag's name, in any case: tags.name is UNIQUE NOCASE (DATA-02). */
export function updateTag(id: string, patch: Partial<Tag>): boolean {
  const t = get().tags[id];
  if (!t) return false;
  const name = patch.name?.toLowerCase();
  if (name !== undefined && Object.values(get().tags).some((o) => o.id !== id && o.name.toLowerCase() === name)) {
    toast(`A tag named “${patch.name}” already exists.`);
    return false;
  }
  const next = { ...t, ...patch };
  set((s) => ({ tags: { ...s.tags, [id]: next } }));
  void repo.saveTag(next);
  return true;
}

export function removeTag(id: string) {
  commit(Object.values(get().tasks).filter((t) => t.tags.includes(id)).map((t) => ({ ...t, tags: t.tags.filter((x) => x !== id) })));
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
  const before = { tasks: get().tasks, events: get().events };
  fn();
  const after = { tasks: get().tasks, events: get().events };
  const touched = <T,>(a: ById<T>, b: ById<T>) => Object.keys(b).filter((id) => b[id] !== a[id]);
  const tasks = touched(before.tasks, after.tasks);
  const events = touched(before.events, after.events);
  return () => {
    const at = now();
    commit(tasks.map((id) => before.tasks[id] ?? { ...after.tasks[id], deletedAt: at }));
    commitEvents(events.map((id) => before.events[id] ?? { ...after.events[id], deletedAt: at }));
  };
}
