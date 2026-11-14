import { Bell } from "lucide-react";
import * as api from "../../lib/sync/social";
import { useSocial } from "../../stores/social";
import { toast } from "../../stores/toast";
import { attempt } from "./attempt";

/** Habits friends have shared with you as their check-in buddy: the name and today's check-in, nothing else (D260). */
export function BuddiesSection() {
  const habits = useSocial((s) => s.buddyHabits);
  if (!habits.length) return null;

  const nudge = async (h: api.BuddyHabit) => {
    if (await attempt(() => api.nudge(h.owner.id, h.habitId))) toast(`Nudged @${h.owner.handle}.`);
  };

  return (
    <section aria-label="Your buddies' habits">
      <h3 className="t-label mb-2 text-muted">Your buddies' habits</h3>
      <ul className="overflow-hidden rounded-card border border-border bg-surface [&>li+li]:border-t [&>li+li]:border-border">
        {habits.map((h) => (
          <li key={`${h.owner.id}:${h.habitId}`} className="flex min-h-[var(--row)] items-center gap-3 px-3.5">
            <span className="min-w-0 flex-1 truncate">
              <b className="font-medium">{h.name}</b>
              <span className="ml-2 text-muted">@{h.owner.handle}</span>
            </span>
            <span className="shrink-0 text-[length:var(--fs-sm)] tabular-nums text-muted">Today: {h.today}</span>
            <button type="button" className="btn btn-secondary" disabled={!h.canNudge} title={h.canNudge ? "Send a nudge" : "Nudged today, or nudges are off"} onClick={() => void nudge(h)}>
              <Bell size={14} strokeWidth={1.75} /> Nudge
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
