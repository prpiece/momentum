import { useMemo } from "react";
import { calendarItems, hashColor, type CalItem } from "../../domain/calendar";
import { ACCENT_PRESETS } from "../../domain/color";
import type { LocalDate, Task } from "../../domain/types";
import { useData } from "../../stores/data";
import { useSettings } from "../../stores/settings";
import { useDerived } from "../tasks/selectors";

const PALETTE = ACCENT_PRESETS.map((p) => p.hex);
const PRIORITY_COLOR = ["var(--fg-muted)", "var(--p1)", "var(--p2)", "var(--p3)"];

/** Extra item sources (habits, focus records) plugged in by later features. */
type Source = (from: LocalDate, to: LocalDate) => CalItem[];
const extra = new Map<string, Source>();
export const addCalendarSource = (name: string, s: Source) => extra.set(name, s);

/** Calendar items for [from, to], memoized on the data they derive from. */
export function useCalendarItems(from: LocalDate, to: LocalDate): CalItem[] {
  const derived = useDerived();
  const events = useData((s) => s.events);
  const lists = useData((s) => s.lists);
  const tags = useData((s) => s.tags);
  const cal = useSettings((s) => s.settings.calendar);

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
    for (const [name, src] of extra) {
      if ((name === "habits" && !cal.showHabits) || (name === "focus" && !cal.showFocus)) continue;
      items.push(...src(from, to));
    }
    return items;
  }, [derived, events, lists, tags, cal, from, to]);
}
