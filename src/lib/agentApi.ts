/*
 * The main window's side of the localhost agent API (ADR 0007, D264). The Rust server forwards each
 * authenticated request as an `agent:request` event; this runs it through the same store actions as the
 * UI (never SQL) and answers with `agent_reply`. Main window only: it is the one writer (D33).
 */
import { AgentError, agentTask, applyPlanned, parseRequest, type AgentRequest, type AgentTask, type TaskPatch } from "../domain/agentOps";
import { addDaysLocal, atLocalTime, daysBetween, durationMinutes, hhmm, scheduleDate, timed, todayLocal } from "../domain/dates";
import { calendarItems } from "../domain/calendar";
import { elapsedMs } from "../domain/focus";
import { matchesFilter, nameKey, parseFilter } from "../domain/filter";
import { currentStreak, goalLabel, isBuild, isDone, isDueToday, isWeeklyTotal, periodValue, targetOf } from "../domain/habits";
import { effective, nextOccurrence } from "../domain/recurrence";
import { derive, inSmartList, matchScore, sortVMs, type TaskVM } from "../domain/taskViews";
import { INBOX_ID, MAX_SUBTASK_DEPTH, SMART_LISTS, type LocalDate, type SmartListId, type Task, type WeekStart } from "../domain/types";
import { deleteOccurrence, deleteTasks, depthOf, editOccurrence, ensureTags, mayEdit, restoreTasks, setParent, setStatus, uid, updateTask, useData } from "../stores/data";
import type { Habit } from "../domain/habits";
import { useFocus } from "../stores/focus";
import { setCheckin, useHabits, valuesOf } from "../stores/habits";
import { createFromText, listByName } from "../stores/quickAddSubmit";
import { useSettings } from "../stores/settings";
import { toast } from "../stores/toast";

const today = () => todayLocal();

function view() {
  const { tasks, lists, tags } = useData.getState();
  const d = derive(tasks, lists);
  const shape = (vm: TaskVM): AgentTask => agentTask(vm.task, vm.schedule, { lists, tags, subtasks: d.childrenOf(vm.task.id).length });
  return { d, lists, shape };
}

/** An id or a unique prefix of one (the CLI prints short ids). */
function find(id: string): TaskVM {
  const { d } = view();
  const hit = d.byId.get(id);
  if (hit) return hit;
  const matches = id.length >= 4 ? d.vms.filter((v) => v.task.id.startsWith(id)) : [];
  if (matches.length === 1) return matches[0];
  throw new AgentError(matches.length ? `Several tasks start with ${id}; use more of the id.` : missing(id));
}

/** Why an id isn't in any view: the row may exist but be trashed or a spent series (AGENT-01/03). */
function missing(id: string): string {
  const hits = Object.values(useData.getState().tasks).filter((t) => t.id === id || (id.length >= 4 && t.id.startsWith(id)));
  if (hits.length !== 1) return `No task with id ${id}.`;
  const t = hits[0];
  if (t.deletedAt) return `“${t.title}” is in the Trash; restore_task brings it back.`;
  if (t.recurrence) return `“${t.title}” is a repeating series with no occurrences left.`;
  return `“${t.title}” exists but isn't shown in any view.`;
}

const sortedList = (vms: TaskVM[], limit: number) => {
  const sorted = sortVMs(vms, "date");
  return { total: sorted.length, vms: sorted.slice(0, limit) };
};

function list(view_: string, limit: number, includeArchived: boolean) {
  const { d, lists, shape } = view();
  const pool = includeArchived ? d.vms : d.active;
  const key = view_.toLowerCase();
  let vms: TaskVM[];
  if ((SMART_LISTS as readonly string[]).includes(key)) vms = pool.filter((v) => inSmartList(key as SmartListId, v, today()));
  else {
    const named = Object.values(lists).find((l) => nameKey(l.name) === nameKey(view_));
    if (named) vms = pool.filter((v) => v.task.status === "open" && v.task.listId === named.id);
    else {
      // Anything else is a filter in quick-add grammar: `#tag !high ~list overdue`.
      const f = parseFilter(view_, new Date(), Object.values(lists).map((l) => l.name), useSettings.getState().settings.weekStart);
      const ctx = { today: today(), lists, tags: useData.getState().tags };
      vms = pool.filter((v) => matchesFilter(v, f, ctx) && (f.status !== null || v.task.status === "open"));
    }
  }
  const { total, vms: page } = sortedList(vms, limit);
  return { view: view_, total, tasks: page.map(shape) };
}

