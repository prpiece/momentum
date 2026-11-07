import { BedDouble, Flame } from "lucide-react";
import { useMemo } from "react";
import { addDaysLocal, todayLocal } from "../../domain/dates";
import { weekStartOf } from "../../domain/perfect";
import { perfectRun } from "../../lib/celebrate";
import { useData } from "../../stores/data";
import { useHabits } from "../../stores/habits";
import { setRestDay, useProgress } from "../../stores/progress";
import { useSettings } from "../../stores/settings";

/** Today's header: the perfect-day run and the once-a-week rest day (D64). */
export function TodayStreak() {
  const tasks = useData((s) => s.tasks);
  const checkins = useHabits((s) => s.checkins);
  const restDays = useProgress((s) => s.restDays);
  const pushes = useProgress((s) => s.pushes);
  const weekStart = useSettings((s) => s.settings.weekStart);
  const today = todayLocal();
  // Recomputed when anything it reads changes; the inputs are read from the stores inside.
  const run = useMemo(() => perfectRun(), [tasks, checkins, restDays, pushes, weekStart, today]);
  const resting = restDays.has(today);
  const ws = weekStartOf(today, weekStart);
  const usedThisWeek = [...restDays].some((d) => d !== today && d >= ws && d <= addDaysLocal(ws, 6));

  return (
    <div className="flex shrink-0 items-center gap-3">
      {run > 0 && (
        <span title={`${run} perfect ${run === 1 ? "day" : "days"} in a row`} className="flex items-center gap-1.5 text-[length:var(--fs-sm)] text-fg-2">
          <Flame size={16} strokeWidth={1.75} className="text-streak" />
          <b key={run} className="anim-pop font-semibold tabular-nums text-fg">
            {run}
          </b> day streak
        </span>
      )}
      <button
        type="button"
        disabled={!resting && usedThisWeek}
        onClick={() => setRestDay(today, !resting)}
        title={!resting && usedThisWeek ? "You've had this week's rest day" : "A rest day doesn't count and doesn't break your run. One per week."}
        aria-pressed={resting}
        className="btn btn-ghost btn-sm"
      >
        <BedDouble size={16} strokeWidth={1.75} />
        {resting ? "Resting today" : "Rest day"}
      </button>
    </div>
  );
}
