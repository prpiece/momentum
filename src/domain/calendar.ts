import { addMonths, format, startOfMonth, startOfWeek } from "date-fns";
import { addDaysLocal, atLocalTime, daysBetween, durationMinutes, fromLocalDate, moveToDate, scheduleDate, timed, toLocalDate } from "./dates";
import { occurrencesBetween } from "./recurrence";
import type { TaskVM } from "./taskViews";
import type { CalendarEvent, CalView, LocalDate, Schedule, Task, WeekStart } from "./types";

// ---------- ranges ----------

/** Days a view shows. Month is a full 6-week grid; agenda is the next 30 days. */
export function viewDays(view: CalView, anchor: LocalDate, weekStart: WeekStart): LocalDate[] {
  const range = (start: LocalDate, n: number) => Array.from({ length: n }, (_, i) => addDaysLocal(start, i));
  switch (view) {
    case "day":
      return [anchor];
    case "3day":
      return range(anchor, 3);
    case "week":
      return range(toLocalDate(startOfWeek(fromLocalDate(anchor), { weekStartsOn: weekStart })), 7);
    case "month":
      return range(toLocalDate(startOfWeek(startOfMonth(fromLocalDate(anchor)), { weekStartsOn: weekStart })), 42);
    case "agenda":
      return range(anchor, 30);
  }
}

export function stepAnchor(view: CalView, anchor: LocalDate, dir: 1 | -1): LocalDate {
  if (view === "month") return toLocalDate(addMonths(startOfMonth(fromLocalDate(anchor)), dir));
  const n = { day: 1, "3day": 3, week: 7, agenda: 7 }[view];
  return addDaysLocal(anchor, n * dir);
}

export function rangeTitle(view: CalView, days: LocalDate[], anchor: LocalDate): string {
  if (view === "month") return format(fromLocalDate(anchor), "MMMM yyyy");
  const a = fromLocalDate(days[0]);
  const b = fromLocalDate(days[days.length - 1]);
  if (days.length === 1) return format(a, "EEEE, MMMM d, yyyy");
  if (a.getFullYear() !== b.getFullYear()) return `${format(a, "MMM d, yyyy")} – ${format(b, "MMM d, yyyy")}`;
  if (a.getMonth() !== b.getMonth()) return `${format(a, "MMM d")} – ${format(b, "MMM d, yyyy")}`;
  return `${format(a, "MMM d")} – ${format(b, "d, yyyy")}`;
}

// ---------- items ----------

export type CalItem = {
  /** Unique per occurrence. */
  uid: string;
  /** `habit` items are read-only all-day markers (shown when the calendar option is on). */
  source: "task" | "event" | "habit" | "focus";
  id: string;
  /** Occurrence key for recurring series, null otherwise. */
  key: string | null;
  title: string;
  allDay: boolean;
  startDate: LocalDate;
  /** Last day covered (inclusive). */
  endDate: LocalDate;
  start: Date | null;
  end: Date | null;
  color: string;
  done: boolean;
  recurring: boolean;
  readOnly: boolean;
  priority: Task["priority"];
};

function itemOf(
  base: Omit<CalItem, "uid" | "allDay" | "startDate" | "endDate" | "start" | "end">,
  schedule: Schedule,
  spanDays = 1,
): CalItem | null {
  const startDate = scheduleDate(schedule);
  if (!startDate) return null;
  const uid = `${base.source}:${base.id}:${base.key ?? ""}`;
  if (schedule.kind === "timed") {
    const start = new Date(schedule.start);
    const end = new Date(schedule.end);
    // An item ending exactly at midnight doesn't cover the next day.
    const endDate = toLocalDate(new Date(Math.max(start.getTime(), end.getTime() - 1)));
    return { ...base, uid, allDay: false, startDate, endDate, start, end };
  }
  return { ...base, uid, allDay: true, startDate, endDate: addDaysLocal(startDate, Math.max(1, spanDays) - 1), start: null, end: null };
}

export type ItemSources = {
  tasks: readonly TaskVM[];
  events: readonly CalendarEvent[];
  colorOf: (t: Task) => string;
  showCompleted: boolean;
};

/** Every task and event (occurrence) touching [from, to], as calendar items. */
export function calendarItems(src: ItemSources, from: LocalDate, to: LocalDate): CalItem[] {
  const fromD = fromLocalDate(from);
  const toD = atLocalTime(to, "23:59");
  const inRange = (i: CalItem) => i.endDate >= from && i.startDate <= to;
  const out: CalItem[] = [];

  for (const vm of src.tasks) {
    const t = vm.task;
    if (t.status === "wont_do" || (t.status === "done" && !src.showCompleted)) continue;
    const base = {
      source: "task" as const,
      id: t.id,
      title: t.title,
      color: src.colorOf(t),
      done: t.status === "done",
      recurring: !!t.recurrence,
      readOnly: false,
      priority: t.priority,
    };
    const schedules = t.recurrence ? occurrencesBetween(t, fromD, toD) : [{ key: null, schedule: t.schedule }];
    for (const o of schedules) {
      const item = itemOf({ ...base, key: o.key }, o.schedule);
      if (item && inRange(item)) out.push(item);
    }
  }

  for (const e of src.events) {
    if (e.deletedAt) continue;
    const base = {
      source: "event" as const,
      id: e.id,
      title: e.title,
      color: e.color ?? "var(--accent)",
      done: false,
      recurring: !!e.recurrence,
      readOnly: e.source === "ics",
      priority: 0 as const,
    };
    // Multi-day all-day events: look back far enough to catch ones that started earlier.
    const lookback = new Date(fromD.getTime() - (e.spanDays - 1) * 86_400_000);
    const schedules = e.recurrence ? occurrencesBetween(e, lookback, toD) : [{ key: null, schedule: e.schedule }];
    for (const o of schedules) {
      const item = itemOf({ ...base, key: o.key }, o.schedule, e.spanDays);
      if (item && inRange(item)) out.push(item);
    }
  }
  return out;
}

