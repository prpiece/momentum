import { Ban, CalendarArrowUp, CalendarX2, CheckCircle2, Circle, Copy, Flag, FolderInput, PanelRightOpen, Pin, PinOff, Sun, Sunrise, Trash2 } from "lucide-react";
import { addDaysLocal, moveToDate, todayLocal } from "../../domain/dates";
import { scheduleForKey } from "../../domain/recurrence";
import { PRIORITIES, PRIORITY_LABEL, type LocalDate, type Schedule } from "../../domain/types";
import { withUndo } from "../../lib/undo";
import { duplicateTask, moveTasks, setStatus, useData } from "../../stores/data";
import { openTask, useUi, type MenuEntry } from "../../stores/ui";
import { bulkEdit, deleteTasks, editTask, setWontDo, toggleDone } from "./actions";

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
    bulkEdit(ids, `Rescheduled ${ids.length} tasks`, (x): { schedule: Schedule } => ({ schedule: date ? moveToDate(x.schedule, date) : { kind: "none" } }));
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
        { title: "No date", icon: <CalendarX2 size={15} />, run: () => reschedule(null) },
      ],
    },
    {
      label: "Priority",
      choices: [...PRIORITIES].reverse().map((p) => ({
        title: PRIORITY_LABEL[p],
        active: !many && t.priority === p,
        icon: <Flag size={15} style={{ color: p ? `var(--p${p})` : undefined }} fill={p ? `var(--p${p})` : "none"} />,
        run: () => bulkEdit(ids, many ? `Set priority on ${ids.length} tasks` : `Priority: ${PRIORITY_LABEL[p]}`, () => ({ priority: p })),
      })),
    },
    "sep",
    ...Object.values(lists)
      .filter((l) => !l.archived && l.id !== t.listId)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .slice(0, 6)
      .map((l) => ({ label: `Move to ${l.name}`, icon: <FolderInput size={14} />, run: () => withUndo(`Moved to ${l.name}`, () => moveTasks(ids, l.id)) })),
    "sep",
    ...(many
      ? []
      : [
          { label: t.pinned ? "Unpin" : "Pin to top", icon: t.pinned ? <PinOff size={14} /> : <Pin size={14} />, run: () => void editTask(id, { pinned: !t.pinned }) },
          { label: "Duplicate", icon: <Copy size={14} />, run: () => withUndo("Duplicated", () => duplicateTask(id)) },
          { label: t.status === "wont_do" ? "Reopen" : "Won't do", icon: <Ban size={14} />, run: () => setWontDo(id, key) },
        ]),
    { label: lbl("Delete"), icon: <Trash2 size={14} />, danger: true, hint: "Del", run: () => void deleteTasks(ids, key) },
  ];
}
