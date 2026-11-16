import { AlarmClock, Archive, Ban, CalendarArrowUp, CalendarX2, CheckCircle2, Circle, Copy, FastForward, Flag, FolderInput, LayoutTemplate, PanelRightOpen, Pin, PinOff, Send, Sun, Sunrise, Trash2 } from "lucide-react";
import { saveAsTemplate } from "../../stores/templates";
import { openSnooze } from "./SnoozeDialog";
import { addDaysLocal, moveToDate, todayLocal } from "../../domain/dates";
import { missedKeys, scheduleForKey } from "../../domain/recurrence";
import { PRIORITIES, PRIORITY_LABEL, PRIORITY_VAR, type LocalDate, type Schedule, type Task } from "../../domain/types";
import { withUndo } from "../../stores/undo";
import { duplicateTask, moveTasks, setStatus, skipMissed, useData } from "../../stores/data";
import { openTask, toast, useUi, type MenuEntry } from "../../stores/ui";
import { openSend } from "../friends/friendsUi";
import { confirmShareMove } from "../friends/moveGuard";
import { bulkEdit, deleteTasks, editTask, setWontDo, toggleDone } from "./actions";

/** Bulk date edits skip repeating tasks: a series is rescheduled from the task itself, where the scope prompt lives (UI-03). */
export function bulkReschedule(ids: string[], label: string, patch: (t: Task) => Partial<Task>) {
  const tasks = useData.getState().tasks;
  const movable = ids.filter((id) => tasks[id] && !tasks[id].recurrence);
  if (movable.length < ids.length) toast("Repeating tasks are rescheduled from the task itself (Enter to open it).");
  if (movable.length) bulkEdit(movable, label, patch);
}

/** "Skip to today" (TIME-20): every missed occurrence of a repeating task goes in one undo step. */
export function skipMissedWithUndo(id: string) {
  let n = 0;
  withUndo("Skipped missed occurrences", () => void (n = skipMissed(id, todayLocal())));
  if (!n) toast("Nothing missed to skip.");
}

/**
 * Right-click menu for a task (or the whole selection when the task is part of it).
 * Recurring tasks go through `editTask`, which asks which occurrences to change.
 */
export function taskMenu(id: string, key: string | null): MenuEntry[] {
  const { tasks, lists } = useData.getState();
  const t = tasks[id];
  if (!t) return [];
  const sel = useUi.getState().selection;
  const ids = sel.length > 1 && sel.includes(id) ? sel : [id];
  const many = ids.length > 1;
  const today = todayLocal();
  const reschedule = (date: LocalDate | null) => {
    if (!many) {
      const from = key ? scheduleForKey(t.schedule, key) : t.schedule;
      return void editTask(id, { schedule: date ? moveToDate(from, date) : { kind: "none" } }, key);
    }
    bulkReschedule(ids, `Rescheduled ${ids.length} tasks`, (x): { schedule: Schedule } => ({ schedule: date ? moveToDate(x.schedule, date) : { kind: "none" } }));
  };
  const lbl = (one: string) => (many ? `${one} ${ids.length} tasks` : one);

  return [
    ...(many ? [] : [{ label: "Open details", icon: <PanelRightOpen size={14} />, hint: "Enter", run: () => openTask(id, key) }]),
    t.status === "open"
      ? { label: lbl("Complete"), icon: <CheckCircle2 size={14} />, run: () => (many ? withUndo(`Completed ${ids.length} tasks`, () => ids.forEach((x) => setStatus(x, "done"))) : toggleDone(id, key)) }
      : { label: "Mark as not done", icon: <Circle size={14} />, run: () => toggleDone(id, key) },
    "sep",
    {
      label: "Date",
      choices: [
        { title: "Today", icon: <Sun size={15} />, run: () => reschedule(today) },
        { title: "Tomorrow", icon: <Sunrise size={15} />, run: () => reschedule(addDaysLocal(today, 1)) },
        { title: "Next week", icon: <CalendarArrowUp size={15} />, run: () => reschedule(addDaysLocal(today, 7)) },
        { title: "Someday", icon: <Archive size={15} />, run: () => (many ? bulkReschedule(ids, `Moved ${ids.length} tasks to Someday`, () => ({ schedule: { kind: "someday" } })) : void editTask(id, { schedule: { kind: "someday" } }, key)) },
        { title: "No date", icon: <CalendarX2 size={15} />, run: () => reschedule(null) },
      ],
    },
    ...(many || t.status !== "open" ? [] : [{ label: "Snooze…", icon: <AlarmClock size={14} />, run: () => openSnooze(id, key) }]),
    {
      label: "Priority",
      choices: [...PRIORITIES].reverse().map((p) => ({
        title: PRIORITY_LABEL[p],
        active: !many && t.priority === p,
        icon: <Flag size={15} style={{ color: p ? PRIORITY_VAR[p] : undefined }} fill={p ? PRIORITY_VAR[p] : "none"} />,
        run: () => bulkEdit(ids, many ? `Set priority on ${ids.length} tasks` : `Priority: ${PRIORITY_LABEL[p]}`, () => ({ priority: p })),
      })),
    },
    "sep",
    ...Object.values(lists)
      .filter((l) => !l.archived && l.id !== t.listId)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .slice(0, 6)
      .map((l) => ({ label: `Move to ${l.name}`, icon: <FolderInput size={14} />, run: () => void confirmShareMove("list", l.id, many ? "these tasks" : "this task", t.listId).then((ok) => ok && withUndo(`Moved to ${l.name}`, () => moveTasks(ids, l.id))) })),
    "sep",
    ...(many
      ? []
      : [
          { label: t.pinned ? "Unpin" : "Pin to top", icon: t.pinned ? <PinOff size={14} /> : <Pin size={14} />, run: () => void editTask(id, { pinned: !t.pinned }) },
          ...(t.status === "open" && missedKeys(t, today).length ? [{ label: "Skip to today", icon: <FastForward size={14} />, run: () => skipMissedWithUndo(id) }] : []),
          { label: "Send to friend…", icon: <Send size={14} />, run: () => openSend(id) },
          { label: "Save as template", icon: <LayoutTemplate size={14} />, run: () => void saveAsTemplate(id) },
          { label: "Duplicate", icon: <Copy size={14} />, run: () => withUndo("Duplicated", () => duplicateTask(id)) },
          { label: t.status === "wont_do" ? "Reopen" : "Won't do", icon: <Ban size={14} />, run: () => setWontDo(id, key) },
        ]),
    { label: lbl("Delete"), icon: <Trash2 size={14} />, danger: true, hint: "Del", run: () => void deleteTasks(ids, key) },
  ];
}