function search(text: string, limit: number, status: "open" | "done" | "all", includeArchived: boolean) {
  const { d, shape } = view();
  const scored = (includeArchived ? d.vms : d.active).flatMap((v) => {
    if (status !== "all" && (status === "open") !== (v.task.status === "open")) return [];
    const s = matchScore(v.task.title, text) ?? (matchScore(v.task.description, text) === null ? null : 9);
    return s === null ? [] : [{ v, s }];
  });
  scored.sort((a, b) => a.s - b.s || Number(b.v.task.status === "open") - Number(a.v.task.status === "open"));
  return { total: scored.length, tasks: scored.slice(0, limit).map((x) => shape(x.v)) };
}

function add(r: Extract<AgentRequest, { op: "add" }>) {
  const { lists } = view();
  const defaults: Partial<Task> = {};
  if (r.parentId) {
    const parent = find(r.parentId);
    if (depthOf(parent.task.id) + 1 > MAX_SUBTASK_DEPTH) throw new AgentError(`Subtasks can only nest ${MAX_SUBTASK_DEPTH} levels deep.`);
    defaults.parentId = parent.task.id;
    defaults.listId = parent.task.listId;
  } else if (r.list) {
    const l = listByName(r.list);
    if (!l) throw new AgentError(`No list named “${r.list}”. Lists: ${Object.values(lists).map((x) => x.name).join(", ")}.`);
    defaults.listId = l.id;
  }
  const notes: string[] = [];
  const t = createFromText(r.text, defaults, true, () => false, "typed", (name, to) => notes.push(`No list named “${name}”; added to ${to}.`));
  if (!t) throw new AgentError(r.text.trim() ? "This list is shared with you as view-only." : "Nothing to add.");
  // Read it back with a fresh view: a tag created by this add isn't in the one from before it.
  if (r.fields) {
    const made = view().d.byId.get(t.id);
    if (made) updateTask(t.id, patchOf(made, r.fields));
  }
  const { d, shape } = view();
  const vm = d.byId.get(t.id);
  if (!vm) throw new AgentError("The task was added but could not be read back.");
  return { task: shape(vm), ...(notes.length ? { note: notes.join(" ") } : {}) };
}

