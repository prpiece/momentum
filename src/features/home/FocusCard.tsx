import { useMemo } from "react";
import { formatMinutes, todayLocal } from "../../domain/dates";
import { secondsOn, sessionParts } from "../../domain/stats";
import { useFocus } from "../../stores/focus";
import { go } from "../../stores/ui";
import { HomeCard, Quiet } from "./HomeCard";

/** Focus time logged today. */
export function FocusCard() {
  const sessions = useFocus((s) => s.sessions);
  const today = todayLocal();
  const { minutes, count } = useMemo(() => {
    const mine = Object.values(sessions).filter((s) => sessionParts(s).some((p) => p.day === today));
    return { minutes: secondsOn(mine, today) / 60, count: mine.length };
  }, [sessions, today]);

  return (
    <HomeCard title="Focus" onOpen={() => go("focus")}>
      <div className="text-[length:var(--fs-xl)] font-semibold leading-[var(--lh-xl)] tabular-nums">{formatMinutes(minutes)}</div>
      <Quiet>{count ? `${count} ${count === 1 ? "session" : "sessions"} today` : "No focus sessions yet today."}</Quiet>
    </HomeCard>
  );
}
