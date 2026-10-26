import { useMemo } from "react";
import { calendarItems, hashColor, type CalItem } from "../../domain/calendar";
import { ACCENT_PRESETS } from "../../domain/color";
import { addDaysLocal, toLocalDate } from "../../domain/dates";
import { isDone, isScheduled } from "../../domain/habits";
import type { LocalDate, Task } from "../../domain/types";
import { useData } from "../../stores/data";
import { useFocus } from "../../stores/focus";
import { useHabits } from "../../stores/habits";
import { useSettings } from "../../stores/settings";
import { useDerived } from "../tasks/selectors";

const PALETTE = ACCENT_PRESETS.map((p) => p.hex);
const PRIORITY_COLOR = ["var(--fg-muted)", "var(--p1)", "var(--p2)", "var(--p3)"];

/** Calendar items for [from, to], memoized on the data they derive from. */
export function useCalendarItems(from: LocalDate, to: LocalDate): CalItem[] {
  const derived = useDerived();
  const events = useData((s) => s.events);
  const lists = useData((s) => s.lists);
  const tags = useData((s) => s.tags);
  const habits = useHabits((s) => s.habits);
  const checkins = useHabits((s) => s.checkins);
  const cal = useSettings((s) => s.settings.calendar);
  const sessions = useFocus((s) => s.sessions);

  return useMemo(() => {
    const colorOf = (t: Task): string => {
      if (cal.colorBy === "priority") return PRIORITY_COLOR[t.priority];
      if (cal.colorBy === "tag") {
        const tag = t.tags.map((id) => tags[id]).find(Boolean);
        return tag ? (tag.color ?? hashColor(tag.name, PALETTE)) : "var(--fg-muted)";
      }
      return lists[t.listId]?.color ?? "var(--accent)";
    };
    const items = calendarItems({ tasks: derived.active, events: Object.values(events), colorOf, showCompleted: cal.showCompleted }, from, to);
    if (cal.showHabits) {
      // One read-only all-day marker per scheduled habit day (per-week habits: days actually done).
      for (const h of Object.values(habits)) {
        if (h.archived) continue;
        for (let d = from; d <= to; d = addDaysLocal(d, 1)) {
          const done = isDone(h, checkins[h.id]?.[d]?.value);
          if (h.frequency.kind === "perWeek" ? !done : !isScheduled(h, d)) continue;
          items.push({ uid: `habit:${h.id}:${d}`, source: "habit", id: h.id, key: d, title: h.name, allDay: true, startDate: d, endDate: d, start: null, end: null, color: h.color, done, recurring: false, readOnly: true, priority: 0 });
        }
      }
    }
    if (cal.showFocus) {
      // Focus records: read-only timed blocks.
      for (const s of Object.values(sessions)) {
        const start = new Date(s.startAt);
        const end = new Date(s.endAt);
        const startDate = toLocalDate(start);
        const endDate = toLocalDate(new Date(end.getTime() - 1));
        if (endDate < from || startDate > to) continue;
        const task = s.taskId ? derived.byId.get(s.taskId)?.task : undefined;
        items.push({ uid: `focus:${s.id}`, source: "focus", id: s.id, key: null, title: task ? `Focus: ${task.title}` : "Focus", allDay: false, startDate, endDate, start, end, color: "var(--p3)", done: false, recurring: false, readOnly: true, priority: 0 });
      }
    }
    return items;
  }, [derived, events, lists, tags, habits, checkins, sessions, cal, from, to]);
}
