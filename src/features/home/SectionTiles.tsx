import { AlarmClock, CalendarDays, CalendarRange, ChartColumn, LayoutGrid, Sun, Target, type LucideIcon } from "lucide-react";
import type { ViewId } from "../../domain/types";
import { go } from "../../stores/ui";
import { useCounts } from "../tasks/selectors";
import { showInCurrentView } from "../tasks/viewOptions";

type Tile = { label: string; hint: string; icon: LucideIcon; open: () => void; count?: number };

/** One tile per section: where you can go from here. */
export function SectionTiles() {
  const counts = useCounts();
  const to = (view: ViewId) => () => go(view);
  const tiles: Tile[] = [
    { label: "Today", hint: "What is planned", icon: Sun, open: to("today"), count: counts.smart.today },
    { label: "Upcoming", hint: "The days ahead", icon: CalendarRange, open: to("upcoming"), count: counts.smart.upcoming },
    { label: "Calendar", hint: "Plan your time", icon: CalendarDays, open: to("calendar") },
    { label: "Habits", hint: "Daily check-ins", icon: Target, open: to("habits") },
    { label: "Focus", hint: "Timer and sessions", icon: AlarmClock, open: to("focus") },
    { label: "Matrix", hint: "Urgent and important", icon: LayoutGrid, open: () => showInCurrentView({ mode: "matrix" }) },
    { label: "Progress", hint: "What you finished", icon: ChartColumn, open: to("progress") },
  ];
  return (
    <nav aria-label="Sections" className="grid grid-cols-2 gap-3 min-[720px]:grid-cols-4">
      {tiles.map((t) => (
        <button key={t.label} type="button" onClick={t.open} className="card flex items-center gap-3 text-left hover:bg-surface-2">
          <span className="grid size-9 shrink-0 place-items-center rounded-control bg-accent-soft text-accent-text">
            <t.icon size={18} strokeWidth={1.75} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium">{t.label}</span>
            <span className="block truncate text-[length:var(--fs-xs)] text-muted">{t.hint}</span>
          </span>
          {t.count ? <span className="text-[length:var(--fs-sm)] tabular-nums text-muted">{t.count}</span> : null}
        </button>
      ))}
    </nav>
  );
}
