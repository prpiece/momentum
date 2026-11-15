import { format, startOfWeek } from "date-fns";
import { type ReactNode, useMemo, useState } from "react";
import { AppIcon } from "../../components/ui/AppIcon";
import { BarChart } from "../../components/ui/BarChart";
import { PageHead } from "../../components/ui/PageHead";
import { Segmented } from "../../components/ui/Segmented";
import { addDaysLocal, formatMinutes, fromLocalDate, toLocalDate, todayLocal } from "../../domain/dates";
import { completionRate } from "../../domain/habits";
import { completedPerDay, completedPerWeek, sessionDay, type Bucket } from "../../domain/stats";
import { useData } from "../../stores/data";
import { useFocus } from "../../stores/focus";
import { useHabits, valuesOf } from "../../stores/habits";
import { useSettings } from "../../stores/settings";
import { Heatmap } from "./Heatmap";

/** Extra trend charts (focus time) contributed by other features. */
type Section = { id: string; render: () => ReactNode };
const sections: Section[] = [];
export const addProgressSection = (s: Section) => void (sections.some((x) => x.id === s.id) || sections.push(s));

const pct = (r: number | null) => (r === null ? "–" : `${Math.round(r * 100)}%`);
const HEAT_WEEKS = 30;

/** Progress (D166, D256): plain statistics. Completions over time, focus time and the heatmap; no scores. */
export function ProgressView() {
  const tasks = useData((s) => s.tasks);
  const habits = useHabits((s) => s.habits);
  const checkins = useHabits((s) => s.checkins);
  const sessions = useFocus((s) => s.sessions);
  const ws = useSettings((s) => s.settings.weekStart);
  const today = todayLocal();
  const [range, setRange] = useState<"days" | "weeks">("days");
  const all = useMemo(() => Object.values(tasks), [tasks]);

  const year = useMemo(() => completedPerDay(all, today, 366), [all, today]);
  const heat = useMemo(() => new Map(year.slice(-HEAT_WEEKS * 7 - 7).map((b) => [b.start, b.value])), [year]);
  const days = year.slice(-14);
  const weeks = useMemo(() => completedPerWeek(all, today, 12, ws), [all, today, ws]);
  const weekStart = toLocalDate(startOfWeek(fromLocalDate(today), { weekStartsOn: ws }));
  const focusMinutes = useMemo(
    () => Object.values(sessions).reduce((n, s) => (sessionDay(s.startAt) >= weekStart ? n + s.seconds / 60 : n), 0),
    [sessions, weekStart],
  );
  const habitList = useMemo(() => Object.values(habits).filter((h) => !h.archived), [habits]);
  const from30 = addDaysLocal(today, -29);

  return (
    <div className="h-full overflow-y-auto px-[var(--gutter)] pb-10 pt-6">
      <div className="mb-4">
        <PageHead title="Progress" sub={`This week, since ${format(fromLocalDate(weekStart), "EEEE d MMMM")}`} />
      </div>

      <div className="grid grid-cols-1 gap-3 min-[720px]:grid-cols-4">
        <Stat label="Tasks done" className="min-[720px]:col-span-2" value={weeks[weeks.length - 1]?.value ?? 0} />
        <Stat label="Focus" className="min-[720px]:col-span-2" value={formatMinutes(focusMinutes)} />
        <Card
          title="Tasks completed"
          className="min-[720px]:col-span-2"
          action={
            <Segmented
              name="progress-range"
              label="Range"
              value={range}
              onChange={setRange}
              options={[
                { value: "days", label: "14 days" },
                { value: "weeks", label: "12 weeks" },
              ]}
            />
          }
        >
          {range === "days" ? (
            <BarChart
              key="days"
              title="Tasks completed per day, last 14 days"
              data={days}
              label={(b: Bucket) => format(fromLocalDate(b.start), "EEE, MMM d")}
              tick={(b, i) => (i % 2 === 1 || b.start === today ? "" : format(fromLocalDate(b.start), "d MMM"))}
            />
          ) : (
            <BarChart
              key="weeks"
              title="Tasks completed per week, last 12 weeks"
              data={weeks}
              label={(b) => `Week of ${format(fromLocalDate(b.start), "MMM d")}`}
              tick={(b, i) => (i % 2 === 0 ? format(fromLocalDate(b.start), "MMM d") : "")}
            />
          )}
        </Card>

        <Card title="Activity" hint={`last ${HEAT_WEEKS} weeks`} className="min-[720px]:col-span-2">
          <Heatmap values={heat} today={today} weeks={HEAT_WEEKS} weekStart={ws} />
        </Card>

        {habitList.length > 0 && (
          <Card title="Habit consistency" hint="last 30 days" className="min-[720px]:col-span-4">
            <ul className="flex flex-col gap-2.5">
              {habitList
                .map((h) => ({ h, r: completionRate(h, valuesOf(checkins[h.id]), from30, today, today, ws) }))
                .sort((a, b) => (b.r ?? -1) - (a.r ?? -1))
                .map(({ h, r }) => (
                  <li key={h.id} className="grid grid-cols-[1fr_64px_36px] items-center gap-2.5 text-[length:var(--fs-sm)]" title={`${h.name}: ${pct(r)}`}>
                    <span className="flex min-w-0 items-center gap-2">
                      <AppIcon name={h.icon} size={14} color={h.color} />
                      <span className="truncate">{h.name}</span>
                    </span>
                    <span className="bar">
                      <span style={{ width: `${Math.round((r ?? 0) * 100)}%`, background: h.color }} />
                    </span>
                    <span className="text-right tabular-nums text-fg-2">{pct(r)}</span>
                  </li>
                ))}
            </ul>
          </Card>
        )}

        {sections.map((s) => (
          <div key={s.id} className="min-[720px]:col-span-4">
            {s.render()}
          </div>
        ))}

      </div>
    </div>
  );
}

/** A stat tile: the label, then the value at --fs-xl. */
function Stat({ label, value, className = "" }: { label: string; value: ReactNode; className?: string }) {
  return (
    <section className={`card flex flex-col gap-0.5 ${className}`}>
      <h3 className="t-label text-muted">{label}</h3>
      <div className="text-[length:var(--fs-xl)] font-semibold leading-[var(--lh-xl)] tabular-nums">{value}</div>
    </section>
  );
}

function Card({ title, hint, action, className = "", children }: { title: string; hint?: string; action?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <section className={`card ${className}`}>
      <div className="card-h flex-wrap justify-start gap-x-3">
        <h3>{title}</h3>
        {hint && <span className="text-[length:var(--fs-sm)] text-muted">{hint}</span>}
        <div className="ml-auto">{action}</div>
      </div>
      {children}
    </section>
  );
}
