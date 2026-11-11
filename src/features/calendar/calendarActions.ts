import type { DragEndEvent, DragMoveEvent } from "@dnd-kit/core";
import { droppedSchedule } from "../../domain/calendar";
import { durationMinutes } from "../../domain/dates";
import { isDragData, onDrop, type DragData } from "../../lib/dnd";
import { useSettings } from "../../stores/settings";
import { applySchedule, currentSchedule, type Ref } from "../../stores/schedule";
import { toast } from "../../stores/toast";

export const HOUR_PX = { comfortable: 64, compact: 44 } as const;
export const pxPerMinute = () => HOUR_PX[useSettings.getState().settings.calendar.density] / 60;

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

/** What a drag refers to on the calendar; null for drags that don't belong here (habits). */
export function dragRef(drag: DragData): Ref | null {
  if (drag.type === "block") return { source: drag.source, id: drag.id, key: drag.key };
  // A dragged subtask schedules itself: dated subtasks have their own place on the calendar (D196).
  if (drag.type === "task") return { source: "task", id: drag.id, key: drag.key };
  return null;
}

// ---------- drop handlers ----------

onDrop("slot", (drag, drop, e) => {
  const ref = dragRef(drag);
  if (!ref) return;
  const current = currentSchedule(ref);
  const minute = drop.mode === "time" ? dropMinute(e, drop.date) : 0;
  if (minute === null) return;
  const next = droppedSchedule(current, drop.date, drop.mode, minute);
  if (JSON.stringify(next) === JSON.stringify(current)) return;
  void applySchedule(ref, next);
});

onDrop("arrange", (drag) => {
  const ref = dragRef(drag);
  if (!ref) return;
  if (ref.source === "event") return toast("Events can't be unscheduled");
  void applySchedule(ref, { kind: "none" });
});

/** Length in minutes an item would occupy when dropped (for the live preview). */
export const previewMinutes = (ref: Ref) => durationMinutes(currentSchedule(ref)) ?? 60;
