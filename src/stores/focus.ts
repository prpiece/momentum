import { create } from "zustand";
import { select, upsert, write } from "../db/client";
import type { Row } from "../db/rows";
import { isInstant } from "../domain/dates";
import * as timer from "../domain/focus";
import type { FocusMode, FocusSession, TimerState } from "../domain/focus";
import { uid } from "./data";
import { useSettings } from "./settings";

type State = { timer: TimerState; sessions: Record<string, FocusSession> };
export const useFocus = create<State>(() => ({ timer: { status: "idle" }, sessions: {} }));
const get = useFocus.getState;
const set = useFocus.setState;

/** Called when a focus phase ends on its own (the OS layer turns it into a notification). */
let onPhaseEnd: (phase: timer.Phase, next: timer.Phase) => void = () => {};
export const setPhaseEndHandler = (fn: typeof onPhaseEnd) => void (onPhaseEnd = fn);

const parseSession = (r: Row): FocusSession | null =>
  typeof r.id === "string" && (r.mode === "pomodoro" || r.mode === "stopwatch") && isInstant(r.start_at) && isInstant(r.end_at) && typeof r.seconds === "number"
    ? { id: r.id, taskId: typeof r.task_id === "string" ? r.task_id : null, mode: r.mode, startAt: r.start_at, endAt: r.end_at, seconds: r.seconds }
    : null;
const sessionRow = (s: FocusSession): Row => ({ id: s.id, task_id: s.taskId, mode: s.mode, start_at: s.startAt, end_at: s.endAt, seconds: s.seconds });

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

export const startFocus = (mode: FocusMode, taskId: string | null) => set({ timer: timer.start(mode, taskId, Date.now()) });
export const pauseFocus = () => set({ timer: timer.pause(get().timer, Date.now()) });
export const resumeFocus = () => set({ timer: timer.resume(get().timer, Date.now()) });
export const setFocusTask = (taskId: string | null) => {
  const t = get().timer;
  if (t.status !== "idle") set({ timer: { ...t, taskId } });
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
  if (before.status !== "idle" && state.status !== "idle") onPhaseEnd(before.phase, state.phase);
}

export function deleteSession(id: string) {
  set((st) => {
    const { [id]: _gone, ...sessions } = st.sessions;
    return { sessions };
  });
  void write(["DELETE FROM focus_sessions WHERE id = $1", [id]]);
}
