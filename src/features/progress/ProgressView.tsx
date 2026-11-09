import { format } from "date-fns";
import { Flame, Share2, Users } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import { AppIcon } from "../../components/ui/AppIcon";
import { BarChart } from "../../components/ui/BarChart";
import { Button } from "../../components/ui/Dialog";
import { PageHead } from "../../components/ui/PageHead";
import { ToolbarActions } from "../../components/ui/Toolbar";
import { Segmented } from "../../components/ui/Segmented";
import { addDaysLocal, fromLocalDate, toLocalDate, todayLocal } from "../../domain/dates";
import { completionRate } from "../../domain/habits";
import { weekStartOf } from "../../domain/perfect";
import { completedPerDay, completedPerWeek, type Bucket } from "../../domain/stats";
import { perfectSummary } from "../../lib/celebrate";
import { useData } from "../../stores/data";
import { useFocus } from "../../stores/focus";
import { useHabits, valuesOf } from "../../stores/habits";
import { useProgress } from "../../stores/progress";
import { useSettings } from "../../stores/settings";
import { TodayStreak } from "../celebrate/TodayStreak";
import { TrophyShelf } from "../celebrate/TrophyShelf";
import { Heatmap } from "./Heatmap";
import { ShareDialog } from "./ShareDialog";

/** Extra trend charts (focus time) contributed by other features. */
type Section = { id: string; render: () => ReactNode };
const sections: Section[] = [];
export const addProgressSection = (s: Section) => void (sections.some((x) => x.id === s.id) || sections.push(s));

const pct = (r: number | null) => (r === null ? "–" : `${Math.round(r * 100)}%`);
const HEAT_WEEKS = 30;

/** Progress (D166, D182): this week, streaks, trophies, trends, and a place for friends. */
export function ProgressView() {
  const tasks = useData((s) => s.tasks);
  const habits = useHabits((s) => s.habits);
  const checkins = useHabits((s) => s.checkins);
  const sessions = useFocus((s) => s.sessions);
  const restDays = useProgress((s) => s.restDays);
  const pushes = useProgress((s) => s.pushes);
  const ws = useSettings((s) => s.settings.weekStart);
  const today = todayLocal();
  const [range, setRange] = useState<"days" | "weeks">("days");
  const [sharing, setSharing] = useState(false);
  const all = useMemo(() => Object.values(tasks), [tasks]);

  const year = useMemo(() => completedPerDay(all, today, 366), [all, today]);
  const heat = useMemo(() => new Map(year.slice(-HEAT_WEEKS * 7 - 7).map((b) => [b.start, b.value])), [year]);
  const days = year.slice(-14);
  const weeks = useMemo(() => completedPerWeek(all, today, 12, ws), [all, today, ws]);
  // Read from the stores inside; recomputed when anything it reads changes.
  const perfect = useMemo(() => perfectSummary(), [tasks, checkins, restDays, pushes, ws, today]);
  const weekStart = weekStartOf(today, ws);
  const focusMinutes = useMemo(
    () => Object.values(sessions).reduce((n, s) => (toLocalDate(new Date(s.startAt)) >= weekStart ? n + s.seconds / 60 : n), 0),
    [sessions, weekStart],
  );
  const habitList = useMemo(() => Object.values(habits).filter((h) => !h.archived), [habits]);
  const from30 = addDaysLocal(today, -29);

  return (
    <div className="h-full overflow-y-auto px-[var(--gutter)] pb-10 pt-6">
      {sharing && <ShareDialog onClose={() => setSharing(false)} />}
      <ToolbarActions>
        <Button variant="secondary" onClick={() => setSharing(true)}>
          <Share2 size={16} strokeWidth={1.75} /> Share
        </Button>
      </ToolbarActions>
      <div className="mb-4">
        <PageHead title="Progress" sub={`This week, since ${format(fromLocalDate(weekStart), "EEEE d MMMM")}`}>
          <TodayStreak />
        </PageHead>
      </div>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(12rem,1fr))] gap-3">
        <Stat label="Tasks done" value={weeks[weeks.length - 1]?.value ?? 0} />
        <Stat label="Focus" value={`${Math.floor(focusMinutes / 60)}h ${Math.round(focusMinutes % 60)}m`} />
        <Stat label="Perfect days" value={perfect.thisWeek} />
        {/* The one big number on the page (.t-display): the perfect-day streak. */}
        <section className="card flex items-center gap-3">
          <Flame size={28} strokeWidth={1.75} className="shrink-0 text-streak" aria-hidden />
          <div>
            <div className="t-display leading-none">{perfect.run}</div>
            <div className="mt-1 text-[length:var(--fs-sm)] leading-tight text-muted">
              day streak · best <span className="tabular-nums">{perfect.best}</span>
            </div>
          </div>
        </section>

        <Card title="Trophies" hint="levels to climb" className="sm:col-span-2 lg:col-span-4">
          <TrophyShelf />
        </Card>

        <Card
          title="Tasks completed"
          className="sm:col-span-2"
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

        <Card title="Activity" hint={`last ${HEAT_WEEKS} weeks`} className="sm:col-span-2">
          <Heatmap values={heat} today={today} weeks={HEAT_WEEKS} weekStart={ws} />
        </Card>

        {habitList.length > 0 && (
          <Card title="Habit consistency" hint="last 30 days" className="sm:col-span-2">
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
          <div key={s.id} className="sm:col-span-2 lg:col-span-4">
            {s.render()}
          </div>
        ))}

        {/* Friends arrive in v1.1/v1.2; until then this is the place they'll appear (D182). */}
        <Card title="Friends" className="sm:col-span-2">
          <div className="empty py-4">
            <span className="eic">
              <Users size={18} strokeWidth={1.75} />
            </span>
            <h2>Sign in to add friends and compare your week</h2>
            <p>Friends see your streak, trophies and weekly total. Never your tasks. Accounts are coming in a later update.</p>
            <Button variant="secondary" disabled>
              Sign in
            </Button>
          </div>
        </Card>
      </div>
    </div>
  );
}

/** A stat tile: the label, then the value at --fs-xl (D198: only the streak uses the display size). */
function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <section className="card flex flex-col gap-0.5">
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
