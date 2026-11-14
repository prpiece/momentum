/*
 * The main window's side of the localhost agent API (ADR 0007, D264). The Rust server forwards each
 * authenticated request as an `agent:request` event; this runs it through the same store actions as the
 * UI (never SQL) and answers with `agent_reply`. Main window only: it is the one writer (D33).
 */
import { AgentError, agentTask, applyPlanned, parseRequest, type AgentRequest, type AgentTask } from "../domain/agentOps";
import { timed, todayLocal } from "../domain/dates";
import { matchesFilter, nameKey, parseFilter } from "../domain/filter";
import { currentStreak, goalLabel, isBuild, isDone, isDueToday, targetOf } from "../domain/habits";
import { derive, inSmartList, matchScore, sortVMs, type TaskVM } from "../domain/taskViews";
import { SMART_LISTS, type SmartListId, type Task } from "../domain/types";
import { ensureTags, setStatus, updateTask, useData } from "../stores/data";
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
  throw new AgentError(matches.length ? `Several tasks start with ${id}; use more of the id.` : `No task with id ${id}.`);
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
      const f = parseFilter(view_, new Date());
      const ctx = { today: today(), lists, tags: useData.getState().tags };
      vms = d.active.filter((v) => matchesFilter(v, f, ctx) && (f.status !== null || v.task.status === "open"));
    }
  }
  const { total, vms: page } = sortedList(vms, limit);
  return { view: view_, total, tasks: page.map(shape) };
}

function search(text: string, limit: number) {
  const { d, shape } = view();
  const scored = d.active.flatMap((v) => {
    const s = matchScore(v.task.title, text) ?? (matchScore(v.task.description, text) === null ? null : 9);
    return s === null ? [] : [{ v, s }];
  });
  scored.sort((a, b) => a.s - b.s || Number(b.v.task.status === "open") - Number(a.v.task.status === "open"));
  return { total: scored.length, tasks: scored.slice(0, limit).map((x) => shape(x.v)) };
}

function add(r: Extract<AgentRequest, { op: "add" }>) {
  const { lists, shape, d } = view();
  const defaults: Partial<Task> = {};
  if (r.parentId) {
    const parent = find(r.parentId);
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
  const vm = derive(useData.getState().tasks, lists).byId.get(t.id) ?? d.byId.get(t.id);
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
  let schedule = vm.task.schedule;
  if (p.planned !== undefined) schedule = applyPlanned(schedule, p.planned);
  if (p.durationMin !== undefined) {
    // A time block's length is its end minus its start; otherwise it is an estimate.
    if (schedule.kind === "timed" && p.durationMin !== null) schedule = timed(new Date(schedule.start), p.durationMin);
    else if (schedule.kind === "timed") throw new AgentError("A time block's length can't be cleared; move the task off its time first.");
    else patch.durationMin = p.durationMin;
  }
  if (schedule !== vm.task.schedule) patch.schedule = schedule;
  updateTask(vm.task.id, patch);
  return get(vm.task.id);
}

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
  setStatus(vm.task.id, to);
  return get(vm.task.id);
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
      const value = values.get(date) ?? 0;
      const streak = currentStreak(h, values, date, ws);
      return {
        id: h.id, name: h.name, kind: h.goal.kind, goal: goalLabel(h.goal), dueToday: isDueToday(h, values, date, ws),
        value, target: targetOf(h), done: isBuild(h) ? isDone(h, value) : null, streak: `${streak.count} ${streak.unit}${streak.count === 1 ? "" : "s"}`,
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
    case "search": return search(r.text, r.limit);
    case "get": return get(r.id);
    case "add": return add(r);
    case "update": return update(r);
    case "complete": return finish(r.id, "done");
    case "reopen": return finish(r.id, "open");
    case "habits": return habits();
  }
}

type Request = { id: string; op: unknown; args: unknown };

/** Starts answering agent requests (desktop main window only). */
export async function initAgentApi() {
  const [{ listen }, { invoke }] = await Promise.all([import("@tauri-apps/api/event"), import("@tauri-apps/api/core")]);
  await listen<Request>("agent:request", (e) => {
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

