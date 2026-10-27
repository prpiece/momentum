import { format } from "date-fns";
import { ArrowDownRight, ArrowUpRight, CalendarCheck2, CircleCheckBig, Flame, ListTodo, Trophy, TriangleAlert, type LucideIcon } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import { AppIcon, ListGlyph } from "../../components/ui/AppIcon";
import { BarChart } from "../../components/ui/BarChart";
import { Donut } from "../../components/ui/Donut";
import { addDaysLocal, fromLocalDate, todayLocal } from "../../domain/dates";
import { completionRate } from "../../domain/habits";
import { byWeekday, completedByList, completedPerDay, completedPerWeek, dayStreaks, habitConsistency, type Bucket } from "../../domain/stats";
import { isOverdue } from "../../domain/taskViews";
import { PRIORITY_LABEL } from "../../domain/types";
import { useData } from "../../stores/data";
import { useHabits, valuesOf } from "../../stores/habits";
import { useSettings } from "../../stores/settings";
import { useDerived } from "../tasks/selectors";
import { Heatmap } from "./Heatmap";

/** Extra stat sections (focus time) contributed by later features. */
type Section = { id: string; render: () => React.ReactNode };
const sections: Section[] = [];
export const addStatsSection = (s: Section) => void (sections.some((x) => x.id === s.id) || sections.push(s));

const pct = (r: number | null) => (r === null ? "–" : `${Math.round(r * 100)}%`);
const HEAT_WEEKS = 30;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** One line of encouragement, picked from the numbers. */
function cheer(streak: number, best: number, doneToday: number, thisWeek: number, lastWeek: number): string {
  if (streak > 0 && streak >= best && streak > 2) return `New personal best: ${streak} days in a row. Keep the chain going!`;
  if (streak > 0 && doneToday === 0) return `Finish one task today to make it ${streak + 1} days in a row.`;
  if (thisWeek > lastWeek && lastWeek > 0) return `You're ahead of last week by ${thisWeek - lastWeek} task${thisWeek - lastWeek === 1 ? "" : "s"}. Nice momentum.`;
  if (streak > 0) return `${streak} day${streak === 1 ? "" : "s"} in a row. Small steps add up.`;
  return "Every streak starts with one task. Pick an easy one and check it off.";
}

