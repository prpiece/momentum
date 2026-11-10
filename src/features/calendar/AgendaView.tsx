import { format } from "date-fns";
import { itemsOnDay, type CalItem } from "../../domain/calendar";
import { fromLocalDate, relativeDayLabel, todayLocal } from "../../domain/dates";
import { useSettings } from "../../stores/settings";
import { AgendaRow } from "./AgendaRow";

/** Upcoming 30 days as a list, grouped by day; empty days are skipped. */
export function AgendaView({ days, items }: { days: string[]; items: CalItem[] }) {
  const timeFormat = useSettings((s) => s.settings.timeFormat);
  const today = todayLocal();
  const groups = days.map((d) => ({ day: d, items: itemsOnDay(items, d) })).filter((g) => g.items.length);
  if (!groups.length) return <p className="p-10 text-center text-[length:var(--fs-sm)] text-muted">Nothing scheduled in the next 30 days.</p>;
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-[var(--gutter)] pb-10">
      {groups.map((g) => (
        <section key={g.day} className="flex gap-6 border-b border-border py-4">
          <div className="w-28 shrink-0">
            <div className={`text-[length:var(--fs-sm)] font-semibold ${g.day === today ? "text-accent-text" : ""}`}>{relativeDayLabel(g.day, today)}</div>
            <div className="text-[length:var(--fs-xs)] tabular-nums text-muted">{format(fromLocalDate(g.day), "EEE, MMM d")}</div>
          </div>
          <ul className="min-w-0 flex-1 space-y-1">
            {g.items.map((i) => (
              <li key={i.uid}>
                <AgendaRow item={i} timeFormat={timeFormat} />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
