import { addMonths, format, startOfMonth, startOfWeek } from "date-fns";
import { ChevronLeft, ChevronRight, Flame, Pencil, Trophy } from "lucide-react";
import { useMemo, useState } from "react";
import { viewDays } from "../../domain/calendar";
import { accentForeground } from "../../domain/color";
import { addDaysLocal, fromLocalDate, toLocalDate, todayLocal } from "../../domain/dates";
import { bestStreak, completionRate, currentStreak, frequencyLabel, goalLabel, isBuild, isDone, isScheduled, targetOf, unitOf, type CheckinMap, type Habit } from "../../domain/habits";
import type { WeekStart } from "../../domain/types";
import { useHabits, valuesOf } from "../../stores/habits";
import { useSettings } from "../../stores/settings";
import { MoodFace } from "./NoteButton";
import { IconTile } from "../../components/ui/AppIcon";

/**
 * Day fill. Build habits: none, partial, done (habit color mixed into the surface).
 * Limit/quit: the habit color while the day is fine, danger once over the cap or slipped.
 */
export function cellFill(h: Habit, value: number | undefined, scheduled: boolean): string {
  if (!isBuild(h)) return !scheduled && !value ? "transparent" : isDone(h, value) ? h.color : "var(--danger)";
  if (!value) return scheduled ? "var(--surface-2)" : "transparent";
  const ratio = Math.min(1, value / targetOf(h));
  return ratio >= 1 ? h.color : `color-mix(in oklch, ${h.color} ${Math.round(25 + ratio * 40)}%, var(--raised))`;
}

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
export function cellTitle(h: Habit, date: string, value: number | undefined) {
  const d = format(fromLocalDate(date), "EEE, MMM d");
  if (h.goal.kind === "once") return `${d}: ${value ? "done" : "not done"}`;
  if (h.goal.kind === "quit") return `${d}: ${value ? `${value} slip${value === 1 ? "" : "s"}` : "no slips"}`;
  return `${d}: ${fmt(value ?? 0)} / ${fmt(targetOf(h))} ${unitOf(h)}`.trimEnd();
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
    <div className="h-full space-y-6 overflow-y-auto p-6">
      <header className="flex items-center gap-3">
        <IconTile name={habit.icon} color={habit.color} size={48} />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[length:var(--fs-lg)] font-semibold">{habit.name}</h2>
          <p className="text-xs text-muted">
            {frequencyLabel(habit.frequency)}
            {goalLabel(habit.goal) && ` · ${goalLabel(habit.goal)}`}
          </p>
        </div>
        <button type="button" onClick={onEdit} aria-label="Edit habit" className="btn btn-ghost icon-btn text-muted">
          <Pencil size={16} />
        </button>
      </header>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(9rem,1fr))] gap-3">
        <Stat icon={<Flame size={15} className="text-streak" />} label="Current streak" value={cur.count} unit={`${cur.unit}${cur.count === 1 ? "" : "s"}`} />
        <Stat icon={<Trophy size={15} className="text-streak" />} label="Best streak" value={best.count} unit={`${best.unit}${best.count === 1 ? "" : "s"}`} />
        <Stat label="Last 30 days" value={rate30 === null ? "–" : Math.round(rate30 * 100)} unit={rate30 === null ? "" : "%"} />
        <Stat label={habit.goal.kind === "quit" ? "Slips" : habit.goal.kind === "limit" ? "Days logged" : "Check-ins"} value={total} unit="total" />
      </div>

      <MonthGrid habit={habit} values={values} ws={ws} />
      <YearHeatmap habit={habit} values={values} ws={ws} />

      {notes.length > 0 && (
        <section>
          <h3 className="mb-2 t-label text-muted">Notes</h3>
          <ul className="space-y-2">
            {notes.map((n) => (
              <li key={n.date} className="flex gap-3 text-sm">
                <span className="w-16 shrink-0 tabular-nums text-xs text-muted">{format(fromLocalDate(n.date), "MMM d")}</span>
                {n.mood && <MoodFace mood={n.mood} size={15} />}
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
    <div className="card p-3">
      <div className="flex items-center gap-1.5 whitespace-nowrap text-xs text-muted">
        {icon}
        {label}
      </div>
      <div className="mt-1 whitespace-nowrap text-[length:var(--fs-xl)] font-semibold leading-[var(--lh-xl)] tabular-nums">
        {value}
        <span className="ml-1 text-[length:var(--fs-sm)] font-normal text-muted">{unit}</span>
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
        <h3 className="min-w-0 flex-1 truncate whitespace-nowrap t-label text-muted">
          {format(fromLocalDate(month), "MMMM yyyy")} {rate !== null && <span className="ml-1 tabular-nums normal-case">· {Math.round(rate * 100)}%</span>}
        </h3>
        <button type="button" aria-label="Previous month" onClick={() => setMonth(toLocalDate(addMonths(fromLocalDate(month), -1)))} className="btn btn-ghost btn-sm icon-btn text-muted">
          <ChevronLeft size={15} />
        </button>
        <button type="button" aria-label="Next month" onClick={() => setMonth(toLocalDate(addMonths(fromLocalDate(month), 1)))} className="btn btn-ghost btn-sm icon-btn text-muted">
          <ChevronRight size={15} />
        </button>
      </div>
      <div className="grid max-w-md grid-cols-7 gap-1">
        {days.slice(0, 7).map((d) => (
          <span key={d} className="text-center text-[length:var(--fs-xs)] font-semibold text-muted">
            {format(fromLocalDate(d), "EEEEE")}
          </span>
        ))}
        {days.map((d) => {
          const inMonth = fromLocalDate(d).getMonth() === m;
          const v = values.get(d);
          const fill = d > today ? "transparent" : cellFill(habit, v, isScheduled(habit, d));
          const ink = fill === habit.color ? accentForeground(habit.color) : fill === "var(--danger)" ? "var(--danger-fg)" : "var(--fg-2)";
          return (
            <div
              key={d}
              title={cellTitle(habit, d, v)}
              className={`grid aspect-square place-items-center rounded-control tabular-nums text-xs ${inMonth ? "" : "opacity-30"} ${d === today ? "ring-2 ring-accent-text" : ""}`}
              style={{ background: fill, color: ink }}
            >
              {format(fromLocalDate(d), "d")}
            </div>
          );
        })}
      </div>
    </section>
  );
}

/** 53-week contribution-style heatmap ending this week. Fluid like the Progress heatmap: HTML cells with CSS fills, no fixed pixel width. */
function YearHeatmap({ habit, values, ws }: { habit: Habit; values: CheckinMap; ws: WeekStart }) {
  const today = todayLocal();
  const firstWeek = toLocalDate(startOfWeek(fromLocalDate(addDaysLocal(today, -364)), { weekStartsOn: ws }));
  const weeks = Array.from({ length: 53 }, (_, w) => addDaysLocal(firstWeek, w * 7));
  const quit = habit.goal.kind === "quit";
  return (
    <section>
      <h3 className="mb-2 t-label text-muted">Past year</h3>
      <div className="grid gap-[3px]" style={{ gridTemplateColumns: "repeat(53, minmax(0, 1fr))" }} role="img" aria-label={`${habit.name}: daily check-ins over the past year`}>
        {weeks.map((w) => (
          <div key={w} className="flex flex-col gap-[3px]">
            <span className="h-4 whitespace-nowrap text-[length:var(--fs-xs)] leading-4 text-muted">{fromLocalDate(w).getDate() <= 7 ? format(fromLocalDate(w), "MMM") : ""}</span>
            {Array.from({ length: 7 }, (_, di) => {
              const d = addDaysLocal(w, di);
              if (d > today) return <span key={d} className="aspect-square" />;
              const v = values.get(d);
              return <span key={d} title={cellTitle(habit, d, v)} className="aspect-square rounded-[2px]" style={{ background: cellFill(habit, v, isScheduled(habit, d)) }} />;
            })}
          </div>
        ))}
      </div>
      <div className="mt-2 flex items-center justify-end gap-1.5 text-[length:var(--fs-xs)] text-muted">
        {isBuild(habit) ? (
          <>
            Less
            {[undefined, 0.3, 0.7, 1].map((r, i) => (
              <span key={i} className="size-2.5 rounded-[3px]" style={{ background: cellFill(habit, r === undefined ? undefined : r * targetOf(habit), true) }} />
            ))}
            More
          </>
        ) : (
          [
            [quit ? "No slip" : "Within limit", habit.color],
            [quit ? "Slipped" : "Over", "var(--danger)"],
          ].map(([label, bg], i) => (
            <span key={label} className={`inline-flex items-center gap-1.5 ${i ? "ml-2" : ""}`}>
              <span className="size-2.5 rounded-[3px]" style={{ background: bg }} />
              {label}
            </span>
          ))
        )}
      </div>
    </section>
  );
}
