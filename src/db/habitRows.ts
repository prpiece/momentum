/* Habit row <-> domain mapping, validated at the DB boundary (pure; unit-tested). */
import { isInstant, isLocalDate, todayLocal } from "../domain/dates";
import type { Habit, HabitCheckin, HabitFrequency, HabitGoal, HabitGroup, Mood } from "../domain/habits";
import { isRecord } from "../domain/settings";
import type { Row } from "./rows";

function json(v: unknown): unknown {
  if (typeof v !== "string") return undefined;
  try {
    return JSON.parse(v);
  } catch {
    return undefined;
  }
}

const posInt = (v: unknown, max: number) => (typeof v === "number" && Number.isFinite(v) && v >= 1 ? Math.min(max, Math.round(v)) : null);

export function parseGoal(v: unknown): HabitGoal {
  if (isRecord(v) && (v.kind === "count" || v.kind === "amount")) {
    const target = typeof v.target === "number" && v.target > 0 && Number.isFinite(v.target) ? v.target : 1;
    return { kind: v.kind, target, unit: typeof v.unit === "string" ? v.unit.slice(0, 20) : "" };
  }
  return { kind: "once" };
}

export function parseFrequency(v: unknown): HabitFrequency {
  if (isRecord(v) && v.kind === "weekdays" && Array.isArray(v.days)) {
    const days = [...new Set(v.days.filter((d): d is number => Number.isInteger(d) && d >= 0 && d <= 6))].sort();
    if (days.length) return { kind: "weekdays", days };
  }
  if (isRecord(v) && v.kind === "perWeek") {
    const count = posInt(v.count, 7);
    if (count) return { kind: "perWeek", count };
  }
  return { kind: "daily" };
}

export function parseHabit(r: Row): Habit | null {
  if (typeof r.id !== "string" || typeof r.name !== "string") return null;
  const reminders = json(r.reminders);
  return {
    id: r.id,
    name: r.name,
    icon: typeof r.icon === "string" && r.icon ? r.icon : "✅",
    color: typeof r.color === "string" && /^#[0-9a-f]{6}$/i.test(r.color) ? r.color : "#5b5bd6",
    goal: parseGoal(json(r.goal)),
    frequency: parseFrequency(json(r.frequency)),
    reminders: Array.isArray(reminders) ? reminders.filter((x): x is string => typeof x === "string" && /^\d{2}:\d{2}$/.test(x)) : [],
    groupId: typeof r.group_id === "string" ? r.group_id : null,
    sortOrder: typeof r.sort_order === "number" ? r.sort_order : 0,
    archived: r.archived === 1,
    startDate: isLocalDate(r.start_date) ? r.start_date : todayLocal(),
    createdAt: isInstant(r.created_at) ? r.created_at : new Date().toISOString(),
  };
}

export const habitToRow = (h: Habit): Row => ({
  id: h.id,
  name: h.name,
  icon: h.icon,
  color: h.color,
  goal: JSON.stringify(h.goal),
  frequency: JSON.stringify(h.frequency),
  reminders: JSON.stringify(h.reminders),
  group_id: h.groupId,
  sort_order: h.sortOrder,
  archived: h.archived ? 1 : 0,
  start_date: h.startDate,
  created_at: h.createdAt,
});

const isMood = (v: unknown): v is Mood => v === 1 || v === 2 || v === 3 || v === 4 || v === 5;

export function parseCheckin(r: Row): HabitCheckin | null {
  if (typeof r.habit_id !== "string" || !isLocalDate(r.date)) return null;
  return {
    habitId: r.habit_id,
    date: r.date,
    value: typeof r.value === "number" && Number.isFinite(r.value) && r.value >= 0 ? r.value : 0,
    note: typeof r.note === "string" ? r.note : "",
    mood: isMood(r.mood) ? r.mood : null,
  };
}

export const parseGroup = (r: Row): HabitGroup | null =>
  typeof r.id === "string" && typeof r.name === "string" ? { id: r.id, name: r.name, sortOrder: typeof r.sort_order === "number" ? r.sort_order : 0 } : null;
