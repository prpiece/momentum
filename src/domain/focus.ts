/*
 * Focus timer as a pure state machine. Time is always derived from wall-clock timestamps
 * (never from counting ticks), so throttled background timers can't make it drift.
 */
import type { TaskVM } from "./taskViews";
import type { Cycles, Instant } from "./types";

export type FocusMode = "pomodoro" | "stopwatch";
export type Phase = "focus" | "short" | "long";
export type PomodoroConfig = { focusMin: number; shortMin: number; longMin: number; longEvery: number };
export const DEFAULT_POMODORO: PomodoroConfig = { focusMin: 25, shortMin: 5, longMin: 15, longEvery: 4 };

type Common = { mode: FocusMode; phase: Phase; taskId: string | null; /** Chosen subtasks of `taskId` (empty = the whole task). */ subIds: string[]; round: number; accumulatedMs: number; sessionStart: number; cycles: Cycles; focusMs: number };
export type Active = (Common & { status: "running"; runStart: number }) | (Common & { status: "paused" });
/** `done`: a finite pomodoro session ran all its cycles (D75). */
export type TimerState = { status: "idle" } | Active | { status: "done"; taskId: string | null; cycles: number; focusMs: number };

export type FocusSession = {
  id: string;
  taskId: string | null;
  mode: FocusMode;
  startAt: Instant;
  endAt: Instant;
  /** Time actually focused (pauses excluded). */
  seconds: number;
};

export const phaseMs = (p: Phase, c: PomodoroConfig) => (p === "focus" ? c.focusMin : p === "short" ? c.shortMin : c.longMin) * 60_000;

export const elapsedMs = (s: TimerState, now: number) => (s.status === "idle" || s.status === "done" ? 0 : s.accumulatedMs + (s.status === "running" ? now - s.runStart : 0));

/** Pomodoro: time left in the phase (never negative). Stopwatch: null. */
export function remainingMs(s: TimerState, now: number, c: PomodoroConfig): number | null {
  if (s.status === "idle" || s.status === "done" || s.mode === "stopwatch") return null;
  return Math.max(0, phaseMs(s.phase, c) - elapsedMs(s, now));
}

export const start = (mode: FocusMode, taskId: string | null, now: number, cycles: Cycles = { kind: "infinite" }, subIds: string[] = []): TimerState => ({
  status: "running",
  mode,
  phase: "focus",
  taskId,
  subIds,
  round: 1,
  accumulatedMs: 0,
  sessionStart: now,
  runStart: now,
  cycles,
  focusMs: 0,
});

export const pause = (s: TimerState, now: number): TimerState =>
  s.status === "running" ? { ...s, status: "paused", accumulatedMs: elapsedMs(s, now) } : s;

export const resume = (s: TimerState, now: number): TimerState => (s.status === "paused" ? { ...s, status: "running", runStart: now } : s);

/** The phase after `s.phase` finishes: focus → short/long break (long every N rounds) → next focus round. */
export function nextPhase(s: Active, c: PomodoroConfig): { phase: Phase; round: number } {
  if (s.phase !== "focus") return { phase: "focus", round: s.round + 1 };
  return { phase: s.round % c.longEvery === 0 ? "long" : "short", round: s.round };
}

/** Move on to the next phase (auto when time's up, or "skip"). Returns the focus session if one just ended. */
export function advance(s: TimerState, now: number, c: PomodoroConfig, newId: string): { state: TimerState; session: FocusSession | null } {
  if (s.status === "idle" || s.status === "done") return { state: s, session: null };
  const session = s.phase === "focus" ? sessionOf(s, now, c, newId) : null;
  const focusMs = s.focusMs + (session ? session.seconds * 1000 : 0);
  if (s.phase === "focus" && s.cycles.kind === "finite" && s.round >= s.cycles.count) {
    return { state: { status: "done", taskId: s.taskId, cycles: s.round, focusMs }, session };
  }
  const { phase, round } = nextPhase(s, c);
  return { state: { ...s, status: "running", phase, round, accumulatedMs: 0, sessionStart: now, runStart: now, focusMs }, session };
}

/** Stop: records the focus time so far (if any) and returns to idle. */
export function stop(s: TimerState, now: number, c: PomodoroConfig, newId: string): { state: TimerState; session: FocusSession | null } {
  if (s.status === "idle" || s.status === "done") return { state: { status: "idle" }, session: null };
  return { state: { status: "idle" }, session: s.phase === "focus" ? sessionOf(s, now, c, newId) : null };
}

/** Sessions shorter than a minute aren't worth recording. */
function sessionOf(s: Active, now: number, c: PomodoroConfig, id: string): FocusSession | null {
  const raw = elapsedMs(s, now);
  const ms = s.mode === "pomodoro" ? Math.min(raw, phaseMs("focus", c)) : raw;
  if (ms < 60_000) return null;
  return { id, taskId: s.taskId, mode: s.mode, startAt: new Date(s.sessionStart).toISOString(), endAt: new Date(now).toISOString(), seconds: Math.round(ms / 1000) };
}

/**
 * What the timer is on: a top-level task and optionally some of its subtasks. Focus time is always
 * credited to `taskId` (a session records one task); `subIds` only says which steps to show and check off.
 */
export type FocusPick = { taskId: string | null; subIds: string[] };
export const NO_PICK: FocusPick = { taskId: null, subIds: [] };

/** `order` ids from `a` to `b` inclusive, whichever comes first. */
export function rangeBetween(order: readonly string[], a: string, b: string): string[] {
  const i = order.indexOf(a);
  const j = order.indexOf(b);
  if (i < 0 || j < 0) return [b];
  return order.slice(Math.min(i, j), Math.max(i, j) + 1);
}

/** `selected` with `ids` added (`on`) or removed, in list order. */
export function withRange(order: readonly string[], selected: readonly string[], ids: readonly string[], on: boolean): string[] {
  const sel = new Set(selected);
  const rng = new Set(ids);
  return order.filter((id) => (on ? sel.has(id) || rng.has(id) : sel.has(id) && !rng.has(id)));
}

/** The picker trigger's text: "Review topics · 3 subtasks". */
export function pickLabel(title: string | null, subTitles: readonly string[]): string {
  if (title === null) return "No specific task";
  if (subTitles.length === 0) return title;
  return subTitles.length === 1 ? `${title} › ${subTitles[0]}` : `${title} · ${subTitles.length} subtasks`;
}

export function formatClock(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(sec).padStart(2, "0");
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export type AutoFocus = { key: string; taskId: string; title: string; start: number; end: number };

/** The not-done time-blocked task whose start fell in the last 60s, unless it is the block we already started. Not-done = the open tasks the caller passes in. */
export function dueAutoFocus(tasks: readonly TaskVM[], now: number, lastKey: string | null): AutoFocus | null {
  for (const { task, schedule, key } of tasks) {
    if (task.status !== "open" || schedule.kind !== "timed") continue;
    const start = Date.parse(schedule.start);
    const end = Date.parse(schedule.end);
    const k = `${task.id}:${key ?? ""}:${schedule.start}`;
    if (now >= start && now - start < 60_000 && end > now && k !== lastKey) return { key: k, taskId: task.id, title: task.title, start, end };
  }
  return null;
}