/** The store patch for an agent's field changes to `vm`. A series is edited through its current occurrence, not its anchor (AGENT-02). */
function patchOf(vm: TaskVM, p: TaskPatch): Partial<Task> {
  const { lists } = view();
  const patch: Partial<Task> = {};
  if (p.title !== undefined) patch.title = p.title;
  if (p.description !== undefined) patch.description = p.description;
  if (p.priority !== undefined) patch.priority = p.priority;
  if (p.deadline !== undefined) patch.deadline = p.deadline;
  if (p.pinned !== undefined) patch.pinned = p.pinned;
  if (p.list !== undefined) {
    const l = Object.values(lists).find((x) => nameKey(x.name) === nameKey(p.list ?? ""));
    if (!l) throw new AgentError(`No list named “${p.list}”. Lists: ${Object.values(lists).map((x) => x.name).join(", ")}.`);
    patch.listId = l.id;
  }
  if (p.tags !== undefined) patch.tags = ensureTags(p.tags);
  const current = vm.task.recurrence ? vm.schedule : vm.task.schedule;
  let schedule = current;
  if (p.planned !== undefined) schedule = applyPlanned(schedule, p.planned);
  if (p.time !== undefined) {
    // A time needs a day: the planned one, else today. Keeps the block's length, else the estimate, else an hour.
    const day = scheduleDate(schedule) ?? today();
    const minutes = p.durationMin ?? (schedule.kind === "timed" ? durationMinutes(schedule) : vm.task.durationMin) ?? 60;
    schedule = timed(atLocalTime(day, p.time), minutes);
  } else if (p.durationMin !== undefined) {
    // A time block's length is its end minus its start; otherwise it is an estimate.
    if (schedule.kind === "timed" && p.durationMin !== null) schedule = timed(new Date(schedule.start), p.durationMin);
    else if (schedule.kind === "timed") throw new AgentError("A time block's length can't be cleared; move the task off its time first.");
    else patch.durationMin = p.durationMin;
  }
  if (schedule !== current) patch.schedule = schedule;
  const kind = (patch.schedule ?? current).kind;
  if (p.repeat) {
    if (kind !== "day" && kind !== "timed") throw new AgentError("A repeating task needs a planned day: give date (and time) too.");
    patch.recurrence = { rule: p.repeat, exdates: [], tz: null };
    // An already-spent rule would make the task vanish from every view, so refuse it before anything changes.
    if (!nextOccurrence({ schedule: patch.schedule ?? current, recurrence: patch.recurrence })) throw new AgentError("That repeat rule has no occurrence from the task's start (its UNTIL or COUNT is already used up).");
  } else if (p.repeat === null) patch.recurrence = null;
  if (p.reminders !== undefined) {
    // A reminder must fit the task: minutes before a time block, or a time on some day before a day task.
    const bad = p.reminders.find((r) => (r.kind === "before" ? kind !== "timed" : kind !== "day"));
    if (bad) throw new AgentError(bad.kind === "before" ? "{minutes} reminders need a time block: give time too." : "{daysBefore, time} reminders need a planned day without a time.");
    patch.reminders = p.reminders;
  }
  if (p.checklist !== undefined) {
    const old = new Map(vm.task.checklist.map((i) => [i.title, i.done]));
    patch.checklist = p.checklist.map((title) => ({ id: uid(), title, done: old.get(title) ?? false }));
  }
  return patch;
}

function update(r: Extract<AgentRequest, { op: "update" }>) {
  const vm = find(r.id);
  const patch = patchOf(vm, r.patch);
  const key = vm.task.recurrence ? effective(vm.task)?.key : null;
  if (key && r.scope === "this" && patch.recurrence !== undefined) throw new AgentError('Changing how a task repeats needs scope "all" (or "following").');
  // Moving first: if the store refuses (loop, too deep), nothing else has changed. The store also puts it in the parent's list.
  if (r.patch.parentId !== undefined) moveUnder(vm.task, r.patch.parentId, patch);
  const before = taskIds();
  // A recurring task changes only this occurrence unless the caller says following or all.
  if (key) editOccurrence(vm.task.id, key, r.scope, patch);
  else updateTask(vm.task.id, patch);
  return get(newTaskId(before) ?? vm.task.id);
}

function moveUnder(task: Task, parentId: string | null, patch: Partial<Task>) {
  const parent = parentId === null ? null : find(parentId).task;
  if (parent?.id === task.parentId || (!parent && !task.parentId)) return;
  if (!setParent(task.id, parent?.id ?? null)) throw new AgentError(`Can't move “${task.title}” under “${parent?.title}”: that would be a loop, or nest deeper than ${MAX_SUBTASK_DEPTH} levels.`);
  if (parent) delete patch.listId; // a subtask stays in its parent's list
}

const taskIds = () => new Set(Object.keys(useData.getState().tasks));
/** The task a store action just created (a detached occurrence), if any. */
const newTaskId = (before: Set<string>) => Object.keys(useData.getState().tasks).find((id) => !before.has(id));

function get(id: string) {
  const vm = find(id);
  const { d, shape } = view();
  const fresh = d.byId.get(vm.task.id) ?? vm;
  return { task: shape(fresh), subtasks: d.childrenOf(fresh.task.id).map(shape) };
}

