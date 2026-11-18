import { create } from "zustand";
import { selectAfterWrites, upsert, write } from "../db/client";
import type { Row } from "../db/rows";
import { parseSession, sessionRow } from "../db/miscRows";
import * as timer from "../domain/focus";
import type { FocusMode, FocusSession, TimerState } from "../domain/focus";
import type { TaskVM } from "../domain/taskViews";
import { formatMinutes } from "../domain/dates";
import { uid } from "./data";
import { keepEdited, serially } from "./keepEdited";
import { trackDone, useSettings } from "./settings";
import { toast } from "./toast";

type State = { timer: TimerState; sessions: Record<string, FocusSession> };
export const useFocus = create<State>(() => ({ timer: { status: "idle" }, sessions: {} }));
const get = useFocus.getState;
const set = useFocus.setState;

/** Called when a focus phase ends on its own (the OS layer turns it into a notification). */
let onPhaseEnd: (phase: timer.Phase, next: timer.Phase | "done") => void = () => {};
export const setPhaseEndHandler = (fn: typeof onPhaseEnd) => void (onPhaseEnd = fn);

// A running timer is mirrored into sync_state (the existing key/value table) so a quit, crash or update restart
// doesn't lose it (HAB-01). `savedAt` is refreshed about every 30 s; the next launch records the session up to it.
const TIMER_KEY = "focus_timer";
const BEAT_MS = 30_000;
const AWAY_MS = 2 * 60_000;
let lastTick = 0;

/** Adds `gapMs` back to the paused timer that started at `sessionStart` and resumes it; a no-op if that timer is gone. */
export function keepAwayTime(sessionStart: number, gapMs: number) {
  const t = get().timer;
  if (!isActive(t) || t.sessionStart !== sessionStart) return;
  set({ timer: timer.resume({ ...t, accumulatedMs: t.accumulatedMs + gapMs }, Date.now()) });
}
let lastBeat = 0;
const isActive = (t: TimerState): t is timer.Active => t.status === "running" || t.status === "paused";

