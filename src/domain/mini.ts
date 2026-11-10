/*
 * The mini window's data contract (D80). The main window pushes a MiniSnapshot (`mini:state`);
 * the mini window sends MiniActions (`mini:action`). Both are validated where they arrive.
 */
import { elapsedMs, remainingMs, type FocusMode, type Phase, type PomodoroConfig, type TimerState } from "./focus";
import { QUADRANTS, quadrantOf, type MatrixRules } from "./matrix";
import { inSmartList, sortVMs, type TaskVM } from "./taskViews";
import type { LocalDate } from "./types";

export type MiniTask = { id: string; key: string | null; title: string };
export type MiniTimer =
  | { status: "idle" | "done" }
  | { status: "running" | "paused"; mode: FocusMode; phase: Phase; elapsedMs: number; remainingMs: number | null };
/** Every open task in the quadrant; the mini window scrolls them. */
export type MiniQuadrant = { count: number; top: MiniTask[] };
export type MiniSnapshot = {
  /** Wall-clock ms the timer values were taken at; the mini window ticks from there. */
  at: number;
  timer: MiniTimer;
  /** The focused task alone, or the top Today tasks. */
  tasks: MiniTask[];
  focusing: boolean;
  /** The focus length in minutes the next Start uses. */
  focusMin: number;
  /** Indexed by quadrant - 1. */
  matrix: MiniQuadrant[];
};
export type MiniAction =
  | { type: "toggle"; id: string; key: string | null }
  | { type: "open"; id: string; key: string | null }
  | { type: "focus"; op: "start"; mode: FocusMode; taskId: string | null; minutes: number }
  | { type: "focus"; op: "pause" | "resume" | "skip" };

export const MINI_TODAY_LIMIT = 5;
export const MINI_MIN_RANGE = { lo: 5, hi: 180 } as const;

/** One 5-minute step up or down, landing on a multiple of 5 and staying in range. */
export function stepMinutes(m: number, dir: 1 | -1): number {
  const n = dir > 0 ? (Math.floor(m / 5) + 1) * 5 : (Math.ceil(m / 5) - 1) * 5;
  return Math.min(MINI_MIN_RANGE.hi, Math.max(MINI_MIN_RANGE.lo, n));
}

const mini = (vm: TaskVM): MiniTask => ({ id: vm.task.id, key: vm.key, title: vm.task.title });

export function buildSnapshot(roots: readonly TaskVM[], byId: ReadonlyMap<string, TaskVM>, timer: TimerState, cfg: PomodoroConfig, rules: MatrixRules, today: LocalDate, now: number): MiniSnapshot {
  const open = roots.filter((v) => v.task.status === "open");
  const matrix: MiniQuadrant[] = QUADRANTS.map((q) => {
    const items = sortVMs(open.filter((v) => quadrantOf(v, today, rules) === q), "date");
    return { count: items.length, top: items.map(mini) };
  });
  const active = timer.status === "running" || timer.status === "paused";
  const focused = active && timer.taskId ? byId.get(timer.taskId) : undefined;
  const isFocusing = !!focused && focused.task.status === "open";
  // Chosen subtasks that are still open stand in for the task; once they're all done, the task shows.
  const steps = active ? timer.subIds.flatMap((id) => { const v = byId.get(id); return v && v.task.status === "open" ? [mini(v)] : []; }) : [];
  const tasks = isFocusing && focused ? (steps.length ? steps : [mini(focused)]) : sortVMs(open.filter((v) => inSmartList("today", v, today)), "date").slice(0, MINI_TODAY_LIMIT).map(mini);
  const t: MiniTimer = active
    ? { status: timer.status, mode: timer.mode, phase: timer.phase, elapsedMs: elapsedMs(timer, now), remainingMs: remainingMs(timer, now, cfg) }
    : { status: timer.status === "done" ? "done" : "idle" };
  return { at: now, timer: t, tasks, focusing: isFocusing, focusMin: cfg.focusMin, matrix };
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): v is string => typeof v === "string" && v.length > 0;
const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const keyOf = (v: unknown): string | null | undefined => (v === null || v === undefined ? null : typeof v === "string" ? v : undefined);

export function parseMiniAction(raw: unknown): MiniAction | null {
  if (!isObj(raw)) return null;
  if (raw.type === "toggle" || raw.type === "open") {
    const key = keyOf(raw.key);
    return str(raw.id) && key !== undefined ? { type: raw.type, id: raw.id, key } : null;
  }
  if (raw.type !== "focus") return null;
  if (raw.op === "start") {
    const { lo, hi } = MINI_MIN_RANGE;
    const { minutes, taskId } = raw;
    const mode = raw.mode === undefined ? "pomodoro" : raw.mode;
    if (mode !== "pomodoro" && mode !== "stopwatch") return null;
    if (!num(minutes) || !Number.isInteger(minutes) || minutes < lo || minutes > hi) return null;
    return taskId === null || str(taskId) ? { type: "focus", op: "start", mode, taskId, minutes } : null;
  }
  return raw.op === "pause" || raw.op === "resume" || raw.op === "skip" ? { type: "focus", op: raw.op } : null;
}

function parseTask(raw: unknown): MiniTask | null {
  if (!isObj(raw) || !str(raw.id) || typeof raw.title !== "string") return null;
  const key = keyOf(raw.key);
  return key === undefined ? null : { id: raw.id, key, title: raw.title };
}

function parseTasks(raw: unknown): MiniTask[] | null {
  if (!Array.isArray(raw)) return null;
  const out = raw.map(parseTask);
  return out.every((t): t is MiniTask => !!t) ? out : null;
}

function parseTimer(raw: unknown): MiniTimer | null {
  if (!isObj(raw)) return null;
  if (raw.status === "idle" || raw.status === "done") return { status: raw.status };
  if (raw.status !== "running" && raw.status !== "paused") return null;
  const { mode, phase } = raw;
  if ((mode !== "pomodoro" && mode !== "stopwatch") || (phase !== "focus" && phase !== "short" && phase !== "long")) return null;
  if (!num(raw.elapsedMs) || !(raw.remainingMs === null || num(raw.remainingMs))) return null;
  return { status: raw.status, mode, phase, elapsedMs: raw.elapsedMs, remainingMs: raw.remainingMs };
}

export function parseMiniSnapshot(raw: unknown): MiniSnapshot | null {
  if (!isObj(raw) || !num(raw.at) || !num(raw.focusMin) || typeof raw.focusing !== "boolean" || !Array.isArray(raw.matrix) || raw.matrix.length !== QUADRANTS.length) return null;
  const timer = parseTimer(raw.timer);
  const tasks = parseTasks(raw.tasks);
  const matrix = raw.matrix.map((q): MiniQuadrant | null => {
    const top = isObj(q) ? parseTasks(q.top) : null;
    return isObj(q) && num(q.count) && top ? { count: q.count, top } : null;
  });
  if (!timer || !tasks || !matrix.every((q): q is MiniQuadrant => !!q)) return null;
  return { at: raw.at, timer, tasks, focusing: raw.focusing, focusMin: raw.focusMin, matrix };
}

/** The clock the mini window shows `now`, given a snapshot taken at `snap.at`. */
export function miniClockMs(t: MiniTimer, at: number, now: number): number {
  if (t.status !== "running" && t.status !== "paused") return 0;
  const lapsed = t.status === "running" ? Math.max(0, now - at) : 0;
  return t.remainingMs === null ? t.elapsedMs + lapsed : Math.max(0, t.remainingMs - lapsed);
}
