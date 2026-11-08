import { ChevronLeft, ChevronRight } from "lucide-react";
import { format } from "date-fns";
import { useState } from "react";
import { addDaysLocal, daysBetween, fromLocalDate, todayLocal } from "../../domain/dates";
import { sortVMs, topLevelIn, type TaskVM } from "../../domain/taskViews";
import { PRIORITY_VAR } from "../../domain/types";
import { useData } from "../../stores/data";
import { openTask } from "../../stores/ui";

const DAYS = 14;

/** Two-week strip: each dated task is a row with a bar on its day; undated tasks are listed below. */
export function TimelineView({ vms }: { vms: TaskVM[] }) {
  const today = todayLocal();
  const lists = useData((s) => s.lists);
  const [start, setStart] = useState(addDaysLocal(today, -2));
  const days = Array.from({ length: DAYS }, (_, i) => addDaysLocal(start, i));
  const end = days[DAYS - 1];
  const open = sortVMs(vms.filter((v) => v.task.status === "open"), "date");
  const dated = open.filter((v) => v.date && v.date >= start && v.date <= end);
  // Dated subtasks get their own bar; undated ones stay inside their parent (D196).
  const undated = topLevelIn(open).filter((v) => !v.date);
  const outside = open.filter((v) => v.date && (v.date < start || v.date > end)).length;
  const weekend = (d: string) => [0, 6].includes(fromLocalDate(d).getDay());
  const todayIdx = days.indexOf(today);
  const cols = { gridTemplateColumns: `repeat(${DAYS}, 1fr)` };

  return (
    <div className="min-h-0 flex-1 overflow-auto px-[var(--gutter)] pb-10">
      <div className="mb-3 flex items-center gap-1.5">
        <button type="button" onClick={() => setStart(addDaysLocal(today, -2))} className="btn btn-secondary">
          Today
        </button>
        <button type="button" aria-label="Previous week" onClick={() => setStart(addDaysLocal(start, -7))} className="btn btn-ghost icon-btn">
          <ChevronLeft size={18} strokeWidth={1.75} />
        </button>
        <button type="button" aria-label="Next week" onClick={() => setStart(addDaysLocal(start, 7))} className="btn btn-ghost icon-btn">
          <ChevronRight size={18} strokeWidth={1.75} />
        </button>
        <span className="ml-1 text-[length:var(--fs-sm)] tabular-nums text-muted">
          {format(fromLocalDate(start), "d MMM")} – {format(fromLocalDate(end), "d MMM")}
          {outside > 0 && ` · ${outside} outside this range`}
        </span>
      </div>
      <div className="min-w-[56rem] overflow-hidden rounded-card border border-border">
        <div className="grid h-11 border-b border-border" style={cols}>
          {days.map((d, i) => (
            <div
              key={d}
              className={`flex flex-col justify-center pl-2 text-[length:var(--fs-xs)] leading-[var(--lh-xs)] ${i ? "border-l border-border" : ""} ${weekend(d) ? "bg-bg" : ""} ${d === today ? "text-accent-text" : "text-muted"}`}
            >
              {format(fromLocalDate(d), "EEE")}
              <b className={`text-[length:var(--fs-sm)] font-semibold tabular-nums ${d === today ? "text-accent-text" : "text-fg"}`}>{format(fromLocalDate(d), "d")}</b>
            </div>
          ))}
        </div>
        <div className="relative">
          <div className="pointer-events-none absolute inset-0 grid" style={cols} aria-hidden>
            {days.map((d, i) => (
              <div key={d} className={`${i ? "border-l border-dashed border-border" : ""} ${weekend(d) ? "bg-bg" : ""}`} />
            ))}
          </div>
          {todayIdx >= 0 && <div className="pointer-events-none absolute inset-y-0 z-[1] -ml-px w-0.5 bg-accent" style={{ left: `${((todayIdx + 0.5) / DAYS) * 100}%` }} aria-hidden />}
          <div className="relative py-2">
            {dated.map((vm) => {
              const col = daysBetween(start, vm.date ?? start);
              const c = lists[vm.task.listId]?.color ?? "var(--muted)";
              const late = (vm.date ?? today) < today;
              return (
                <div key={vm.task.id} className="relative h-9">
                  <button
                    type="button"
                    onClick={() => openTask(vm.task.id, vm.key)}
                    className="absolute inset-y-0 flex max-w-full items-center gap-2 rounded-control pr-2 text-left hover:bg-surface-2"
                    style={{ left: `${(col / DAYS) * 100}%`, right: 0 }}
                  >
                    <span
                      className="h-[22px] shrink-0 rounded-control border"
                      style={{
                        width: `calc(${100 / (DAYS - col)}% - 4px)`,
                        marginLeft: 2,
                        background: `color-mix(in srgb, ${c} 16%, var(--surface))`,
                        borderColor: late ? "var(--danger)" : `color-mix(in srgb, ${c} 40%, var(--surface))`,
                        boxShadow: vm.task.priority ? `inset 3px 0 0 ${PRIORITY_VAR[vm.task.priority]}` : undefined,
                      }}
                    />
                    <span className="min-w-0 truncate text-[length:var(--fs-sm)] font-medium">
                      {vm.task.title}
                      {late && <span className="ml-1.5 font-normal text-danger">overdue</span>}
                    </span>
                  </button>
                </div>
              );
            })}
            {!dated.length && <p className="py-6 text-center text-[length:var(--fs-sm)] text-muted">Nothing scheduled in these two weeks.</p>}
          </div>
        </div>
      </div>
      {undated.length > 0 && (
        <div className="mt-5">
          <h3 className="t-label mb-2 px-1 text-muted">
            No date <span className="tabular-nums">{undated.length}</span>
          </h3>
          <div className="flex flex-wrap gap-2">
            {undated.map((vm) => (
              <button key={vm.task.id} type="button" onClick={() => openTask(vm.task.id, vm.key)} className="btn btn-secondary btn-sm border-dashed font-normal">
                {vm.task.title}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