function finish(id: string, to: "done" | "open", scope: "this" | "all" = "this") {
  const vm = find(id);
  if (to === "done" && vm.task.status !== "open") throw new AgentError(`“${vm.task.title}” is already ${vm.task.status === "done" ? "done" : "closed"}.`);
  if (to === "open" && vm.task.status === "open") throw new AgentError(`“${vm.task.title}” is already open.`);
  const before = taskIds();
  setStatus(vm.task.id, to);
  // scope all: the series ends with this occurrence (setStatus only detaches it, and only ends a series that ran out).
  const series = scope === "all" && vm.task.recurrence ? useData.getState().tasks[vm.task.id] : undefined;
  if (series && !series.deletedAt) updateTask(series.id, { status: "done", completedAt: new Date().toISOString() });
  // Completing a recurring task detaches the finished occurrence; the series may be gone (its last one).
  return get(newTaskId(before) ?? vm.task.id);
}

/** Delete takes the full id: a prefix is fine for reading but too easy to get wrong when removing. */
function remove(r: Extract<AgentRequest, { op: "delete" }>) {
  const vm = find(r.id);
  if (vm.task.id !== r.id) throw new AgentError("Deleting needs the task's full id (from get_task or list_tasks), not a shortened one.");
  const { d, shape } = view();
  // A repeating task is shown as its current occurrence: by default only that one goes (AGENT-04).
  const key = vm.task.recurrence && r.scope !== "all" ? effective(vm.task)?.key : null;
  if (key) {
    const occurrence = shape(vm);
    deleteOccurrence(vm.task.id, key, r.scope);
    const what = r.scope === "this" ? "that occurrence" : "that occurrence and the ones after it";
    return { deleted: occurrence, subtasks: [], note: `Removed ${what} of a repeating task; earlier ones stay. Pass scope: "all" to move the whole series to the Trash.` };
  }
  const subs = liveDescendants(vm.task.id).flatMap((t) => (d.byId.get(t.id) ? [shape(d.byId.get(t.id) as TaskVM)] : []));
  if (subs.length && !r.withSubtasks) throw new AgentError(`“${vm.task.title}” has ${subs.length} subtask${subs.length === 1 ? "" : "s"}. Pass withSubtasks: true to delete them too.`);
  const removed = shape(vm);
  deleteTasks([vm.task.id]);
  return { deleted: removed, subtasks: subs, note: "Moved to the Trash; restore_task brings it back." };
}

function lists() {
  const all = Object.values(useData.getState().lists).sort((a, b) => a.sortOrder - b.sortOrder);
  const rows = all.map((l) => ({ name: l.name, archived: l.archived }));
  return { lists: all.some((l) => l.id === INBOX_ID) ? rows : [{ name: "Inbox", archived: false }, ...rows] };
}

function tags() {
  return { tags: Object.values(useData.getState().tags).map((t) => ({ name: t.name })).sort((a, b) => a.name.localeCompare(b.name)) };
}

function liveDescendants(id: string): Task[] {
  const all = Object.values(useData.getState().tasks).filter((t) => !t.deletedAt);
  const out: Task[] = [];
  const walk = (pid: string) => all.filter((t) => t.parentId === pid).forEach((c) => (out.push(c), walk(c.id)));
  walk(id);
  return out;
}

const trashed = () => Object.values(useData.getState().tasks).filter((t) => t.deletedAt).sort((a, b) => (b.deletedAt ?? "").localeCompare(a.deletedAt ?? ""));

function trash(limit: number) {
  const { lists, tags } = useData.getState();
  const all = trashed();
  const shape = (t: Task) => ({ ...agentTask(t, t.schedule, { lists, tags, subtasks: all.filter((k) => k.parentId === t.id).length }), deletedAt: t.deletedAt });
  return { total: all.length, tasks: all.slice(0, limit).map(shape) };
}

function restore(id: string) {
  const all = trashed();
  const exact = all.find((t) => t.id === id);
  const prefixed = exact ? [exact] : id.length >= 4 ? all.filter((t) => t.id.startsWith(id)) : [];
  if (prefixed.length !== 1) throw new AgentError(prefixed.length ? `Several trashed tasks start with ${id}; use more of the id.` : `No task in the Trash with id ${id}.`);
  const t = prefixed[0];
  // Subtasks deleted together with it (same moment) come back with it.
  const family = [t.id];
  const walk = (pid: string) => all.filter((k) => k.parentId === pid && k.deletedAt === t.deletedAt).forEach((k) => (family.push(k.id), walk(k.id)));
  walk(t.id);
  restoreTasks(family);
  return get(t.id);
}

