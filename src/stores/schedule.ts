/*
 * Rescheduling and deleting calendar items, shared by both apps (PLAN D229): recurrence scope
 * prompts, undo toasts, read-only imported events.
 */
import type { CalItem } from "../domain/calendar";
import { scheduleForKey } from "../domain/recurrence";
import { derive } from "../domain/taskViews";
import type { Schedule } from "../domain/types";
import { askScope } from "./ask";
import { deleteEventOccurrence, deleteEvents, editEventOccurrence, updateEvent, updateTask, useData } from "./data";
import { editTask } from "./taskActions";
import { toast } from "./toast";
import { withUndo } from "./undo";

export type Ref = Pick<CalItem, "source" | "id" | "key">;

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
    if (t.recurrence) return void (await editTask(t.id, { schedule }, ref.key));
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

/** Delete an event, or (recurring) the occurrences the user picks. Resolves false on cancel. */
export async function deleteEvent(id: string, key: string | null): Promise<boolean> {
  const e = useData.getState().events[id];
  if (!e) return false;
  if (e.recurrence && key) {
    const scope = await askScope("delete");
    if (!scope) return false;
    withUndo("Event deleted", () => deleteEventOccurrence(id, key, scope));
  } else withUndo("Event deleted", () => deleteEvents([id]));
  return true;
}
