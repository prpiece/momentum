import { format } from "date-fns";
import { Archive, ArchiveRestore, Check, Minus, Pencil, Plus, RotateCcw, Trash2 } from "lucide-react";
import { fromLocalDate, todayLocal } from "../../domain/dates";
import { isDone, type Habit } from "../../domain/habits";
import type { LocalDate } from "../../domain/types";
import { checkinOf, removeHabit, setCheckin, tapCheckin, updateHabit } from "../../stores/habits";
import { confirm, type MenuEntry } from "../../stores/ui";

export async function confirmRemoveHabit(h: Habit) {
  if (await confirm(`Delete “${h.name}”?`, "Its whole check-in history is deleted too. Archive it instead to keep the history.")) removeHabit(h.id);
}

/** Right-click / "…" menu for a habit, with check-in fixes for `date`. */
export function habitMenu(h: Habit, date: LocalDate, onEdit?: () => void): MenuEntry[] {
  const value = checkinOf(h.id, date)?.value ?? 0;
  const day = date === todayLocal() ? "today" : format(fromLocalDate(date), "EEE d MMM");
  const checkins: MenuEntry[] =
    h.goal.kind === "once"
      ? [isDone(h, value) ? { label: `Undo check-in (${day})`, icon: <RotateCcw size={14} />, run: () => setCheckin(h.id, date, { value: 0 }) } : { label: `Check in (${day})`, icon: <Check size={14} />, run: () => tapCheckin(h, date) }]
      : [
          { label: `Add one (${day})`, icon: <Plus size={14} />, run: () => tapCheckin(h, date, 1) },
          ...(value > 0
            ? [
                { label: "Remove one", icon: <Minus size={14} />, run: () => tapCheckin(h, date, -1) },
                { label: `Reset ${day}`, icon: <RotateCcw size={14} />, run: () => setCheckin(h.id, date, { value: 0 }) },
              ]
            : []),
        ];
  return [
    ...(h.archived ? [] : [...checkins, "sep" as const]),
    ...(onEdit ? [{ label: "Edit habit…", icon: <Pencil size={14} />, run: onEdit }] : []),
    h.archived
      ? { label: "Unarchive", icon: <ArchiveRestore size={14} />, run: () => updateHabit(h.id, { archived: false }) }
      : { label: "Archive", icon: <Archive size={14} />, run: () => updateHabit(h.id, { archived: true }) },
    { label: "Delete habit", icon: <Trash2 size={14} />, danger: true, run: () => void confirmRemoveHabit(h) },
  ];
}
