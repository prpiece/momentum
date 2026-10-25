import type { DragEndEvent, DragMoveEvent } from "@dnd-kit/core";
import { droppedSchedule, type CalItem } from "../../domain/calendar";
import { durationMinutes } from "../../domain/dates";
import { scheduleForKey } from "../../domain/recurrence";
import type { Schedule } from "../../domain/types";
import { isDragData, onDrop, type DragData } from "../../lib/dnd";
import { withUndo } from "../../lib/undo";
import { editEventOccurrence, updateEvent, updateTask, useData } from "../../stores/data";
import { useSettings } from "../../stores/settings";
import { askScope, toast } from "../../stores/ui";
import { editTask } from "../tasks/actions";
import { derive } from "../tasks/selectors";

export const HOUR_PX = { comfortable: 56, compact: 40 } as const;
export const pxPerMinute = () => HOUR_PX[useSettings.getState().settings.calendar.density] / 60;

type Ref = Pick<CalItem, "source" | "id" | "key">;

/** The schedule an item (or occurrence) has right now. */
export function currentSchedule(ref: Ref): Schedule {
  const s = useData.getState();
  if (ref.source === "event") {
    const e = s.events[ref.id];
    if (!e) return { kind: "none" };
    return ref.key && e.recurrence ? scheduleForKey(e.schedule, ref.key) : e.schedule;
  }
  const t = s.tasks[ref.id];
  if (!t) return { kind: "none" };
  if (ref.key && t.recurrence) return scheduleForKey(t.schedule, ref.key);
  return derive(s.tasks, s.lists).byId.get(t.id)?.schedule ?? t.schedule;
}

/** Reschedule a task or event (occurrence), asking for scope on recurring series. */
export async function applySchedule(ref: Ref, schedule: Schedule) {
  const s = useData.getState();
  if (ref.source === "task") {
    const t = s.tasks[ref.id];
    if (!t) return;
    if (t.recurrence) return editTask(t.id, { schedule }, ref.key);
    return withUndo(schedule.kind === "none" ? "Unscheduled" : "Rescheduled", () => updateTask(t.id, { schedule }));
  }
  const e = s.events[ref.id];
  if (!e) return;
  if (e.source === "ics") return toast("Imported events are read-only");
  if (schedule.kind === "none") return toast("Events always have a time. Delete it instead.");
  if (!e.recurrence) return withUndo("Event moved", () => updateEvent(e.id, { schedule }));
  const scope = await askScope("edit");
  if (scope && ref.key) editEventOccurrence(e.id, ref.key, scope, { schedule });
}

// ---------- pointer geometry ----------

/** Minute within `date`'s time-grid column at viewport y (live DOM measure, scroll-safe). */
export function minuteAt(date: string, clientY: number): number | null {
  const col = document.querySelector<HTMLElement>(`[data-cal-col="${date}"]`);
  if (!col) return null;
  return (clientY - col.getBoundingClientRect().top) / pxPerMinute();
}

/**
 * Where a drag would land in a time column. Uses the dragged element's translated rect, not
 * `e.delta`: dnd-kit folds scroll-container offsets into delta, which skews the minute.
 * Blocks land where their top edge is; tasks from lists start where the pointer is.
 */
export function dropMinute(e: DragEndEvent | DragMoveEvent, date: string): number | null {
  const { initial, translated } = e.active.rect.current;
  if (!initial || !translated) return null;
  const data = e.active.data.current;
  if (isDragData(data) && data.type === "block") return minuteAt(date, translated.top);
  const a = e.activatorEvent;
  const grabY = a instanceof MouseEvent ? a.clientY : initial.top;
  return minuteAt(date, grabY + (translated.top - initial.top));
}

export function dragRef(drag: DragData): Ref {
  return drag.type === "block" ? { source: drag.source, id: drag.id, key: drag.key } : { source: "task", id: drag.id, key: drag.key };
}

// ---------- drop handlers ----------

onDrop("slot", (drag, drop, e) => {
  const ref = dragRef(drag);
  const current = currentSchedule(ref);
  const minute = drop.mode === "time" ? dropMinute(e, drop.date) : 0;
  if (minute === null) return;
  const next = droppedSchedule(current, drop.date, drop.mode, minute);
  if (JSON.stringify(next) === JSON.stringify(current)) return;
  void applySchedule(ref, next);
});

onDrop("arrange", (drag) => {
  const ref = dragRef(drag);
  if (ref.source === "event") return toast("Events can't be unscheduled");
  void applySchedule(ref, { kind: "none" });
});

/** Length in minutes an item would occupy when dropped (for the live preview). */
export const previewMinutes = (ref: Ref) => durationMinutes(currentSchedule(ref)) ?? 60;
