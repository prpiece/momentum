import { format } from "date-fns";
import { useMemo, useState } from "react";
import { BarChart } from "../../components/ui/BarChart";
import { addDaysLocal, fromLocalDate, todayLocal } from "../../domain/dates";
import { completionRate } from "../../domain/habits";
import { completedPerDay, completedPerWeek, habitConsistency, type Bucket } from "../../domain/stats";
import { inSmartList } from "../../domain/taskViews";
import { useData } from "../../stores/data";
import { useHabits, valuesOf } from "../../stores/habits";
import { useSettings } from "../../stores/settings";
import { useDerived } from "../tasks/selectors";

/** Extra stat sections (focus time) contributed by later features. */
type Section = { id: string; render: () => React.ReactNode };
const sections: Section[] = [];
export const addStatsSection = (s: Section) => void (sections.some((x) => x.id === s.id) || sections.push(s));

const pct = (r: number | null) => (r === null ? "–" : `${Math.round(r * 100)}%`);

export function StatsView() {
  const tasks = useData((s) => s.tasks);
  const derived = useDerived();
  const habits = useHabits((s) => s.habits);
  const checkins = useHabits((s) => s.checkins);
  const ws = useSettings((s) => s.settings.weekStart);
  const today = todayLocal();
  const [range, setRange] = useState<"days" | "weeks">("days");
  const all = useMemo(() => Object.values(tasks), [tasks]);

  const days = useMemo(() => completedPerDay(all, today, 14), [all, today]);
  const weeks = useMemo(() => completedPerWeek(all, today, 12, ws), [all, today, ws]);
  const thisWeek = weeks[weeks.length - 1]?.value ?? 0;
  const open = derived.active.filter((v) => v.task.status === "open").length;
  const overdue = derived.active.filter((v) => inSmartList("overdue", v, today)).length;
  const habitList = useMemo(() => Object.values(habits).filter((h) => !h.archived), [habits]);
  const from30 = addDaysLocal(today, -29);
  const consistency = habitConsistency(habitList, (id) => valuesOf(checkins[id]), from30, today, today, ws);

  return (
    <div className="scroll-thin h-full overflow-y-auto px-6 pb-10">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Tile label="Completed today" value={days[days.length - 1]?.value ?? 0} />
        <Tile label="This week" value={thisWeek} />
        <Tile label="Open tasks" value={open} />
        <Tile label="Overdue" value={overdue} tone={overdue ? "danger" : undefined} />
        <Tile label="Habit consistency" value={pct(consistency)} hint="last 30 days" />
      </div>

      <section className="mt-6 rounded-lg border border-border bg-surface-2 p-5 shadow-sm">
        <div className="mb-3 flex items-center">
          <h2 className="flex-1 text-sm font-semibold">Tasks completed</h2>
          <div role="radiogroup" aria-label="Range" className="flex rounded-sm border border-border bg-bg p-0.5">
            {(["days", "weeks"] as const).map((r) => (
              <button key={r} type="button" role="radio" aria-checked={range === r} onClick={() => setRange(r)} className={`h-7 rounded-[6px] px-3 text-xs ${range === r ? "bg-surface-2 font-semibold shadow-sm" : "text-muted"}`}>
                {r === "days" ? "14 days" : "12 weeks"}
              </button>
            ))}
          </div>
        </div>
        {range === "days" ? (
          <BarChart
            title="Tasks completed per day, last 14 days"
            data={days}
            label={(b: Bucket) => format(fromLocalDate(b.start), "EEE, MMM d")}
            tick={(b, i) => (i % 2 === 1 || b.start === today ? "" : format(fromLocalDate(b.start), "d MMM"))}
          />
        ) : (
          <BarChart
            title="Tasks completed per week, last 12 weeks"
            data={weeks}
            label={(b) => `Week of ${format(fromLocalDate(b.start), "MMM d")}`}
            tick={(b, i) => (i % 2 === 0 ? format(fromLocalDate(b.start), "MMM d") : "")}
          />
        )}
      </section>

      {habitList.length > 0 && (
        <section className="mt-6 rounded-lg border border-border bg-surface-2 p-5 shadow-sm">
          <h2 className="mb-3 text-sm font-semibold">Habit consistency · last 30 days</h2>
          <ul className="space-y-2.5">
            {habitList
              .map((h) => ({ h, r: completionRate(h, valuesOf(checkins[h.id]), from30, today, today, ws) }))
              .sort((a, b) => (b.r ?? -1) - (a.r ?? -1))
              .map(({ h, r }) => (
                <li key={h.id} className="grid grid-cols-[11rem_1fr_3rem] items-center gap-3 text-sm" title={`${h.name}: ${pct(r)}`}>
                  <span className="truncate">
                    <span className="mr-2">{h.icon}</span>
                    {h.name}
                  </span>
                  <span className="h-2 overflow-hidden rounded-full bg-hover">
                    <span className="block h-full rounded-full" style={{ width: `${Math.round((r ?? 0) * 100)}%`, background: h.color }} />
                  </span>
                  <span className="text-right font-mono text-xs text-fg-2">{pct(r)}</span>
                </li>
              ))}
          </ul>
        </section>
      )}

      {sections.map((s) => (
        <div key={s.id}>{s.render()}</div>
      ))}
    </div>
  );
}

function Tile({ label, value, hint, tone }: { label: string; value: number | string; hint?: string; tone?: "danger" }) {
  return (
    <div className="rounded-md border border-border bg-surface-2 p-4 shadow-sm">
      <div className="text-xs text-muted">{label}</div>
      <div className={`mt-1 font-mono text-3xl font-semibold tabular-nums ${tone === "danger" ? "text-danger" : ""}`}>{value}</div>
      {hint && <div className="text-[0.7rem] text-muted">{hint}</div>}
    </div>
  );
}
