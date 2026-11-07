import { Hourglass } from "lucide-react";
import { useMemo } from "react";
import { countdownDays, eventCountdown } from "../../domain/countdown";
import { todayLocal } from "../../domain/dates";
import { useData } from "../../stores/data";
import { openEvent } from "../../stores/ui";

/** Pinned countdowns at the top of Today: "12 days until Trip" (D163). */
export function CountdownChips() {
  const events = useData((s) => s.events);
  const today = todayLocal();
  const chips = useMemo(
    () =>
      Object.values(events)
        .flatMap((e) => {
          const c = e.pinned && !e.deletedAt ? eventCountdown(e) : null;
          return c ? [{ e, c, n: countdownDays(c, today) }] : [];
        })
        // Upcoming first (soonest), then "since" counters.
        .sort((a, b) => Number(a.c.direction === "since") - Number(b.c.direction === "since") || a.n - b.n),
    [events, today],
  );
  if (!chips.length) return null;
  const text = ({ e, c, n }: (typeof chips)[number]) => {
    const days = `${Math.abs(n)} day${Math.abs(n) === 1 ? "" : "s"}`;
    if (n === 0) return `${e.title} is today`;
    if (c.direction === "since") return `${days} since ${e.title}`;
    return n < 0 ? `${e.title} was ${days} ago` : `${days} until ${e.title}`;
  };
  return (
    <ul aria-label="Pinned countdowns" className="flex flex-wrap gap-2 px-6 pb-3">
      {chips.map((chip) => (
        <li key={chip.e.id}>
          <button
            type="button"
            onClick={() => openEvent(chip.e.id)}
            className="flex h-7 items-center gap-1.5 rounded-control border border-border px-2.5 text-xs text-fg-2 transition-colors duration-[var(--dur)] hover:bg-surface-2 hover:text-fg focus-visible:ring-2 focus-visible:ring-accent"
          >
            <Hourglass size={13} style={chip.e.color ? { color: chip.e.color } : undefined} />
            <span className="tabular-nums">{text(chip)}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
