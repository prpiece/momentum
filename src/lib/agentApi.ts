/*
 * The main window's side of the localhost agent API (ADR 0007, D264). The Rust server forwards each
 * authenticated request as an `agent:request` event; this runs it through the same store actions as the
 * UI (never SQL) and answers with `agent_reply`. Main window only: it is the one writer (D33).
 */
import { AgentError, agentTask, applyPlanned, parseRequest, type AgentRequest, type AgentTask } from "../domain/agentOps";
import { timed, todayLocal } from "../domain/dates";
import { matchesFilter, nameKey, parseFilter } from "../domain/filter";
import { currentStreak, goalLabel, isBuild, isDone, isDueToday, isWeeklyTotal, periodValue, targetOf } from "../domain/habits";
import { effective } from "../domain/recurrence";
import { derive, inSmartList, matchScore, sortVMs, type TaskVM } from "../domain/taskViews";
import { INBOX_ID, MAX_SUBTASK_DEPTH, SMART_LISTS, type SmartListId, type Task } from "../domain/types";
import { deleteOccurrence, deleteTasks, depthOf, editOccurrence, ensureTags, restoreTasks, setStatus, updateTask, useData } from "../stores/data";
import { useHabits, valuesOf } from "../stores/habits";
import { createFromText, listByName } from "../stores/quickAddSubmit";
import { useSettings } from "../stores/settings";

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

function list(view_: string, limit: number) {
  const { d, lists, shape } = view();
  const key = view_.toLowerCase();
  let vms: TaskVM[];
  if ((SMART_LISTS as readonly string[]).includes(key)) vms = d.active.filter((v) => inSmartList(key as SmartListId, v, today()));
  else {
    const named = Object.values(lists).find((l) => nameKey(l.name) === nameKey(view_));
    if (named) vms = d.active.filter((v) => v.task.status === "open" && v.task.listId === named.id);
    else {
      // Anything else is a filter in quick-add grammar: `#tag !high ~list overdue`.
      const f = parseFilter(view_, new Date(), Object.values(lists).map((l) => l.name));
      const ctx = { today: today(), lists, tags: useData.getState().tags };
      vms = d.active.filter((v) => matchesFilter(v, f, ctx) && (f.status !== null || v.task.status === "open"));
    }
  }
  const { total, vms: page } = sortedList(vms, limit);
  return { view: view_, total, tasks: page.map(shape) };
}

