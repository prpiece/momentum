/*
 * Focus together (v1.4, D260) on the phone: publishes a running session's end through the shared
 * social layer, and Join starts your own session that ends when the friend's does.
 */
import { useEffect, useState } from "react";
import { remainingMs } from "@core/domain/focus";
import { useSync } from "@core/lib/sync/engine";
import { setFocus, setShareFocus } from "@core/lib/sync/social";
import { supabase } from "@core/lib/sync/supabase";
import { startFocus, stopFocus, useFocus } from "@core/stores/focus";
import { useSettings } from "@core/stores/settings";

/** A joined session is a stopwatch that stops itself at the friend's end. */
let joined: { end: number; timeout: ReturnType<typeof setTimeout> } | null = null;
export const joinedEnd = () => joined?.end ?? null;

export function joinFocus(endsAt: string) {
  const end = Date.parse(endsAt);
  if (!(end > Date.now())) return;
  startFocus("stopwatch", null);
  joined = { end, timeout: setTimeout(stopFocus, end - Date.now()) };
}

let last: string | null = null;
function publish(end: string | null) {
  if (end === last) return;
  last = end;
  if (useSync.getState().account) void setFocus(end).catch((e) => console.error("focus status failed", e));
}

/** Call once from boot: tells the server when a focus phase is running and when it ends (null otherwise). */
export function startFocusPublishing() {
  useFocus.subscribe((s, p) => {
    const t = s.timer;
    if (t === p.timer) return;
    if (t.status !== "running" && joined) {
      clearTimeout(joined.timeout);
      joined = null;
    }
    if (t.status !== "running" || t.phase !== "focus") return publish(null);
    const end = joined?.end ?? (t.mode === "pomodoro" ? Date.now() + (remainingMs(t, Date.now(), useSettings.getState().settings.pomodoro) ?? 0) : null);
    publish(end ? new Date(end).toISOString() : null);
  });
}

/** The "Let friends see when I'm focusing" switch: read from the profile, written through the shared call. */
export function useShareFocus() {
  const me = useSync((s) => s.account);
  const [on, setOn] = useState<boolean | null>(null);
  useEffect(() => {
    if (!me) return;
    void supabase.from("profiles").select("share_focus").eq("id", me).single().then(({ data }) => setOn(data?.share_focus === true));
  }, [me]);
  const set = async (value: boolean) => {
    if (!me) return;
    setOn(value);
    try {
      await setShareFocus(value, me);
      // A session already running is published on its next change; forget what was sent so it goes out again.
      last = null;
    } catch (e) {
      setOn(!value);
      throw e;
    }
  };
  return { on, set };
}