export function StatsView() {
  const tasks = useData((s) => s.tasks);
  const lists = useData((s) => s.lists);
  const derived = useDerived();
  const habits = useHabits((s) => s.habits);
  const checkins = useHabits((s) => s.checkins);
  const ws = useSettings((s) => s.settings.weekStart);
  const today = todayLocal();
  const [range, setRange] = useState<"days" | "weeks">("days");
  const all = useMemo(() => Object.values(tasks), [tasks]);

  const year = useMemo(() => completedPerDay(all, today, 366), [all, today]);
  const heat = useMemo(() => new Map(year.slice(-HEAT_WEEKS * 7 - 7).map((b) => [b.start, b.value])), [year]);
  const days = year.slice(-14);
  const weeks = useMemo(() => completedPerWeek(all, today, 12, ws), [all, today, ws]);
  const streak = useMemo(() => dayStreaks(year), [year]);
  const weekday = useMemo(() => {
    const sums = byWeekday(year.slice(-84));
    const order = Array.from({ length: 7 }, (_, i) => (ws + i) % 7);
    return order.map((d): Bucket => ({ start: WEEKDAYS[d], label: WEEKDAYS[d], value: sums[d] }));
  }, [year, ws]);
  const perList = useMemo(() => completedByList(all, addDaysLocal(today, -29)), [all, today]);

  const doneToday = days[days.length - 1]?.value ?? 0;
  const thisWeek = weeks[weeks.length - 1]?.value ?? 0;
  const lastWeek = weeks[weeks.length - 2]?.value ?? 0;
  const totalDone = year.reduce((n, b) => n + b.value, 0);
  const openVMs = derived.active.filter((v) => v.task.status === "open");
  const overdue = derived.active.filter((v) => isOverdue(v, today)).length;
  const habitList = useMemo(() => Object.values(habits).filter((h) => !h.archived), [habits]);
  const from30 = addDaysLocal(today, -29);
  const consistency = habitConsistency(habitList, (id) => valuesOf(checkins[id]), from30, today, today, ws);
  const bestDay = weekday.reduce((a, b) => (b.value > a.value ? b : a), weekday[0]);
  const prio = ([3, 2, 1, 0] as const).map((p) => ({ label: PRIORITY_LABEL[p], value: openVMs.filter((v) => v.task.priority === p).length, color: p ? `var(--p${p})` : "var(--fg-muted)" }));
  const listMax = Math.max(1, ...perList.map((l) => l.value));

  return (
    <div className="scroll-thin h-full overflow-y-auto px-6 pb-10">
      {/* Hero: the streak and a line of encouragement. */}
      <section
        className="anim-rise relative overflow-hidden rounded-lg border border-border p-6 shadow-sm"
        style={{ background: "linear-gradient(135deg, color-mix(in oklch, var(--accent) 22%, var(--surface-2)), var(--surface-2) 70%)" }}
      >
        <div className="flex flex-wrap items-center gap-6">
          <div className="relative grid size-20 shrink-0 place-items-center rounded-full bg-accent text-accent-fg shadow-lg">
            <Flame size={38} className={streak.current ? "anim-flicker" : "opacity-70"} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2">
              <span className="font-mono text-5xl font-semibold tabular-nums tracking-tight">{streak.current}</span>
              <span className="text-lg font-semibold text-fg-2">day streak</span>
            </div>
            <p className="mt-1 text-sm text-fg-2">{cheer(streak.current, streak.best, doneToday, thisWeek, lastWeek)}</p>
          </div>
          <div className="flex gap-6">
            <HeroStat icon={Trophy} label="Best streak" value={`${streak.best}d`} />
            <HeroStat icon={CircleCheckBig} label="Done this year" value={totalDone} />
          </div>
        </div>
      </section>

      <div className="mt-4 grid grid-cols-[repeat(auto-fit,minmax(9.5rem,1fr))] gap-3">
        <Tile i={0} icon={CalendarCheck2} label="Completed today" value={doneToday} tint="var(--accent)" />
        <Tile
          i={1}
          icon={thisWeek >= lastWeek ? ArrowUpRight : ArrowDownRight}
          label="This week"
          value={thisWeek}
          tint={thisWeek >= lastWeek ? "var(--success)" : "var(--p2)"}
          hint={lastWeek ? `${thisWeek >= lastWeek ? "+" : ""}${Math.round(((thisWeek - lastWeek) / lastWeek) * 100)}% vs last week` : "first week tracked"}
        />
        <Tile i={2} icon={ListTodo} label="Open tasks" value={openVMs.length} tint="var(--p1)" />
        <Tile i={3} icon={TriangleAlert} label="Overdue" value={overdue} tint="var(--danger)" tone={overdue ? "danger" : undefined} />
        <div className="anim-rise flex items-center gap-3 rounded-md border border-border bg-surface-2 p-4 shadow-sm lg:col-span-1" style={{ animationDelay: "160ms", animationFillMode: "backwards" }}>
          <Ring value={consistency ?? 0} />
          <div>
            <div className="text-xs text-muted">Habit consistency</div>
            <div className="font-mono text-2xl font-semibold tabular-nums">{pct(consistency)}</div>
            <div className="text-[0.7rem] text-muted">last 30 days</div>
          </div>
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card
          title="Tasks completed"
          className="lg:col-span-2"
          action={
            <div role="radiogroup" aria-label="Range" className="flex rounded-sm border border-border bg-bg p-0.5">
              {(["days", "weeks"] as const).map((r) => (
                <button key={r} type="button" role="radio" aria-checked={range === r} onClick={() => setRange(r)} className={`h-7 rounded-[6px] px-3 text-xs transition-colors ${range === r ? "bg-surface-2 font-semibold shadow-sm" : "text-muted hover:text-fg"}`}>
                  {r === "days" ? "14 days" : "12 weeks"}
                </button>
              ))}
            </div>
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

        <Card title="Activity" hint={`last ${HEAT_WEEKS} weeks`} className="lg:col-span-2">
          <Heatmap values={heat} today={today} weeks={HEAT_WEEKS} weekStart={ws} />
        </Card>

        <Card title="Best day of the week" hint={bestDay?.value ? `${bestDay.label} is your strongest day` : "last 12 weeks"}>
          <BarChart title="Tasks completed per weekday, last 12 weeks" data={weekday} label={(b) => `${b.label}s`} tick={(b) => b.label} color="var(--p1)" height={180} width={340} />
        </Card>

        <Card title="Open tasks by priority">
          <Donut data={prio} title="Open tasks by priority" center="open" />
        </Card>

        <Card title="Where your work went" hint="completed, last 30 days">
          {perList.length ? (
            <ul className="space-y-2.5">
              {perList.slice(0, 7).map(({ listId, value }, i) => {
                const l = lists[listId];
                return (
                  <li key={listId} className="grid grid-cols-[9rem_1fr_2.5rem] items-center gap-3 text-sm">
                    <span className="flex min-w-0 items-center gap-2">
                      <ListGlyph icon={l?.icon ?? null} color={l?.color ?? null} size={14} />
                      <span className="truncate">{l?.name ?? "Deleted list"}</span>
                    </span>
                    <span className="h-2 overflow-hidden rounded-full bg-hover">
                      <span className="anim-grow-x block h-full rounded-full" style={{ width: `${(value / listMax) * 100}%`, background: l?.color ?? "var(--accent)", animationDelay: `${i * 60}ms` }} />
                    </span>
                    <span className="text-right font-mono text-xs text-fg-2">{value}</span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-sm text-muted">Complete a few tasks and your lists show up here.</p>
          )}
        </Card>

        {habitList.length > 0 && (
          <Card title="Habit consistency" hint="last 30 days">
            <ul className="space-y-2.5">
              {habitList
                .map((h) => ({ h, r: completionRate(h, valuesOf(checkins[h.id]), from30, today, today, ws) }))
                .sort((a, b) => (b.r ?? -1) - (a.r ?? -1))
                .map(({ h, r }, i) => (
                  <li key={h.id} className="grid grid-cols-[9rem_1fr_2.5rem] items-center gap-3 text-sm" title={`${h.name}: ${pct(r)}`}>
                    <span className="flex min-w-0 items-center gap-2">
                      <AppIcon name={h.icon} size={14} color={h.color} />
                      <span className="truncate">{h.name}</span>
                    </span>
                    <span className="h-2 overflow-hidden rounded-full bg-hover">
                      <span className="anim-grow-x block h-full rounded-full" style={{ width: `${Math.round((r ?? 0) * 100)}%`, background: h.color, animationDelay: `${i * 60}ms` }} />
                    </span>
                    <span className="text-right font-mono text-xs text-fg-2">{pct(r)}</span>
                  </li>
                ))}
            </ul>
          </Card>
        )}
      </div>

      {sections.map((s) => (
        <div key={s.id}>{s.render()}</div>
      ))}
    </div>
  );
}

function HeroStat({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: ReactNode }) {
  return (
    <div className="text-center">
      <Icon size={16} className="mx-auto text-accent" />
      <div className="mt-1 font-mono text-xl font-semibold tabular-nums">{value}</div>
      <div className="text-[0.7rem] text-muted">{label}</div>
    </div>
  );
}

function Card({ title, hint, action, className = "", children }: { title: string; hint?: string; action?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <section className={`anim-rise rounded-lg border border-border bg-surface-2 p-5 shadow-sm ${className}`}>
      <div className="mb-3 flex items-center gap-3">
        <h2 className="text-sm font-semibold">{title}</h2>
        {hint && <span className="text-xs text-muted">{hint}</span>}
        <div className="ml-auto">{action}</div>
      </div>
      {children}
    </section>
  );
}

function Tile({ i, icon: Icon, label, value, hint, tint, tone }: { i: number; icon: LucideIcon; label: string; value: number | string; hint?: string; tint: string; tone?: "danger" }) {
  return (
    <div className="anim-rise rounded-md border border-border bg-surface-2 p-4 shadow-sm" style={{ animationDelay: `${i * 40}ms`, animationFillMode: "backwards" }}>
      <div className="flex items-center gap-2 text-xs text-muted">
        <span className="grid size-6 place-items-center rounded-full" style={{ background: `color-mix(in oklch, ${tint} 16%, transparent)`, color: tint }}>
          <Icon size={13} />
        </span>
        {label}
      </div>
      <div className={`mt-1.5 font-mono text-3xl font-semibold tabular-nums ${tone === "danger" ? "text-danger" : ""}`}>{value}</div>
      {hint && <div className="text-[0.7rem] text-muted">{hint}</div>}
    </div>
  );
}

function Ring({ value }: { value: number }) {
  const R = 20;
  const C = 2 * Math.PI * R;
  return (
    <svg viewBox="0 0 48 48" className="size-12 shrink-0 -rotate-90" aria-hidden="true">
      <circle cx={24} cy={24} r={R} fill="none" stroke="var(--hover)" strokeWidth={5} />
      <circle cx={24} cy={24} r={R} fill="none" stroke="var(--success)" strokeWidth={5} strokeLinecap="round" strokeDasharray={`${C * value} ${C}`} className="anim-ring" style={{ ["--ring-c" as string]: C }} />
    </svg>
  );
}
