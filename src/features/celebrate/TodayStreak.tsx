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
    <div className="flex shrink-0 items-center gap-1">
      {run > 0 && (
        <span title={`${run} perfect ${run === 1 ? "day" : "days"} in a row`} className="flex items-center gap-1 rounded-sm px-2 py-1 text-sm font-semibold text-[#e8590c]">
          <Flame size={16} className="anim-flicker" fill="currentColor" fillOpacity={0.25} />
          <span key={run} className="anim-pop font-mono tabular-nums">
            {run}
          </span>
        </span>
      )}
      <button
        type="button"
        disabled={!resting && usedThisWeek}
        onClick={() => setRestDay(today, !resting)}
        title={!resting && usedThisWeek ? "You've had this week's rest day" : "A rest day doesn't count and doesn't break your run. One per week."}
        className={`flex h-8 items-center gap-1.5 rounded-sm px-2.5 text-xs disabled:opacity-40 ${resting ? "bg-accent-soft text-fg" : "text-fg-2 hover:bg-hover"} focus-visible:ring-2 focus-visible:ring-accent`}
      >
        <BedDouble size={15} />
        {resting ? "Resting today" : "Rest day"}
      </button>
    </div>
  );
}
