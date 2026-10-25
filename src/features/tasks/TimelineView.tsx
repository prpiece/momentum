import { ChevronLeft, ChevronRight } from "lucide-react";
import { format } from "date-fns";
import { useState } from "react";
import { addDaysLocal, daysBetween, fromLocalDate, todayLocal } from "../../domain/dates";
import { sortVMs, type TaskVM } from "../../domain/taskViews";
import { openTask } from "../../stores/ui";

const DAYS = 14;
const PRIORITY_BAR = ["var(--fg-muted)", "var(--p1)", "var(--p2)", "var(--p3)"];

/** Two-week strip: each dated task is a bar on its day; undated tasks are listed below. */
export function TimelineView({ vms }: { vms: TaskVM[] }) {
  const today = todayLocal();
  const [start, setStart] = useState(addDaysLocal(today, -2));
  const days = Array.from({ length: DAYS }, (_, i) => addDaysLocal(start, i));
  const end = days[DAYS - 1];
  const open = sortVMs(vms.filter((v) => v.task.status === "open"), "date");
  const dated = open.filter((v) => v.date && v.date >= start && v.date <= end);
  const undated = open.filter((v) => !v.date);
  const outside = open.length - dated.length - undated.length;

  return (
    <div className="scroll-thin min-h-0 flex-1 overflow-auto px-4 pb-10">
      <div className="mb-3 flex items-center gap-2">
        <button type="button" aria-label="Previous week" onClick={() => setStart(addDaysLocal(start, -7))} className="grid size-8 place-items-center rounded-sm text-muted hover:bg-hover">
          <ChevronLeft size={18} />
        </button>
        <button type="button" onClick={() => setStart(addDaysLocal(today, -2))} className="h-8 rounded-sm px-3 text-sm text-fg-2 hover:bg-hover">
          Today
        </button>
        <button type="button" aria-label="Next week" onClick={() => setStart(addDaysLocal(start, 7))} className="grid size-8 place-items-center rounded-sm text-muted hover:bg-hover">
          <ChevronRight size={18} />
        </button>
        <span className="text-sm text-muted">
          {format(fromLocalDate(start), "MMM d")} – {format(fromLocalDate(end), "MMM d")}
          {outside > 0 && ` · ${outside} outside this range`}
        </span>
      </div>
      <div className="min-w-[56rem] rounded-md border border-border">
        <div className="grid border-b border-border" style={{ gridTemplateColumns: `repeat(${DAYS}, 1fr)` }}>
          {days.map((d) => (
            <div key={d} className={`px-1 py-2 text-center text-xs ${d === today ? "font-semibold text-accent" : "text-muted"}`}>
              <div>{format(fromLocalDate(d), "EEE")}</div>
              <div className="font-mono text-sm">{format(fromLocalDate(d), "d")}</div>
            </div>
          ))}
        </div>
        <div className="relative grid gap-y-1 py-2" style={{ gridTemplateColumns: `repeat(${DAYS}, 1fr)` }}>
          {days.map((d, i) => (
            <div key={d} className={`pointer-events-none absolute inset-y-0 ${d === today ? "bg-accent-soft" : ""}`} style={{ left: `${(i / DAYS) * 100}%`, width: `${100 / DAYS}%` }} />
          ))}
          {dated.map((vm) => {
            const col = daysBetween(start, vm.date ?? start) + 1;
            return (
              <button
                key={vm.task.id}
                type="button"
                onClick={() => openTask(vm.task.id, vm.key)}
                className="relative mx-0.5 truncate rounded-sm border-l-[3px] bg-surface-2 px-2 py-1 text-left text-xs shadow-sm hover:shadow-lg"
                style={{ gridColumn: `${col} / span 1`, borderLeftColor: PRIORITY_BAR[vm.task.priority] }}
              >
                {vm.task.title}
              </button>
            );
          })}
          {!dated.length && <p className="col-span-full py-6 text-center text-sm text-muted">Nothing scheduled in these two weeks.</p>}
        </div>
      </div>
      {undated.length > 0 && (
        <div className="mt-5">
          <h3 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wider text-fg-2">No date · {undated.length}</h3>
          <div className="flex flex-wrap gap-2">
            {undated.map((vm) => (
              <button key={vm.task.id} type="button" onClick={() => openTask(vm.task.id, vm.key)} className="rounded-full border border-border bg-surface-2 px-3 py-1 text-xs hover:border-accent">
                {vm.task.title}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
