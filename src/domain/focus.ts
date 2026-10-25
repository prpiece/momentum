/*
 * Focus timer as a pure state machine. Time is always derived from wall-clock timestamps
 * (never from counting ticks), so throttled background timers can't make it drift.
 */
import type { Instant } from "./types";

export type FocusMode = "pomodoro" | "stopwatch";
export type Phase = "focus" | "short" | "long";
export type PomodoroConfig = { focusMin: number; shortMin: number; longMin: number; longEvery: number };
export const DEFAULT_POMODORO: PomodoroConfig = { focusMin: 25, shortMin: 5, longMin: 15, longEvery: 4 };

type Common = { mode: FocusMode; phase: Phase; taskId: string | null; round: number; accumulatedMs: number; sessionStart: number };
export type TimerState = { status: "idle" } | (Common & { status: "running"; runStart: number }) | (Common & { status: "paused" });

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

export const elapsedMs = (s: TimerState, now: number) => (s.status === "idle" ? 0 : s.accumulatedMs + (s.status === "running" ? now - s.runStart : 0));

/** Pomodoro: time left in the phase (never negative). Stopwatch: null. */
export function remainingMs(s: TimerState, now: number, c: PomodoroConfig): number | null {
  if (s.status === "idle" || s.mode === "stopwatch") return null;
  return Math.max(0, phaseMs(s.phase, c) - elapsedMs(s, now));
}

export const start = (mode: FocusMode, taskId: string | null, now: number): TimerState => ({
  status: "running",
  mode,
  phase: "focus",
  taskId,
  round: 1,
  accumulatedMs: 0,
  sessionStart: now,
  runStart: now,
});

export const pause = (s: TimerState, now: number): TimerState =>
  s.status === "running" ? { ...s, status: "paused", accumulatedMs: elapsedMs(s, now) } : s;

export const resume = (s: TimerState, now: number): TimerState => (s.status === "paused" ? { ...s, status: "running", runStart: now } : s);

/** The phase after `s.phase` finishes: focus → short/long break (long every N rounds) → next focus round. */
export function nextPhase(s: Exclude<TimerState, { status: "idle" }>, c: PomodoroConfig): { phase: Phase; round: number } {
  if (s.phase !== "focus") return { phase: "focus", round: s.round + 1 };
  return { phase: s.round % c.longEvery === 0 ? "long" : "short", round: s.round };
}

/** Move on to the next phase (auto when time's up, or "skip"). Returns the focus session if one just ended. */
export function advance(s: TimerState, now: number, c: PomodoroConfig, newId: string): { state: TimerState; session: FocusSession | null } {
  if (s.status === "idle") return { state: s, session: null };
  const session = s.phase === "focus" ? sessionOf(s, now, c, newId) : null;
  const { phase, round } = nextPhase(s, c);
  return { state: { ...s, status: "running", phase, round, accumulatedMs: 0, sessionStart: now, runStart: now }, session };
}

/** Stop: records the focus time so far (if any) and returns to idle. */
export function stop(s: TimerState, now: number, c: PomodoroConfig, newId: string): { state: TimerState; session: FocusSession | null } {
  if (s.status === "idle") return { state: s, session: null };
  return { state: { status: "idle" }, session: s.phase === "focus" ? sessionOf(s, now, c, newId) : null };
}

/** Sessions shorter than a minute aren't worth recording. */
function sessionOf(s: Exclude<TimerState, { status: "idle" }>, now: number, c: PomodoroConfig, id: string): FocusSession | null {
  const raw = elapsedMs(s, now);
  const ms = s.mode === "pomodoro" ? Math.min(raw, phaseMs("focus", c)) : raw;
  if (ms < 60_000) return null;
  return { id, taskId: s.taskId, mode: s.mode, startAt: new Date(s.sessionStart).toISOString(), endAt: new Date(now).toISOString(), seconds: Math.round(ms / 1000) };
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