function habitRow(h: Habit, date: LocalDate, ws: WeekStart) {
  const values = valuesOf(useHabits.getState().checkins[h.id]);
  // A weekly goal is measured over the week, not just today.
  const value = periodValue(h, values, date, ws);
  const streak = currentStreak(h, values, date, ws);
  return {
    id: h.id, name: h.name, kind: h.goal.kind, goal: goalLabel(h.goal), dueToday: isDueToday(h, values, date, ws),
    period: isWeeklyTotal(h) ? "week" : "day", value, target: targetOf(h), done: isBuild(h) ? isDone(h, value) : null, streak: `${streak.count} ${streak.unit}${streak.count === 1 ? "" : "s"}`,
  };
}

function habits() {
  const ws = useSettings.getState().settings.weekStart;
  const date = today();
  const rows = Object.values(useHabits.getState().habits)
    .filter((h) => !h.archived)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((h) => habitRow(h, date, ws));
  return { date, habits: rows };
}

/** Adds to (or, with a negative delta, undoes) a habit's check-in for a day; `value` sets it outright. */
function checkin(r: Extract<AgentRequest, { op: "checkin" }>) {
  const all = Object.values(useHabits.getState().habits).filter((h) => !h.archived);
  const key = r.habit.toLowerCase();
  const hits = all.filter((h) => h.id === key || h.name.toLowerCase() === key);
  const found = hits.length ? hits : key.length >= 4 ? all.filter((h) => h.id.startsWith(key)) : [];
  if (found.length !== 1) throw new AgentError(found.length ? `Several habits match ${r.habit}; use the id.` : `No habit “${r.habit}”. Habits: ${all.map((h) => h.name).join(", ") || "none"}.`);
  const h = found[0];
  const date = r.date ?? today();
  if (date > today()) throw new AgentError("Can't check in a future day.");
  const before = valuesOf(useHabits.getState().checkins[h.id]).get(date) ?? 0;
  const next = r.value ?? before + (r.delta ?? 1);
  setCheckin(h.id, date, { value: h.goal.kind === "once" ? Math.min(1, Math.max(0, next)) : Math.max(0, next) });
  return { date, habit: habitRow(h, date, useSettings.getState().settings.weekStart), checkin: valuesOf(useHabits.getState().checkins[h.id]).get(date) ?? 0 };
}

/** Calendar events (not tasks) from a day to a day, default the next week. */
function events(r: Extract<AgentRequest, { op: "events" }>) {
  const from = r.from ?? today();
  const to = r.to ?? addDaysLocal(from, 6);
  if (to < from) throw new AgentError("to is before from."); // the parser only sees this when both are given
  if (daysBetween(from, to) > 366) throw new AgentError("Ask for at most a year of events at a time.");
  const items = calendarItems({ tasks: [], events: Object.values(useData.getState().events), colorOf: () => "", showCompleted: false }, from, to)
    .filter((i) => i.source === "event")
    .sort((a, b) => a.startDate.localeCompare(b.startDate) || (a.start?.getTime() ?? 0) - (b.start?.getTime() ?? 0));
  const rows = items.slice(0, r.limit).map((i) => ({
    id: i.id, title: i.title, date: i.startDate, endDate: i.endDate, allDay: i.allDay,
    start: i.start ? hhmm(i.start) : null, end: i.end ? hhmm(i.end) : null, repeats: i.recurring, readOnly: i.readOnly,
  }));
  return { from, to, total: items.length, events: rows };
}

function focus() {
  const t = useFocus.getState().timer;
  if (t.status === "idle" || t.status === "done") return { status: t.status, task: null };
  const task = t.taskId ? useData.getState().tasks[t.taskId] : undefined;
  return { status: t.status, mode: t.mode, phase: t.phase, round: t.round, task: task ? { id: task.id, title: task.title } : null, elapsedMin: Math.floor(elapsedMs(t, Date.now()) / 60000) };
}

