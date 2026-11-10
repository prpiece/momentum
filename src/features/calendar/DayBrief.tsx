import { format } from "date-fns";
import { daySummary, type CalItem } from "../../domain/calendar";
import { formatTime, fromLocalDate, relativeDayLabel, todayLocal } from "../../domain/dates";
import { useSettings } from "../../stores/settings";
import { AgendaRow } from "./AgendaRow";
import { openItem } from "./Blocks";
import { useMinuteTick } from "./TimeGrid";

const hm = (m: number) => (m < 60 ? `${m}m` : m % 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m / 60}h`);
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

/**
 * The Day view's right-hand column (PLAN D209): the date, a one-line summary, what's on now or next,
 * then the day as a list. It balances the time grid instead of leaving one centred column in empty space.
 */
export function DayBrief({ day, items }: { day: string; items: CalItem[] }) {
  const timeFormat = useSettings((s) => s.settings.timeFormat);
  const today = todayLocal();
  useMinuteTick(day === today);
  const now = new Date();
  const s = daySummary(items, day, now);
  const all = [...s.allDay, ...s.timed].filter((i) => i.source !== "habit");
  const events = all.filter((i) => i.source === "event").length;
  const tasks = all.filter((i) => i.source === "task").length;
  const facts = [events && plural(events, "event"), tasks && plural(tasks, "task"), s.scheduledMinutes > 0 && `${hm(s.scheduledMinutes)} booked`].filter(Boolean);
  const focus = s.now ?? s.next;
  const date = fromLocalDate(day);

  return (
    <aside aria-label="Day brief" className="hidden w-[var(--detail-panel)] shrink-0 flex-col overflow-y-auto border-l border-border min-[1100px]:flex">
      <header className="border-b border-border px-5 pb-4 pt-5">
        <div className={`t-label ${day === today ? "text-accent-text" : "text-muted"}`}>{relativeDayLabel(day, today)}</div>
        <h2 className="t-title mt-1">{format(date, "EEEE d MMMM")}</h2>
        <p className="mt-1 text-[length:var(--fs-sm)] text-muted">{facts.length ? facts.join(" · ") : "Nothing scheduled"}</p>
      </header>

      {focus && (
        <button type="button" onClick={() => openItem(focus)} className="card mx-4 mt-4 flex flex-col items-start gap-1 px-4 py-3 text-left hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-accent-text">
          <span className="t-label text-muted">{s.now ? "Now" : `Up next · in ${hm(Math.max(1, Math.round((focus.start!.getTime() - now.getTime()) / 60_000)))}`}</span>
          <span className="flex w-full min-w-0 items-center gap-2 font-semibold">
            <span className="size-2.5 shrink-0 rounded-full" style={{ background: focus.color }} />
            <span className="truncate">{focus.title}</span>
          </span>
          <span className="text-[length:var(--fs-sm)] tabular-nums text-muted">
            {formatTime(focus.start!, timeFormat)} – {formatTime(focus.end!, timeFormat)}
          </span>
        </button>
      )}

      {s.allDay.length > 0 && (
        <section className="px-3 pt-4">
          <h3 className="t-label px-2 pb-1 text-muted">All day</h3>
          {s.allDay.map((i) => <AgendaRow key={i.uid} item={i} timeFormat={timeFormat} timeWidth="hidden" />)}
        </section>
      )}

      <section className="px-3 py-4">
        <h3 className="t-label px-2 pb-1 text-muted">Schedule</h3>
        {s.timed.length ? (
          s.timed.map((i) => <AgendaRow key={i.uid} item={i} timeFormat={timeFormat} timeWidth="w-24" />)
        ) : (
          <p className="px-2 py-1 text-[length:var(--fs-sm)] text-muted">Click or drag on the grid to add something, or drag a task in from Arrange.</p>
        )}
      </section>
    </aside>
  );
}
