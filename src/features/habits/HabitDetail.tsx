import { addMonths, format, startOfMonth, startOfWeek } from "date-fns";
import { ChevronLeft, ChevronRight, Flame, Pencil, Trophy } from "lucide-react";
import { useMemo, useState } from "react";
import { viewDays } from "../../domain/calendar";
import { accentForeground } from "../../domain/color";
import { addDaysLocal, fromLocalDate, toLocalDate, todayLocal } from "../../domain/dates";
import { bestStreak, completionRate, currentStreak, frequencyLabel, isScheduled, targetOf, type CheckinMap, type Habit } from "../../domain/habits";
import type { WeekStart } from "../../domain/types";
import { useHabits, valuesOf } from "../../stores/habits";
import { useSettings } from "../../stores/settings";
import { MOOD_EMOJI } from "./NoteButton";

/** Sequential single-hue fill: none → partial → done (habit color mixed into the surface). */
export function cellFill(h: Habit, value: number | undefined, scheduled: boolean): string {
  if (!value) return scheduled ? "var(--hover)" : "transparent";
  const ratio = Math.min(1, value / targetOf(h));
  return ratio >= 1 ? h.color : `color-mix(in oklch, ${h.color} ${Math.round(25 + ratio * 40)}%, var(--surface-2))`;
}

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
export function cellTitle(h: Habit, date: string, value: number | undefined) {
  const d = format(fromLocalDate(date), "EEE, MMM d");
  if (h.goal.kind === "once") return `${d}: ${value ? "done" : "not done"}`;
  return `${d}: ${fmt(value ?? 0)} / ${fmt(targetOf(h))} ${h.goal.unit}`;
}

