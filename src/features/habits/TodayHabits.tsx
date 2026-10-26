import { AppIcon } from "../../components/ui/AppIcon";
import { ChevronRight } from "lucide-react";
import { useMemo } from "react";
import { todayLocal } from "../../domain/dates";
import { isDone, isDueToday } from "../../domain/habits";
import { useHabits, valuesOf } from "../../stores/habits";
import { useSettings } from "../../stores/settings";
import { go, openContextMenu, toggleCollapsed, useUi } from "../../stores/ui";
import { habitMenu } from "./habitMenu";
import { CheckinButton } from "./CheckinButton";

/** Habits due today, shown above the Today task list. */
export function TodayHabits() {
  const habits = useHabits((s) => s.habits);
  const checkins = useHabits((s) => s.checkins);
  const ws = useSettings((s) => s.settings.weekStart);
  const collapsed = useUi((s) => !!s.collapsed["today:habits"]);
  const today = todayLocal();
  const due = useMemo(
    () => Object.values(habits).filter((h) => isDueToday(h, valuesOf(checkins[h.id]), today, ws)).sort((a, b) => a.sortOrder - b.sortOrder),
    [habits, checkins, today, ws],
  );
  if (!due.length) return null;
  const doneCount = due.filter((h) => isDone(h, checkins[h.id]?.[today]?.value)).length;
  return (
    <section className="px-4 pb-2" aria-label="Today's habits">
      <button type="button" onClick={() => toggleCollapsed("today:habits")} aria-expanded={!collapsed} className="flex items-center gap-1.5 px-2 pb-1.5 text-xs font-semibold uppercase tracking-wider text-fg-2 hover:text-fg">
        <ChevronRight size={14} className={`transition-transform duration-[var(--dur)] ${collapsed ? "" : "rotate-90"}`} />
        Habits
        <span className="font-mono font-normal text-muted">
          {doneCount}/{due.length}
        </span>
      </button>
      {!collapsed && (
        <div className="flex flex-wrap gap-2">
          {due.map((h) => (
            <div key={h.id} onContextMenu={(e) => openContextMenu(e, habitMenu(h, today))} className="flex items-center gap-2 rounded-full border border-border bg-surface-2 py-1 pl-1 pr-3 shadow-sm">
              <CheckinButton habit={h} date={today} size={30} />
              <button type="button" onClick={() => go("habits")} className="flex items-center gap-1.5 text-sm hover:underline">
                <AppIcon name={h.icon} size={14} color={h.color} /> {h.name}
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
