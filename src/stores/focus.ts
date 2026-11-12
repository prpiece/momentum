import { create } from "zustand";
import { select, upsert, write } from "../db/client";
import type { Row } from "../db/rows";
import { parseSession, sessionRow } from "../db/miscRows";
import * as timer from "../domain/focus";
import type { FocusMode, FocusSession, TimerState } from "../domain/focus";
import type { TaskVM } from "../domain/taskViews";
import { uid } from "./data";
import { trackDone, useSettings } from "./settings";

type State = { timer: TimerState; sessions: Record<string, FocusSession> };
export const useFocus = create<State>(() => ({ timer: { status: "idle" }, sessions: {} }));
const get = useFocus.getState;
const set = useFocus.setState;

/** Called when a focus phase ends on its own (the OS layer turns it into a notification). */
let onPhaseEnd: (phase: timer.Phase, next: timer.Phase | "done") => void = () => {};
export const setPhaseEndHandler = (fn: typeof onPhaseEnd) => void (onPhaseEnd = fn);

export async function hydrateFocus() {
  const rows = await select<Row>("SELECT * FROM focus_sessions");
  set({ sessions: Object.fromEntries(rows.map(parseSession).filter((s): s is FocusSession => !!s).map((s) => [s.id, s])) });
}

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
  if (t.status === "running" || t.status === "paused") set({ timer: { ...t, taskId, subIds } });
};

export function stopFocus() {
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
  const t = get().timer;
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