export function HabitDetail({ habit, onEdit }: { habit: Habit; onEdit: () => void }) {
  const records = useHabits((s) => s.checkins[habit.id]);
  const values = valuesOf(records);
  const ws = useSettings((s) => s.settings.weekStart);
  const today = todayLocal();
  const cur = currentStreak(habit, values, today, ws);
  const best = bestStreak(habit, values, today, ws);
  const rate30 = completionRate(habit, values, addDaysLocal(today, -29), today, today, ws);
  const total = [...values.values()].filter((v) => v > 0).length;
  const notes = useMemo(
    () =>
      Object.values(records ?? {})
        .filter((c) => c.note || c.mood)
        .sort((a, b) => b.date.localeCompare(a.date))
        .slice(0, 8),
    [records],
  );

  return (
    <div className="scroll-thin h-full space-y-6 overflow-y-auto p-6">
      <header className="flex items-center gap-3">
        <span className="grid size-12 place-items-center rounded-md text-2xl" style={{ background: `color-mix(in oklch, ${habit.color} 18%, transparent)` }}>
          {habit.icon}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-lg font-semibold">{habit.name}</h2>
          <p className="text-xs text-muted">
            {frequencyLabel(habit.frequency)}
            {habit.goal.kind !== "once" && ` · ${fmt(habit.goal.target)} ${habit.goal.unit} a day`}
          </p>
        </div>
        <button type="button" onClick={onEdit} aria-label="Edit habit" className="grid size-9 place-items-center rounded-sm text-muted hover:bg-hover hover:text-fg">
          <Pencil size={16} />
        </button>
      </header>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat icon={<Flame size={15} className="text-p3" />} label="Current streak" value={cur.count} unit={`${cur.unit}${cur.count === 1 ? "" : "s"}`} />
        <Stat icon={<Trophy size={15} className="text-p2" />} label="Best streak" value={best.count} unit={`${best.unit}${best.count === 1 ? "" : "s"}`} />
        <Stat label="Last 30 days" value={rate30 === null ? "–" : Math.round(rate30 * 100)} unit={rate30 === null ? "" : "%"} />
        <Stat label="Check-ins" value={total} unit="total" />
      </div>

      <MonthGrid habit={habit} values={values} ws={ws} />
      <YearHeatmap habit={habit} values={values} ws={ws} />

      {notes.length > 0 && (
        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">Notes</h3>
          <ul className="space-y-2">
            {notes.map((n) => (
              <li key={n.date} className="flex gap-3 text-sm">
                <span className="w-16 shrink-0 font-mono text-xs text-muted">{format(fromLocalDate(n.date), "MMM d")}</span>
                {n.mood && <span aria-label={`Mood ${n.mood} of 5`}>{MOOD_EMOJI[n.mood - 1]}</span>}
                <span className="text-fg-2">{n.note}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function Stat({ icon, label, value, unit }: { icon?: React.ReactNode; label: string; value: number | string; unit: string }) {
  return (
    <div className="rounded-md border border-border bg-surface-2 p-3 shadow-sm">
      <div className="flex items-center gap-1.5 text-xs text-muted">
        {icon}
        {label}
      </div>
      <div className="mt-1 font-mono text-2xl font-semibold tabular-nums">
        {value}
        <span className="ml-1 font-sans text-xs font-normal text-muted">{unit}</span>
      </div>
    </div>
  );
}

function MonthGrid({ habit, values, ws }: { habit: Habit; values: CheckinMap; ws: WeekStart }) {
  const [month, setMonth] = useState(() => toLocalDate(startOfMonth(new Date())));
  const days = viewDays("month", month, ws);
  const m = fromLocalDate(month).getMonth();
  const today = todayLocal();
  const rate = completionRate(habit, values, month, toLocalDate(addMonths(fromLocalDate(month), 1)), today, ws);
  return (
    <section>
      <div className="mb-2 flex items-center gap-1">
        <h3 className="flex-1 text-xs font-semibold uppercase tracking-wider text-muted">
          {format(fromLocalDate(month), "MMMM yyyy")} {rate !== null && <span className="ml-1 font-mono normal-case">· {Math.round(rate * 100)}%</span>}
        </h3>
        <button type="button" aria-label="Previous month" onClick={() => setMonth(toLocalDate(addMonths(fromLocalDate(month), -1)))} className="grid size-7 place-items-center rounded-sm text-muted hover:bg-hover">
          <ChevronLeft size={15} />
        </button>
        <button type="button" aria-label="Next month" onClick={() => setMonth(toLocalDate(addMonths(fromLocalDate(month), 1)))} className="grid size-7 place-items-center rounded-sm text-muted hover:bg-hover">
          <ChevronRight size={15} />
        </button>
      </div>
      <div className="grid max-w-md grid-cols-7 gap-1">
        {days.slice(0, 7).map((d) => (
          <span key={d} className="text-center text-[0.65rem] font-semibold text-muted">
            {format(fromLocalDate(d), "EEEEE")}
          </span>
        ))}
        {days.map((d) => {
          const inMonth = fromLocalDate(d).getMonth() === m;
          const v = values.get(d);
          const done = !!v && v >= targetOf(habit);
          return (
            <div
              key={d}
              title={cellTitle(habit, d, v)}
              className={`grid aspect-square place-items-center rounded-sm font-mono text-xs ${inMonth ? "" : "opacity-30"} ${d === today ? "ring-2 ring-accent" : ""}`}
              style={{ background: d > today ? "transparent" : cellFill(habit, v, isScheduled(habit, d)), color: done ? accentForeground(habit.color) : "var(--fg-2)" }}
            >
              {format(fromLocalDate(d), "d")}
            </div>
          );
        })}
      </div>
    </section>
  );
}

const CELL = 11;
const GAP = 2;

/** 53-week contribution-style heatmap ending this week. */
function YearHeatmap({ habit, values, ws }: { habit: Habit; values: CheckinMap; ws: WeekStart }) {
  const today = todayLocal();
  const firstWeek = toLocalDate(startOfWeek(fromLocalDate(addDaysLocal(today, -364)), { weekStartsOn: ws }));
  const weeks = Array.from({ length: 53 }, (_, w) => addDaysLocal(firstWeek, w * 7));
  const width = weeks.length * (CELL + GAP);
  const height = 7 * (CELL + GAP) + 14;
  return (
    <section>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">Past year</h3>
      <div className="scroll-thin overflow-x-auto">
        <svg width={width} height={height} role="img" aria-label={`${habit.name}: daily check-ins over the past year`}>
          {weeks.map((w, wi) => {
            const d0 = fromLocalDate(w);
            const showMonth = d0.getDate() <= 7;
            return (
              <g key={w} transform={`translate(${wi * (CELL + GAP)}, 0)`}>
                {showMonth && (
                  <text y={9} className="fill-[var(--fg-muted)] text-[9px]">
                    {format(d0, "MMM")}
                  </text>
                )}
                {Array.from({ length: 7 }, (_, di) => {
                  const d = addDaysLocal(w, di);
                  if (d > today) return null;
                  const v = values.get(d);
                  return (
                    <rect key={d} y={14 + di * (CELL + GAP)} width={CELL} height={CELL} rx={2.5} fill={cellFill(habit, v, isScheduled(habit, d))}>
                      <title>{cellTitle(habit, d, v)}</title>
                    </rect>
                  );
                })}
              </g>
            );
          })}
        </svg>
      </div>
      <div className="mt-2 flex items-center gap-1.5 text-[0.65rem] text-muted">
        Less
        {[undefined, 0.3, 0.7, 1].map((r, i) => (
          <span key={i} className="size-2.5 rounded-[3px]" style={{ background: cellFill(habit, r === undefined ? undefined : r * targetOf(habit), true) }} />
        ))}
        More
      </div>
    </section>
  );
}
