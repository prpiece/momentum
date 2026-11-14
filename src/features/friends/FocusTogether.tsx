import { format } from "date-fns";
import { useEffect, useMemo, useState } from "react";
import { Switch } from "../../components/ui/Switch";
import { useSync } from "../../lib/sync/engine";
import { setShareFocus, SocialError } from "../../lib/sync/social";
import { supabase } from "../../lib/sync/supabase";
import { useFocus } from "../../stores/focus";
import { useSocial } from "../../stores/social";
import { toast } from "../../stores/toast";
import { useNow } from "../focus/FocusView";
import { joinFocus, publishFocus } from "./focusSession";

/** In the Focus view: share that you're focusing (off by default), and join friends who are. */
export function FocusTogether() {
  const me = useSync((s) => s.account);
  const friends = useSocial((s) => s.friends);
  const focusing = useSocial((s) => s.focusing);
  const idle = useFocus((s) => s.timer.status === "idle" || s.timer.status === "done");
  const [on, setOn] = useState<boolean | null>(null);
  const now = useNow(!!me, 30_000);

  useEffect(() => {
    if (!me) return;
    let live = true;
    void supabase
      .from("profiles")
      .select("share_focus")
      .eq("id", me)
      .maybeSingle()
      .then(({ data }) => live && setOn(data?.share_focus === true));
    return () => void (live = false);
  }, [me]);

  const rows = useMemo(
    () =>
      Object.entries(focusing)
        .map(([id, endsAt]) => ({ friend: friends.find((f) => f.id === id), endsAt }))
        .filter((r): r is { friend: NonNullable<typeof r.friend>; endsAt: string } => !!r.friend && Date.parse(r.endsAt) > now),
    [focusing, friends, now],
  );
  if (!me) return null;

  const toggle = async (v: boolean) => {
    try {
      await setShareFocus(v, me);
      setOn(v);
      publishFocus(true);
    } catch (e) {
      toast(e instanceof SocialError ? e.message : "Couldn't change that.");
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="t-label mb-1 text-muted">Focus together</h2>
          <p className="text-[length:var(--fs-sm)] text-fg-2">Let friends see when I'm focusing</p>
          <p className="text-[length:var(--fs-xs)] text-muted">They see that a session is running and when it ends, never what you work on.</p>
        </div>
        <Switch checked={on === true} onChange={(v) => void toggle(v)} label="Let friends see when I'm focusing" />
      </div>
      {rows.length > 0 && (
        <ul aria-label="Friends focusing now" className="space-y-0.5">
          {rows.map(({ friend, endsAt }) => (
            <li key={friend.id} className="flex min-h-[var(--row)] items-center gap-2 text-[length:var(--fs-sm)]">
              <span className="size-2 shrink-0 rounded-full bg-success" aria-hidden />
              <span className="min-w-0 flex-1 truncate">
                <b className="font-medium">@{friend.handle}</b>
                <span className="ml-1.5 tabular-nums text-muted">until {format(new Date(endsAt), "HH:mm")}</span>
              </span>
              <button type="button" className="btn btn-secondary btn-sm" disabled={!idle} title={idle ? "Start a session that ends when theirs does" : "Stop your current session first"} onClick={() => joinFocus(endsAt)}>
                Join
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
