/*
 * Focus together (D260): publishes only that a session is running and when it ends, and joins a friend's
 * session by running your own until the same moment. Lives in the UI layer; the focus store knows nothing of it.
 */
import { phaseMs } from "../../domain/focus";
import { useSync } from "../../lib/sync/engine";
import { setFocus } from "../../lib/sync/social";
import { startFocus, stopFocus, useFocus } from "../../stores/focus";
import { useSettings } from "../../stores/settings";
import { toast } from "../../stores/toast";

/** The moment a joined session must end; stopwatch sessions have no end of their own. */
let joinEnd: number | null = null;
let joinTimer: ReturnType<typeof setTimeout> | undefined;
let last = "";

function endOfRunning(): number | null {
  const t = useFocus.getState().timer;
  if (t.status !== "running" || t.phase !== "focus") return null;
  if (t.mode === "pomodoro") return t.runStart + phaseMs("focus", useSettings.getState().settings.pomodoro) - t.accumulatedMs;
  return joinEnd;
}

/** Tells the server about the running session. `force` sends even when nothing changed (after turning sharing on). */
export function publishFocus(force = false) {
  if (!useSync.getState().account) return;
  const t = useFocus.getState().timer;
  if (t.status === "idle" && joinEnd) (joinEnd = null), clearTimeout(joinTimer);
  const end = endOfRunning();
  const key = end ? String(Math.round(end / 1000)) : "";
  if (key === last && !force) return;
  last = key;
  void setFocus(end ? new Date(end).toISOString() : null).catch(() => undefined);
}

/** Call once at startup in the main window. */
export function watchFocus() {
  useFocus.subscribe(() => publishFocus());
  useSync.subscribe(() => publishFocus());
}

/** Starts your own session ending when theirs does. */
export function joinFocus(endsAt: string) {
  const end = Date.parse(endsAt);
  const t = useFocus.getState().timer;
  if (t.status === "running" || t.status === "paused") return toast("Finish or stop your current session first.");
  if (!(end > Date.now())) return toast("That session has just ended.");
  joinEnd = end;
  startFocus("stopwatch", null);
  clearTimeout(joinTimer);
  joinTimer = setTimeout(() => {
    if (joinEnd === end && useFocus.getState().timer.status !== "idle") stopFocus();
    joinEnd = null;
  }, end - Date.now());
}
