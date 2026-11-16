import { addMonths, endOfMonth, format, startOfMonth, startOfWeek } from "date-fns";
import { ChevronLeft, ChevronRight, Flame, Pause, Pencil, X } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { viewDays } from "../../domain/calendar";
import { accentForeground } from "../../domain/color";
import { addDaysLocal, fromLocalDate, toLocalDate, todayLocal } from "../../domain/dates";
import { bestStreak, completionRate, currentStreak, daysSinceSlip, frequencyLabel, goalLabel, isBuild, isDone, isPausedOn, isScheduled, targetOf, unitOf, type CheckinMap, type Habit } from "../../domain/habits";
import type { WeekStart } from "../../domain/types";
import { useHabits, valuesOf } from "../../stores/habits";
import { useSettings } from "../../stores/settings";
import { CheckinButton } from "./CheckinButton";
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
  const since = daysSinceSlip(habit, values, today);
  const [editDay, setEditDay] = useState<string | null>(null);
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
            {isPausedOn(habit, today) && (
              <span className="ml-2 inline-flex items-center gap-1">
                <Pause size={12} strokeWidth={1.75} aria-hidden /> Paused
              </span>
            )}
          </p>
        </div>
        <button type="button" onClick={onEdit} aria-label="Edit habit" className="btn btn-ghost icon-btn text-muted">
          <Pencil size={16} />
        </button>
      </header>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(9rem,1fr))] gap-3">
        {since && <Stat label={since.slipped ? "Since last slip" : "No slips yet"} value={since.days} unit={`day${since.days === 1 ? "" : "s"}`} />}
        <Stat icon={<Flame size={15} className="text-streak" />} label="Current streak" value={cur.count} unit={`${cur.unit}${cur.count === 1 ? "" : "s"}`} />
        <Stat label="Best streak" value={best.count} unit={`${best.unit}${best.count === 1 ? "" : "s"}`} />
        <Stat label="Last 30 days" value={rate30 === null ? "–" : Math.round(rate30 * 100)} unit={rate30 === null ? "" : "%"} />
        <Stat label={habit.goal.kind === "quit" ? "Slips" : habit.goal.kind === "limit" ? "Days logged" : "Check-ins"} value={total} unit="total" />
      </div>

      <MonthGrid habit={habit} values={values} ws={ws} onPick={setEditDay} picked={editDay} />
      <YearHeatmap habit={habit} values={values} ws={ws} onPick={setEditDay} picked={editDay} />
      {editDay && (
        <div className="card flex items-center gap-3 p-3">
          <span className="min-w-0 flex-1 truncate text-sm">{cellTitle(habit, editDay, values.get(editDay))}</span>
          <CheckinButton habit={habit} date={editDay} size={32} />
          <button type="button" aria-label="Close day editor" onClick={() => setEditDay(null)} className="btn btn-ghost btn-sm icon-btn text-muted">
            <X size={14} />
          </button>
        </div>
      )}

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

type DayPick = { onPick: (d: string) => void; picked: string | null };

// Past days only (HAB-22): click one to check in or fix its value.
function MonthGrid({ habit, values, ws, onPick, picked }: { habit: Habit; values: CheckinMap; ws: WeekStart } & DayPick) {
  const [month, setMonth] = useState(() => toLocalDate(startOfMonth(fromLocalDate(todayLocal()))));
  const days = viewDays("month", month, ws);
  const m = fromLocalDate(month).getMonth();
  const today = todayLocal();
  const rate = completionRate(habit, values, month, toLocalDate(endOfMonth(fromLocalDate(month))), today, ws);
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
            <button
              key={d}
              type="button"
              disabled={d > today}
              onClick={() => onPick(d)}
              title={cellTitle(habit, d, v)}
              aria-label={cellTitle(habit, d, v)}
              className={`grid aspect-square place-items-center rounded-control tabular-nums text-xs ${inMonth ? "" : "opacity-30"} ${d === today || d === picked ? "ring-2 ring-accent-text" : ""} ${d > today ? "cursor-default" : ""}`}
              style={{ background: fill, color: ink }}
            >
              {format(fromLocalDate(d), "d")}
            </button>
          );
        })}
      </div>
    </section>
  );
}

/** 53-week contribution-style heatmap ending this week. Fluid like the Progress heatmap: HTML cells with CSS fills, no fixed pixel width. */
// Readable fixed cells; the map shows as many recent weeks as the panel fits (53 squeezed into a side panel became ~4px specks).
const CELL = 11;
const GAP = 3;

function YearHeatmap({ habit, values, ws, onPick, picked }: { habit: Habit; values: CheckinMap; ws: WeekStart } & DayPick) {
  const today = todayLocal();
  const [width, setWidth] = useState(0);
  const ref = useCallback((el: HTMLElement | null) => {
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  const count = Math.max(8, Math.min(53, Math.floor((width + GAP) / (CELL + GAP))));
  const firstWeek = toLocalDate(startOfWeek(fromLocalDate(addDaysLocal(today, -(count - 1) * 7)), { weekStartsOn: ws }));
  const weeks = Array.from({ length: count }, (_, w) => addDaysLocal(firstWeek, w * 7));
  const quit = habit.goal.kind === "quit";
  return (
    <section ref={ref}>
      <h3 className="mb-2 t-label text-muted">{count >= 53 ? "Past year" : `Last ${count} weeks`}</h3>
      <div className="grid justify-end" style={{ gridTemplateColumns: `repeat(${count}, ${CELL}px)`, gap: GAP }} role="img" aria-label={`${habit.name}: daily check-ins, last ${count} weeks`}>
        {weeks.map((w) => (
          <div key={w} className="flex flex-col" style={{ gap: GAP }}>
            <span className="h-4 overflow-visible whitespace-nowrap text-[length:var(--fs-xs)] leading-4 text-muted">{fromLocalDate(w).getDate() <= 7 ? format(fromLocalDate(w), "MMM") : ""}</span>
            {Array.from({ length: 7 }, (_, di) => {
              const d = addDaysLocal(w, di);
              if (d > today) return <span key={d} style={{ height: CELL }} />;
              const v = values.get(d);
              const fill = d < habit.startDate ? "var(--surface-2)" : cellFill(habit, v, isScheduled(habit, d));
              return <button key={d} type="button" onClick={() => onPick(d)} title={cellTitle(habit, d, v)} aria-label={cellTitle(habit, d, v)} className={`rounded-xs ${d === picked ? "ring-2 ring-accent-text" : ""}`} style={{ height: CELL, background: fill === "transparent" ? "var(--surface-2)" : fill }} />;
            })}
          </div>
        ))}
      </div>
      <div className="mt-2 flex items-center justify-end gap-1.5 text-[length:var(--fs-xs)] text-muted">
        {isBuild(habit) ? (
          <>
            Less
            {[undefined, 0.3, 0.7, 1].map((r, i) => (
              <span key={i} className="size-2.5 rounded-xs" style={{ background: cellFill(habit, r === undefined ? undefined : r * targetOf(habit), true) }} />
            ))}
            More
          </>
        ) : (
          [
            [quit ? "No slip" : "Within limit", habit.color],
            [quit ? "Slipped" : "Over", "var(--danger)"],
          ].map(([label, bg], i) => (
            <span key={label} className={`inline-flex items-center gap-1.5 ${i ? "ml-2" : ""}`}>
              <span className="size-2.5 rounded-xs" style={{ background: bg }} />
              {label}
            </span>
          ))
        )}
      </div>
    </section>
  );
}