/** Counts every change to the data an agent can see, so a client can tell the app changed between two of its calls (AGENT-21). */
let revision = 0;
useData.subscribe(() => void revision++);
useHabits.subscribe(() => void revision++);
export const agentRevision = () => revision;

/** The lists a write would change: where the task is now and where it is going (a list name, or a parent's list). Reads touch none. */
function targetLists(r: AgentRequest): string[] {
  const named = (n: string | null | undefined) => (n ? [listByName(n)?.id ?? ""] : []); // an unknown name fails later with its own message
  switch (r.op) {
    case "add": return r.parentId ? [find(r.parentId).task.listId] : r.list ? named(r.list) : [INBOX_ID];
    case "update": return [find(r.id).task.listId, ...named(r.patch.list), ...(r.patch.parentId ? [find(r.patch.parentId).task.listId] : [])];
    case "delete": case "complete": case "reopen": return [find(r.id).task.listId];
    case "restore": return trashed().filter((t) => t.id === r.id || (r.id.length >= 4 && t.id.startsWith(r.id))).map((t) => t.listId);
    default: return [];
  }
}

/** Runs one request. Throws `AgentError` for anything the caller got wrong. */
export function runAgentRequest(op: unknown, args: unknown): unknown {
  if (!useData.getState().ready) throw new AgentError("Momentum is still loading; try again in a moment.");
  const r = parseRequest(op, args);
  // The store silently drops writes to view-only lists, so refuse them here instead of reporting a success that changed nothing.
  if (targetLists(r).some((id) => id && !mayEdit(id))) throw new AgentError("This list is shared with you as view-only.");
  switch (r.op) {
    case "list": return list(r.view, r.limit, r.includeArchived);
    case "search": return search(r.text, r.limit, r.status, r.includeArchived);
    case "lists": return lists();
    case "tags": return tags();
    case "get": return get(r.id);
    case "add": return add(r);
    case "update": return update(r);
    case "delete": return remove(r);
    case "restore": return restore(r.id);
    case "trash": return trash(r.limit);
    case "complete": return finish(r.id, "done", r.scope);
    case "reopen": return finish(r.id, "open");
    case "habits": return habits();
    case "checkin": return checkin(r);
    case "events": return events(r);
    case "focus": return focus();
  }
}

type Request = { id: string; op: unknown; args: unknown; nonce?: unknown };
let unlisten: (() => void) | null = null;

/**
 * The reply (JSON) to one `agent:request`, or null to ignore it. Popups can emit events too, so a request only counts
 * if it carries the nonce Rust gave this window in `agent_ready`: only the Rust server knows it (D33).
 */
export function answerAgentRequest(p: Request, nonce: string | null): string | null {
  if (!nonce || p.nonce !== nonce) return null;
  let reply: { ok: true; data: unknown; revision: number } | { ok: false; error: string };
  try {
    reply = { ok: true, data: runAgentRequest(p.op, p.args), revision };
  } catch (err) {
    if (!(err instanceof AgentError)) console.error("Agent request failed", err);
    reply = { ok: false, error: err instanceof AgentError ? err.message : "Something went wrong inside Momentum." };
  }
  return JSON.stringify(reply);
}

/** Starts answering agent requests (desktop main window only). */
export async function initAgentApi() {
  const [{ listen }, { invoke }] = await Promise.all([import("@tauri-apps/api/event"), import("@tauri-apps/api/core")]);
  unlisten?.(); // a second init (dev hot reload) must not answer every request twice
  let nonce: string | null = null;
  unlisten = await listen<Request>("agent:request", (e) => {
    const result = answerAgentRequest(e.payload, nonce);
    if (result !== null) void invoke("agent_reply", { id: e.payload.id, result });
  });
  // Until now requests are answered "starting" instead of waiting for a listener that isn't there.
  // The server's own start-up failure (it can't say so before the window exists) shows once here (AGENT-07).
  const ready = await invoke<{ failed: string | null; nonce: string } | null>("agent_ready");
  nonce = ready?.nonce ?? null;
  const failed = ready?.failed;
  if (failed) toast(`The AI agent API couldn't start, so the momentum command won't reach this app: ${failed}`);
}