function persistTimer(t: TimerState, now = Date.now()) {
  lastBeat = now;
  void write(
    isActive(t)
      ? ["INSERT INTO sync_state (key, value) VALUES ($1, $2) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [TIMER_KEY, JSON.stringify({ timer: t, savedAt: now })]]
      : ["DELETE FROM sync_state WHERE key = $1", [TIMER_KEY]],
  );
}
useFocus.subscribe((st, prev) => {
  if (st.timer !== prev.timer) persistTimer(st.timer);
});

/** Records the session of a timer that was running when the app last closed, then clears it. */
async function recoverTimer() {
  const before = get().timer;
  if (isActive(before)) return;
  const [row] = await selectAfterWrites<{ value: string }>("SELECT value FROM sync_state WHERE key = $1", [TIMER_KEY]);
  // A timer started, or stopped and recorded, while the read was in flight owns the stored row now; recovering it too would duplicate the session.
  if (!row || get().timer !== before) return;
  try {
    const { timer: t, savedAt } = JSON.parse(row.value) as { timer: TimerState; savedAt: number };
    if (isActive(t) && Number.isFinite(savedAt) && Number.isFinite(t.accumulatedMs) && Number.isFinite(t.sessionStart)) record(timer.stop(t, savedAt, cfg(), uid()).session);
  } catch (err) {
    console.error("Stored focus timer is not valid; dropping it", err);
  }
  await write(["DELETE FROM sync_state WHERE key = $1", [TIMER_KEY]]);
}

async function load() {
  const then = get().sessions;
  const rows = await selectAfterWrites<Row>("SELECT * FROM focus_sessions");
  const loaded = Object.fromEntries(rows.map(parseSession).filter((s): s is FocusSession => !!s).map((s) => [s.id, s]));
  set({ sessions: keepEdited(loaded, then, get().sessions) });
  await recoverTimer();
}
export const hydrateFocus = serially(load);

export function replaceSessions(list: FocusSession[]) {
  set({ sessions: Object.fromEntries(list.map((s) => [s.id, s])) });
}
export const saveSessions = (list: FocusSession[]) => write(...list.map((s) => upsert("focus_sessions", sessionRow(s))));

function record(s: FocusSession | null) {
  if (!s) return;
  set((st) => ({ sessions: { ...st.sessions, [s.id]: s } }));
  void saveSessions([s]);
}

const cfg = () => useSettings.getState().settings.pomodoro;

export const startFocus = (mode: FocusMode, taskId: string | null, subIds: string[] = []) => set({ timer: timer.start(mode, taskId, Date.now(), cfg().cycles, subIds) });
export const pauseFocus = () => set({ timer: timer.pause(get().timer, Date.now()) });
export const resumeFocus = () => set({ timer: timer.resume(get().timer, Date.now()) });
export const setFocusTask = (taskId: string | null, subIds: string[] = []) => {
  const t = get().timer;
  if (!isActive(t)) return;
  // Stopwatch: time so far stays on the old task and the new one starts from zero (HAB-04). ponytail: a pomodoro keeps its phase clock, so it can't be split.
  const now = Date.now();
  if (t.mode === "stopwatch" && t.taskId !== taskId) {
    const { session } = timer.stop(t, now, cfg(), uid());
    if (session) {
      record(session);
      set({ timer: { ...t, taskId, subIds, accumulatedMs: 0, sessionStart: now, ...(t.status === "running" ? { runStart: now } : {}) } });
      return;
    }
  }
  set({ timer: { ...t, taskId, subIds } });
};

export function stopFocus() {
  blockEnd = null;
  const { state, session } = timer.stop(get().timer, Date.now(), cfg(), uid());
  set({ timer: state });
  record(session);
}

/** Skip to the next phase (or what the tick does when a phase runs out). */
export function skipPhase() {
  const before = get().timer;
  const { state, session } = timer.advance(before, Date.now(), cfg(), uid());
  set({ timer: state });
  record(session);
  return { before, state };
}

/** Driven by a 1s interval in the app shell: ends pomodoro phases on time, even in the tray. */
export function tickFocus() {
  const now = Date.now();
  const prev = lastTick;
  lastTick = now;
  const t = get().timer;
  // No tick for minutes = the machine slept or the window was frozen: stop counting at the last tick (HAB-05).
  if (t.status === "running" && prev && now - prev > AWAY_MS) {
    set({ timer: timer.pause(t, prev) });
    // The away time is dropped unless "Keep" is pressed in time (HAB-21); the timer stays paused either way.
    const gap = now - prev;
    toast(`Away for ${formatMinutes(Math.round(gap / 60_000))}. Keep that time?`, { label: "Keep", run: () => keepAwayTime(t.sessionStart, gap) }, 20_000);
    return;
  }
  if (isActive(t) && Date.now() - lastBeat >= BEAT_MS) persistTimer(t);
  if (t.status !== "running" || t.mode !== "pomodoro") return;
  if ((timer.remainingMs(t, Date.now(), cfg()) ?? 1) > 0) return;
  const { before, state } = skipPhase();
  if (before.status === "running" && state.status !== "idle") {
    if (before.phase === "focus") trackDone("focus:completed");
    onPhaseEnd(before.phase, state.status === "done" ? "done" : state.phase);
  }
}

let lastBlock: string | null = null;
let blockEnd: { taskId: string; end: number } | null = null;

/**
 * Auto-start (Settings → "Start focus at time blocks"): called about once a second with a way to read the
 * open tasks. When a time block has just begun and nothing is running, starts a stopwatch on its task and
 * stops it when the block ends. Returns the block it started, so the caller can say so.
 */
export function autoStartFocus(openTasks: () => readonly TaskVM[], now = Date.now()): timer.AutoFocus | null {
  const t = get().timer;
  const busy = t.status === "running" || t.status === "paused";
  if (blockEnd && now >= blockEnd.end) {
    if (busy && t.taskId === blockEnd.taskId) stopFocus();
    blockEnd = null;
  }
  if (!useSettings.getState().settings.autoFocus || busy) return null;
  const due = timer.dueAutoFocus(openTasks(), now, lastBlock);
  if (!due) return null;
  lastBlock = due.key;
  blockEnd = { taskId: due.taskId, end: due.end };
  startFocus("stopwatch", due.taskId);
  return due;
}

export function deleteSession(id: string) {
  set((st) => {
    const { [id]: _gone, ...sessions } = st.sessions;
    return { sessions };
  });
  void write(["DELETE FROM focus_sessions WHERE id = $1", [id]]);
}

/** Adds a session after the fact (HAB-25). False when the start, length or end isn't valid. */
export function addManualSession(taskId: string | null, startMs: number, minutes: number): boolean {
  const s = timer.manualSession(taskId, startMs, minutes, Date.now(), uid());
  record(s);
  return !!s;
}
