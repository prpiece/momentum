import { useMemo } from "react";
import { AppIcon } from "../../components/ui/AppIcon";
import { todayLocal } from "../../domain/dates";
import { isDoneOn, isDueToday } from "../../domain/habits";
import { useHabits, valuesOf } from "../../stores/habits";
import { useSettings } from "../../stores/settings";
import { go } from "../../stores/ui";
import { CheckinButton } from "../habits/CheckinButton";
import { HomeCard, Quiet } from "./HomeCard";

const SHOWN = 4;

/** Habits due today: how many are done, and a check-in button for the first few. */
export function HabitsCard() {
  const habits = useHabits((s) => s.habits);
  const checkins = useHabits((s) => s.checkins);
  const ws = useSettings((s) => s.settings.weekStart);
  const today = todayLocal();
  const due = useMemo(
    () => Object.values(habits).filter((h) => isDueToday(h, valuesOf(checkins[h.id]), today, ws)).sort((a, b) => a.sortOrder - b.sortOrder),
    [habits, checkins, today, ws],
  );
  const done = due.filter((h) => isDoneOn(h, valuesOf(checkins[h.id]), today, ws)).length;

  return (
    <HomeCard title="Habits" onOpen={() => go("habits")}>
      {due.length === 0 ? (
        <Quiet>No habits due today.</Quiet>
      ) : (
        <>
          <div className="mb-3 flex items-center gap-3">
            <span className="text-[length:var(--fs-xl)] font-semibold leading-[var(--lh-xl)] tabular-nums">
              {done}/{due.length}
            </span>
            <div className="h-1.5 flex-1 rounded-full bg-surface-2" role="progressbar" aria-valuemin={0} aria-valuemax={due.length} aria-valuenow={done} aria-label="Habits done today">
              <div className="h-full rounded-full bg-accent" style={{ width: `${(done / due.length) * 100}%` }} />
            </div>
          </div>
          <ul className="space-y-1">
            {due.slice(0, SHOWN).map((h) => (
              <li key={h.id} className="flex items-center gap-2">
                <CheckinButton habit={h} date={today} size={28} />
                <AppIcon name={h.icon} size={14} color={h.color} />
                <span className="min-w-0 flex-1 truncate text-[length:var(--fs-sm)]">{h.name}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </HomeCard>
  );
}
