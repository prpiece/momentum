import { format } from "date-fns";
import { Repeat } from "lucide-react";
import { TaskCheckbox } from "../../components/ui/TaskCheckbox";
import { itemsOnDay, type CalItem } from "../../domain/calendar";
import { formatTime, fromLocalDate, relativeDayLabel, todayLocal } from "../../domain/dates";
import { useSettings } from "../../stores/settings";
import { toggleDone } from "../tasks/actions";
import { openItem } from "./Blocks";

/** Upcoming 30 days as a list, grouped by day; empty days are skipped. */
export function AgendaView({ days, items }: { days: string[]; items: CalItem[] }) {
  const timeFormat = useSettings((s) => s.settings.timeFormat);
  const today = todayLocal();
  const groups = days.map((d) => ({ day: d, items: itemsOnDay(items, d) })).filter((g) => g.items.length);
  if (!groups.length) return <p className="p-10 text-center text-sm text-muted">Nothing scheduled in the next 30 days.</p>;
  return (
    <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-6 pb-10">
      {groups.map((g) => (
        <section key={g.day} className="flex gap-6 border-b border-border py-4">
          <div className="w-28 shrink-0">
            <div className={`text-sm font-semibold ${g.day === today ? "text-accent" : ""}`}>{relativeDayLabel(g.day, today)}</div>
            <div className="text-xs text-muted">{format(fromLocalDate(g.day), "EEE, MMM d")}</div>
          </div>
          <ul className="min-w-0 flex-1 space-y-1">
            {g.items.map((i) => (
              <li key={i.uid}>
                <div role="button" tabIndex={0} onClick={() => openItem(i)} onKeyDown={(e) => e.key === "Enter" && openItem(i)} className="flex items-center gap-3 rounded-sm px-2 py-1.5 hover:bg-hover">
                  <span className="w-28 shrink-0 font-mono text-xs text-muted">
                    {i.allDay || !i.start || !i.end ? "All day" : `${formatTime(i.start, timeFormat)} – ${formatTime(i.end, timeFormat)}`}
                  </span>
                  {i.source === "task" ? (
                    <TaskCheckbox status={i.done ? "done" : "open"} priority={i.priority} onToggle={() => toggleDone(i.id, i.key)} label={`Complete ${i.title}`} size={16} />
                  ) : (
                    <span className="size-3 shrink-0 rounded-[4px]" style={{ background: i.color }} />
                  )}
                  <span className={`min-w-0 flex-1 truncate text-sm ${i.done ? "text-muted line-through" : ""}`}>{i.title}</span>
                  {i.recurring && <Repeat size={12} className="text-muted" />}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
