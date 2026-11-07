import { format, startOfWeek } from "date-fns";
import { useState } from "react";
import { addDaysLocal, fromLocalDate, toLocalDate } from "../../domain/dates";
import { heatLevel } from "../../domain/stats";
import type { LocalDate, WeekStart } from "../../domain/types";

/** Accent steps for heat levels 1–4 (0 is the empty-cell gray). One hue, light to dark. */
const STEP = [0, 30, 55, 78, 100];
const fill = (level: number) => (level === 0 ? "var(--hover)" : `color-mix(in oklch, var(--accent) ${STEP[level]}%, var(--surface-2))`);

/** GitHub-style calendar of completions: one column per week, one row per weekday. */
export function Heatmap({ values, today, weeks, weekStart }: { values: Map<LocalDate, number>; today: LocalDate; weeks: number; weekStart: WeekStart }) {
  const [hover, setHover] = useState<LocalDate | null>(null);
  const first = addDaysLocal(toLocalDate(startOfWeek(fromLocalDate(today), { weekStartsOn: weekStart })), -(weeks - 1) * 7);
  const max = Math.max(0, ...values.values());
  const cols = Array.from({ length: weeks }, (_, w) => Array.from({ length: 7 }, (_, d) => addDaysLocal(first, w * 7 + d)));
  const total = [...values.values()].reduce((a, b) => a + b, 0);
  const shown = hover ?? null;

  return (
    <figure>
      <div className="mb-2 h-5 text-xs text-fg-2" aria-live="polite">
        {shown ? (
          <>
            <span className="font-semibold text-fg">{values.get(shown) ?? 0} tasks</span> · {format(fromLocalDate(shown), "EEEE, MMM d")}
          </>
        ) : (
          <>
            <span className="font-semibold text-fg">{total} tasks</span> in the last {weeks} weeks
          </>
        )}
      </div>
      <div className="pb-1">
        <div className="grid gap-[3px]" style={{ gridTemplateColumns: `repeat(${weeks}, minmax(0, 1fr))` }} role="img" aria-label={`Completions per day, last ${weeks} weeks`} onMouseLeave={() => setHover(null)}>
          {cols.map((col, w) => (
            <div key={w} className="flex flex-col gap-[3px]">
              {col.map((d) =>
                d > today ? (
                  <span key={d} className="aspect-square" />
                ) : (
                  <span
                    key={d}
                    onMouseEnter={() => setHover(d)}
                    className={`anim-fade aspect-square rounded-[3px] transition-transform duration-[var(--dur)] hover:scale-125 ${hover === d ? "ring-1 ring-fg" : ""}`}
                    style={{ background: fill(heatLevel(values.get(d) ?? 0, max)), animationDelay: `${w * 12}ms`, animationFillMode: "backwards" }}
                  />
                ),
              )}
            </div>
          ))}
        </div>
      </div>
      <figcaption className="mt-2 flex items-center justify-end gap-1 text-[0.7rem] text-muted">
        Less
        {[0, 1, 2, 3, 4].map((l) => (
          <span key={l} className="size-2.5 rounded-[3px]" style={{ background: fill(l) }} />
        ))}
        More
      </figcaption>
    </figure>
  );
}
