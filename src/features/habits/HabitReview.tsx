import { AppIcon } from "../../components/ui/AppIcon";
import { addMonths, format, startOfMonth, startOfWeek } from "date-fns";
import { Check, ChevronLeft, ChevronRight, Minus } from "lucide-react";
import { useState } from "react";
import { accentForeground } from "../../domain/color";
import { addDaysLocal, fromLocalDate, toLocalDate, todayLocal } from "../../domain/dates";
import { completionRate, isDone, isScheduled, type Habit } from "../../domain/habits";
import { useHabits, valuesOf } from "../../stores/habits";
import { useSettings } from "../../stores/settings";
import { cellFill, cellTitle } from "./HabitDetail";

/** Weekly grid (habit × day) and monthly completion rates. */
export function HabitReview({ habits }: { habits: Habit[] }) {
  const ws = useSettings((s) => s.settings.weekStart);
  const checkins = useHabits((s) => s.checkins);
  const today = todayLocal();
  const [weekStart, setWeekStart] = useState(() => toLocalDate(startOfWeek(new Date(), { weekStartsOn: ws })));
  const [month, setMonth] = useState(() => toLocalDate(startOfMonth(new Date())));
  const days = Array.from({ length: 7 }, (_, i) => addDaysLocal(weekStart, i));
  const monthEnd = addDaysLocal(toLocalDate(addMonths(fromLocalDate(month), 1)), -1);

  return (
    <div className="scroll-thin h-full space-y-8 overflow-y-auto p-6">
      <section>
        <Nav title={`Week of ${format(fromLocalDate(weekStart), "MMM d")}`} onPrev={() => setWeekStart(addDaysLocal(weekStart, -7))} onNext={() => setWeekStart(addDaysLocal(weekStart, 7))} />
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className="pb-2 text-left text-xs font-medium text-muted">Habit</th>
              {days.map((d) => (
                <th key={d} className={`pb-2 text-center text-xs font-medium ${d === today ? "text-accent" : "text-muted"}`}>
                  {format(fromLocalDate(d), "EEEEE")}
                </th>
              ))}
              <th className="pb-2 text-right text-xs font-medium text-muted">Rate</th>
            </tr>
          </thead>
          <tbody>
            {habits.map((h) => {
              const values = valuesOf(checkins[h.id]);
              const rate = completionRate(h, values, days[0], days[6], today, ws);
              return (
                <tr key={h.id} className="border-t border-border">
                  <td className="py-2 pr-2">
                    <AppIcon name={h.icon} size={14} color={h.color} className="mr-2 inline align-[-2px]" />
                    {h.name}
                  </td>
                  {days.map((d) => {
                    const v = values.get(d);
                    const sched = isScheduled(h, d) && d <= today;
                    return (
                      <td key={d} className="py-2 text-center" title={cellTitle(h, d, v)}>
                        <span className="mx-auto grid size-6 place-items-center rounded-full" style={{ background: d > today ? "transparent" : cellFill(h, v, sched) }}>
                          {isDone(h, v) ? <Check size={13} strokeWidth={3} style={{ color: accentForeground(h.color) }} /> : !sched && d <= today ? <Minus size={11} className="text-muted" /> : null}
                        </span>
                      </td>
                    );
                  })}
                  <td className="py-2 text-right font-mono text-xs text-fg-2">{rate === null ? "–" : `${Math.round(rate * 100)}%`}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <section>
        <Nav title={format(fromLocalDate(month), "MMMM yyyy")} onPrev={() => setMonth(toLocalDate(addMonths(fromLocalDate(month), -1)))} onNext={() => setMonth(toLocalDate(addMonths(fromLocalDate(month), 1)))} />
        <ul className="space-y-3" aria-label="Monthly completion rate per habit">
          {habits.map((h) => {
            const rate = completionRate(h, valuesOf(checkins[h.id]), month, monthEnd, today, ws);
            const pct = rate === null ? 0 : Math.round(rate * 100);
            return (
              <li key={h.id} className="grid grid-cols-[10rem_1fr_3rem] items-center gap-3 text-sm" title={`${h.name}: ${rate === null ? "no check-ins expected yet" : `${pct}%`}`}>
                <span className="truncate">
                  <AppIcon name={h.icon} size={14} color={h.color} className="mr-2 inline align-[-2px]" />
                  {h.name}
                </span>
                <span className="h-2 overflow-hidden rounded-full bg-hover">
                  <span className="block h-full rounded-full" style={{ width: `${pct}%`, background: h.color }} />
                </span>
                <span className="text-right font-mono text-xs text-fg-2">{rate === null ? "–" : `${pct}%`}</span>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}

function Nav({ title, onPrev, onNext }: { title: string; onPrev: () => void; onNext: () => void }) {
  return (
    <div className="mb-3 flex items-center gap-1">
      <h3 className="flex-1 text-sm font-semibold">{title}</h3>
      <button type="button" aria-label="Previous" onClick={onPrev} className="grid size-7 place-items-center rounded-sm text-muted hover:bg-hover">
        <ChevronLeft size={15} />
      </button>
      <button type="button" aria-label="Next" onClick={onNext} className="grid size-7 place-items-center rounded-sm text-muted hover:bg-hover">
        <ChevronRight size={15} />
      </button>
    </div>
  );
}
