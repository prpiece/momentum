import type { CalItem } from "./calendar";

/** "Good morning" until noon, "Good afternoon" until 5pm, then "Good evening". */
export const greeting = (hour: number) => (hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening");

/**
 * What's coming up on Home: open tasks and events, soonest first, all-day before timed within a day.
 * A timed item that already ended is dropped; habit and focus markers are not "coming up".
 */
export function nextItems(items: readonly CalItem[], now: Date, limit: number): CalItem[] {
  return items
    .filter((i) => (i.source === "task" || i.source === "event") && !i.done && !(i.end && i.end <= now))
    .sort((a, b) => a.startDate.localeCompare(b.startDate) || Number(b.allDay) - Number(a.allDay) || (a.start?.getTime() ?? 0) - (b.start?.getTime() ?? 0))
    .slice(0, limit);
}