function search(text: string, limit: number, status: "open" | "done" | "all") {
  const { d, shape } = view();
  const scored = d.active.flatMap((v) => {
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
  if (!t) throw new AgentError("Nothing to add.");
  // Read it back with a fresh view: a tag created by this add isn't in the one from before it.
  const { d, shape } = view();
  const vm = d.byId.get(t.id);
  if (!vm) throw new AgentError("The task was added but could not be read back.");
  return { task: shape(vm), ...(notes.length ? { note: notes.join(" ") } : {}) };
}

function update(r: Extract<AgentRequest, { op: "update" }>) {
  const vm = find(r.id);
  const { lists } = view();
  const p = r.patch;
  const patch: Partial<Task> = {};
  if (p.title !== undefined) patch.title = p.title;
  if (p.description !== undefined) patch.description = p.description;
  if (p.priority !== undefined) patch.priority = p.priority;
  if (p.deadline !== undefined) patch.deadline = p.deadline;
  if (p.list !== undefined) {
    const l = Object.values(lists).find((x) => nameKey(x.name) === nameKey(p.list ?? ""));
    if (!l) throw new AgentError(`No list named “${p.list}”. Lists: ${Object.values(lists).map((x) => x.name).join(", ")}.`);
    patch.listId = l.id;
  }
  if (p.tags !== undefined) patch.tags = ensureTags(p.tags);
  // A series is edited through its current occurrence, not its anchor (AGENT-02).
  const current = vm.task.recurrence ? vm.schedule : vm.task.schedule;
  let schedule = current;
  if (p.planned !== undefined) schedule = applyPlanned(schedule, p.planned);
  if (p.durationMin !== undefined) {
    // A time block's length is its end minus its start; otherwise it is an estimate.
    if (schedule.kind === "timed" && p.durationMin !== null) schedule = timed(new Date(schedule.start), p.durationMin);
    else if (schedule.kind === "timed") throw new AgentError("A time block's length can't be cleared; move the task off its time first.");
    else patch.durationMin = p.durationMin;
  }
  if (schedule !== current) patch.schedule = schedule;
  const before = taskIds();
  const key = vm.task.recurrence ? effective(vm.task)?.key : null;
  // A recurring task changes only this occurrence unless the caller says following or all.
  if (key) editOccurrence(vm.task.id, key, r.scope, patch);
  else updateTask(vm.task.id, patch);
  return get(newTaskId(before) ?? vm.task.id);
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

function finish(id: string, to: "done" | "open") {
  const vm = find(id);
  if (to === "done" && vm.task.status !== "open") throw new AgentError(`“${vm.task.title}” is already ${vm.task.status === "done" ? "done" : "closed"}.`);
  if (to === "open" && vm.task.status === "open") throw new AgentError(`“${vm.task.title}” is already open.`);
  const before = taskIds();
  setStatus(vm.task.id, to);
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

function habits() {
  const { habits: hs, checkins } = useHabits.getState();
  const ws = useSettings.getState().settings.weekStart;
  const date = today();
  const rows = Object.values(hs)
    .filter((h) => !h.archived)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((h) => {
      const values = valuesOf(checkins[h.id]);
      // A weekly goal is measured over the week, not just today.
      const value = periodValue(h, values, date, ws);
      const streak = currentStreak(h, values, date, ws);
      return {
        id: h.id, name: h.name, kind: h.goal.kind, goal: goalLabel(h.goal), dueToday: isDueToday(h, values, date, ws),
        period: isWeeklyTotal(h) ? "week" : "day", value, target: targetOf(h), done: isBuild(h) ? isDone(h, value) : null, streak: `${streak.count} ${streak.unit}${streak.count === 1 ? "" : "s"}`,
      };
    });
  return { date, habits: rows };
}

/** Runs one request. Throws `AgentError` for anything the caller got wrong. */
export function runAgentRequest(op: unknown, args: unknown): unknown {
  if (!useData.getState().ready) throw new AgentError("Momentum is still loading; try again in a moment.");
  const r = parseRequest(op, args);
  switch (r.op) {
    case "list": return list(r.view, r.limit);
    case "search": return search(r.text, r.limit, r.status);
    case "lists": return lists();
    case "tags": return tags();
    case "get": return get(r.id);
    case "add": return add(r);
    case "update": return update(r);
    case "delete": return remove(r);
    case "restore": return restore(r.id);
    case "trash": return trash(r.limit);
    case "complete": return finish(r.id, "done");
    case "reopen": return finish(r.id, "open");
    case "habits": return habits();
  }
}

type Request = { id: string; op: unknown; args: unknown };
let unlisten: (() => void) | null = null;

/** Starts answering agent requests (desktop main window only). */
export async function initAgentApi() {
  const [{ listen }, { invoke }] = await Promise.all([import("@tauri-apps/api/event"), import("@tauri-apps/api/core")]);
  unlisten?.(); // a second init (dev hot reload) must not answer every request twice
  unlisten = await listen<Request>("agent:request", (e) => {
    let reply: { ok: true; data: unknown } | { ok: false; error: string };
    try {
      reply = { ok: true, data: runAgentRequest(e.payload.op, e.payload.args) };
    } catch (err) {
      if (!(err instanceof AgentError)) console.error("Agent request failed", err);
      reply = { ok: false, error: err instanceof AgentError ? err.message : "Something went wrong inside Momentum." };
    }
    void invoke("agent_reply", { id: e.payload.id, result: JSON.stringify(reply) });
  });
  // Until now requests are answered "starting" instead of waiting for a listener that isn't there.
  await invoke("agent_ready");
}