export const coversDay = (i: CalItem, day: LocalDate) => i.startDate <= day && i.endDate >= day;

/** Items shown in a day cell: all-day first (longest first), then timed by start. */
export function itemsOnDay(items: readonly CalItem[], day: LocalDate): CalItem[] {
  return items
    .filter((i) => coversDay(i, day))
    .sort(
      (a, b) =>
        Number(b.allDay) - Number(a.allDay) ||
        daysBetween(b.startDate, b.endDate) - daysBetween(a.startDate, a.endDate) ||
        (a.start?.getTime() ?? 0) - (b.start?.getTime() ?? 0) ||
        a.title.localeCompare(b.title),
    );
}

// ---------- time grid layout ----------

export const MINUTES_PER_DAY = 1440;
export const SNAP = 15;

export const snap = (minutes: number, step = SNAP) =>
  Math.max(0, Math.min(MINUTES_PER_DAY, Math.round(minutes / step) * step));

/** Minutes since local midnight of `day` (DST days included: wall-clock, not elapsed time). */
export function minutesInDay(d: Date, day: LocalDate): number {
  const diff = daysBetween(day, toLocalDate(d));
  if (diff < 0) return 0;
  if (diff > 0) return MINUTES_PER_DAY;
  return d.getHours() * 60 + d.getMinutes();
}

export type Placed = { item: CalItem; top: number; bottom: number; col: number; cols: number };

/**
 * Side-by-side layout for one day column. Overlapping items form a cluster; each item takes
 * the first free column; every item in a cluster gets the cluster's column count.
 * Very short items are treated as 20 minutes tall so their labels don't collide.
 */
export function layoutDay(items: readonly CalItem[], day: LocalDate, minHeight = 20): Placed[] {
  const placed = items
    .filter((i) => !i.allDay && i.start && i.end && coversDay(i, day))
    .map((item) => {
      const top = item.start ? minutesInDay(item.start, day) : 0;
      const raw = item.end ? minutesInDay(item.end, day) : top;
      return { item, top, bottom: Math.max(raw, top + minHeight), col: 0, cols: 1 };
    })
    .sort((a, b) => a.top - b.top || b.bottom - a.bottom);

  let cluster: Placed[] = [];
  let clusterEnd = -1;
  let colEnds: number[] = [];
  const flush = () => cluster.forEach((p) => (p.cols = colEnds.length));
  for (const p of placed) {
    if (p.top >= clusterEnd) {
      flush();
      cluster = [];
      colEnds = [];
    }
    let col = colEnds.findIndex((end) => end <= p.top);
    if (col === -1) col = colEnds.push(0) - 1;
    colEnds[col] = p.bottom;
    p.col = col;
    cluster.push(p);
    clusterEnd = Math.max(clusterEnd, p.bottom);
  }
  flush();
  return placed;
}

/** Stable color for things without one (tags): picks from the accent presets by name hash. */
export function hashColor(name: string, palette: readonly string[]): string {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return palette[Math.abs(h) % palette.length];
}

// ---------- drop & resize math ----------

export const hhmmOf = (minutes: number) => {
  const m = Math.max(0, Math.min(MINUTES_PER_DAY - SNAP, minutes));
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};

export type SlotMode = "time" | "allDay" | "keepTime";

/**
 * Schedule for something dropped on the calendar. `time` columns use the snapped pointer
 * minute and keep the item's duration (new items get `defaultMinutes`); the all-day row makes
 * it all-day; month cells keep its time of day.
 */
export function droppedSchedule(current: Schedule, date: LocalDate, mode: SlotMode, startMinutes: number, defaultMinutes = 60): Schedule {
  if (mode === "allDay") return { kind: "day", date };
  if (mode === "keepTime") return current.kind === "timed" ? moveToDate(current, date) : { kind: "day", date };
  const duration = durationMinutes(current) ?? defaultMinutes;
  return timed(atLocalTime(date, hhmmOf(snap(startMinutes))), duration);
}

/** Drag a timed block's top or bottom edge on `day`; keeps at least one snap step. */
export function resizedSchedule(s: Schedule, edge: "start" | "end", minutes: number, day: LocalDate): Schedule {
  if (s.kind !== "timed") return s;
  const start = new Date(s.start);
  const end = new Date(s.end);
  const m = snap(minutes);
  if (edge === "end") {
    const startMin = minutesInDay(start, day);
    const endAt = m >= MINUTES_PER_DAY ? atLocalTime(addDaysLocal(day, 1), "00:00") : atLocalTime(day, hhmmOf(Math.max(m, startMin + SNAP)));
    return { kind: "timed", start: s.start, end: endAt.toISOString() };
  }
  const endMin = minutesInDay(end, day);
  const startAt = atLocalTime(day, hhmmOf(Math.min(m, endMin - SNAP)));
  return { kind: "timed", start: startAt.toISOString(), end: s.end };
}
