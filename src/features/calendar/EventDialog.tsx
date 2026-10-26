import { Check, Trash2 } from "lucide-react";
import { useState } from "react";
import { Button, Dialog } from "../../components/ui/Dialog";
import { ACCENT_PRESETS } from "../../domain/color";
import { addDaysLocal, atLocalTime, daysBetween, durationMinutes, hhmm, scheduleDate, timed, todayLocal } from "../../domain/dates";
import { REPEAT_PRESETS, describeRule, scheduleForKey } from "../../domain/recurrence";
import type { CalendarEvent, Recurrence, Schedule } from "../../domain/types";
import { editEventOccurrence, updateEvent, useData } from "../../stores/data";
import { deleteEvent } from "./calendarActions";
import { askScope, closeEvent, useUi } from "../../stores/ui";

export function EventDialog() {
  const open = useUi((s) => s.eventDialog);
  const event = useData((s) => (open ? s.events[open.id] : undefined));
  if (!open || !event || event.deletedAt) return null;
  return <EventForm key={`${event.id}:${open.key}`} event={event} occurrenceKey={open.key} />;
}

const field = "h-9 rounded-sm border border-border bg-surface px-2.5 text-sm outline-none focus:border-accent disabled:opacity-60";

function EventForm({ event, occurrenceKey }: { event: CalendarEvent; occurrenceKey: string | null }) {
  const shown = occurrenceKey && event.recurrence ? scheduleForKey(event.schedule, occurrenceKey) : event.schedule;
  const ro = event.source === "ics";
  const [title, setTitle] = useState(event.title);
  const [notes, setNotes] = useState(event.notes);
  const [color, setColor] = useState(event.color ?? ACCENT_PRESETS[1].hex);
  const [allDay, setAllDay] = useState(shown.kind === "day");
  const [date, setDate] = useState(scheduleDate(shown) ?? todayLocal());
  const [endDate, setEndDate] = useState(addDaysLocal(scheduleDate(shown) ?? todayLocal(), event.spanDays - 1));
  const [start, setStart] = useState(shown.kind === "timed" ? hhmm(new Date(shown.start)) : "09:00");
  const [minutes, setMinutes] = useState(durationMinutes(shown) ?? 60);
  const [rule, setRule] = useState(event.recurrence?.rule ?? "");

  const save = async () => {
    const schedule: Schedule = allDay ? { kind: "day", date } : timed(atLocalTime(date, start), minutes);
    const recurrence: Recurrence | null = rule ? { rule, exdates: rule === event.recurrence?.rule ? event.recurrence.exdates : [] } : null;
    const patch: Partial<CalendarEvent> = {
      title: title.trim() || "Untitled event",
      notes,
      color,
      spanDays: allDay ? Math.max(1, daysBetween(date, endDate) + 1) : 1,
    };
    const timingChanged = JSON.stringify(schedule) !== JSON.stringify(shown);
    if (event.recurrence && occurrenceKey && timingChanged && rule === event.recurrence.rule) {
      const scope = await askScope("edit");
      if (!scope) return;
      editEventOccurrence(event.id, occurrenceKey, scope, { ...patch, schedule });
    } else {
      // Changing the rule itself (or a non-recurring event) applies to the whole event.
      updateEvent(event.id, { ...patch, recurrence, ...(timingChanged ? { schedule } : {}) });
    }
    closeEvent();
  };

  const remove = async () => {
    if (await deleteEvent(event.id, occurrenceKey)) closeEvent();
  };

  return (
    <Dialog label="Event" onClose={closeEvent}>
      <form
        className="space-y-4 p-6"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <div className="flex items-center gap-2">
          <span className="size-3.5 rounded-[4px]" style={{ background: color }} />
          <input autoFocus value={title} disabled={ro} onChange={(e) => setTitle(e.target.value)} aria-label="Title" className="h-10 flex-1 bg-transparent text-lg font-semibold outline-none" />
        </div>
        {ro && <p className="rounded-sm bg-hover px-3 py-2 text-xs text-fg-2">Imported from an .ics file: read-only.</p>}

        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={allDay} disabled={ro} onChange={(e) => setAllDay(e.target.checked)} className="size-4 accent-[var(--accent)]" />
          All day
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <input type="date" value={date} disabled={ro} onChange={(e) => e.target.value && setDate(e.target.value)} aria-label="Date" className={field} />
          {allDay ? (
            <>
              <span className="text-sm text-muted">to</span>
              <input type="date" value={endDate < date ? date : endDate} min={date} disabled={ro} onChange={(e) => e.target.value && setEndDate(e.target.value)} aria-label="End date" className={field} />
            </>
          ) : (
            <>
              <input type="time" value={start} disabled={ro} onChange={(e) => e.target.value && setStart(e.target.value)} aria-label="Start time" className={field} />
              <select value={minutes} disabled={ro} onChange={(e) => setMinutes(Number(e.target.value))} aria-label="Duration" className={field}>
                {[...new Set([15, 30, 45, 60, 90, 120, 180, 240, 480, minutes])].sort((a, b) => a - b).map((m) => (
                  <option key={m} value={m}>
                    {m < 60 ? `${m} min` : `${Math.round((m / 60) * 10) / 10} h`}
                  </option>
                ))}
              </select>
            </>
          )}
        </div>

        <select value={rule} disabled={ro} onChange={(e) => setRule(e.target.value)} aria-label="Repeat" className={`${field} w-full`}>
          <option value="">Does not repeat</option>
          {REPEAT_PRESETS.map((p) => (
            <option key={p.rule} value={p.rule}>
              {p.label}
            </option>
          ))}
          {rule && !REPEAT_PRESETS.some((p) => p.rule === rule) && <option value={rule}>{describeRule(rule)}</option>}
        </select>

        <div className="flex flex-wrap gap-2" role="group" aria-label="Color">
          {ACCENT_PRESETS.map((p) => (
            <button key={p.hex} type="button" disabled={ro} aria-label={p.name} aria-pressed={color === p.hex} onClick={() => setColor(p.hex)} className="grid size-7 place-items-center rounded-full" style={{ background: p.hex }}>
              {color === p.hex && <Check size={14} strokeWidth={3} className="text-white" />}
            </button>
          ))}
        </div>

        <textarea value={notes} disabled={ro} onChange={(e) => setNotes(e.target.value)} placeholder="Notes" aria-label="Notes" className="min-h-20 w-full resize-y rounded-md border border-border bg-surface p-2.5 text-sm outline-none focus:border-accent" />

        <div className="flex items-center gap-2 border-t border-border pt-4">
          <Button variant="ghost" className="text-danger" onClick={() => void remove()}>
            <Trash2 size={15} /> Delete
          </Button>
          <div className="flex-1" />
          <Button onClick={closeEvent}>{ro ? "Close" : "Cancel"}</Button>
          {!ro && (
            <Button variant="primary" type="submit">
              Save
            </Button>
          )}
        </div>
      </form>
    </Dialog>
  );
}
