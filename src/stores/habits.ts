import { create } from "zustand";
import { select, upsert, write } from "../db/client";
import { habitToRow, parseCheckin, parseGroup, parseHabit } from "../db/habitRows";
import { parseAll, type Row } from "../db/rows";
import { todayLocal } from "../domain/dates";
import { isDone, type CheckinMap, type Habit, type HabitCheckin, type HabitGroup, type Mood } from "../domain/habits";
import { after, reorder } from "../domain/order";
import type { LocalDate } from "../domain/types";
import { uid } from "./data";
import { toast } from "./ui";

type ById<T> = Record<string, T>;
export type HabitData = { habits: Habit[]; groups: HabitGroup[]; checkins: HabitCheckin[] };
type State = {
  habits: ById<Habit>;
  groups: ById<HabitGroup>;
  /** habitId → date → check-in */
  checkins: Record<string, Record<LocalDate, HabitCheckin>>;
};

export const useHabits = create<State>(() => ({ habits: {}, groups: {}, checkins: {} }));
const get = useHabits.getState;
const set = useHabits.setState;
const byId = <T extends { id: string }>(xs: T[]): ById<T> => Object.fromEntries(xs.map((x) => [x.id, x]));

function nest(checkins: HabitCheckin[]): State["checkins"] {
  const out: State["checkins"] = {};
  for (const c of checkins) (out[c.habitId] ??= {})[c.date] = c;
  return out;
}

export async function hydrateHabits() {
  const [habits, groups, checkins] = await Promise.all(["habits", "habit_groups", "habit_checkins"].map((t) => select<Row>(`SELECT * FROM ${t}`)));
  set({ habits: byId(parseAll(habits, parseHabit)), groups: byId(parseAll(groups, parseGroup)), checkins: nest(parseAll(checkins, parseCheckin)) });
}

export function replaceHabits(d: HabitData) {
  set({ habits: byId(d.habits), groups: byId(d.groups), checkins: nest(d.checkins) });
}

export const allHabitData = (): HabitData => {
  const s = get();
  return { habits: Object.values(s.habits), groups: Object.values(s.groups), checkins: Object.values(s.checkins).flatMap((m) => Object.values(m)) };
};

export function saveHabitData(d: HabitData) {
  return write(
    ...d.groups.map((g) => upsert("habit_groups", { id: g.id, name: g.name, sort_order: g.sortOrder })),
    ...d.habits.map((h) => upsert("habits", habitToRow(h))),
    ...d.checkins.map((c) => checkinUpsert(c)),
  );
}

// ---------- habits ----------

const saveHabit = (h: Habit) => void write(upsert("habits", habitToRow(h)));

export function addHabit(input: Partial<Habit> & { name: string }): Habit {
  const h: Habit = {
    icon: "check",
    color: "#5b5bd6",
    goal: { kind: "once" },
    frequency: { kind: "daily" },
    reminders: [],
    groupId: null,
    archived: false,
    startDate: todayLocal(),
    ...input,
    sortOrder: after(Object.values(get().habits)),
    id: uid(),
    createdAt: new Date().toISOString(),
  };
  set((s) => ({ habits: { ...s.habits, [h.id]: h } }));
  saveHabit(h);
  return h;
}

export function updateHabit(id: string, patch: Partial<Habit>) {
  const h = get().habits[id];
  if (!h) return;
  const next = { ...h, ...patch };
  set((s) => ({ habits: { ...s.habits, [id]: next } }));
  saveHabit(next);
}

/** Permanently deletes the habit and its history (FK cascade). The UI confirms first. */
export function removeHabit(id: string) {
  set((s) => {
    const { [id]: _h, ...habits } = s.habits;
    const { [id]: _c, ...checkins } = s.checkins;
    return { habits, checkins };
  });
  void write(["DELETE FROM habits WHERE id = $1", [id]]);
}

export function reorderHabit(id: string, toIndex: number, siblingIds: string[]) {
  const items = siblingIds.map((x) => get().habits[x]).filter((h): h is Habit => !!h);
  for (const c of reorder(items, id, toIndex)) updateHabit(c.id, { sortOrder: c.sortOrder });
}

// ---------- check-ins ----------

function checkinUpsert(c: HabitCheckin): [string, unknown[]] {
  return [
    "INSERT INTO habit_checkins (habit_id, date, value, note, mood) VALUES ($1, $2, $3, $4, $5) " +
      "ON CONFLICT(habit_id, date) DO UPDATE SET value = excluded.value, note = excluded.note, mood = excluded.mood",
    [c.habitId, c.date, c.value, c.note, c.mood],
  ];
}

export function checkinOf(habitId: string, date: LocalDate): HabitCheckin | undefined {
  return get().checkins[habitId]?.[date];
}

/** Set any of value / note / mood for a day. An empty check-in is removed. */
export function setCheckin(habitId: string, date: LocalDate, patch: Partial<Pick<HabitCheckin, "value" | "note" | "mood">>) {
  const prev = checkinOf(habitId, date) ?? { habitId, date, value: 0, note: "", mood: null };
  const next: HabitCheckin = { ...prev, ...patch, value: Math.max(0, patch.value ?? prev.value) };
  const empty = next.value === 0 && !next.note && next.mood === null;
  set((s) => {
    const forHabit = { ...(s.checkins[habitId] ?? {}) };
    if (empty) delete forHabit[date];
    else forHabit[date] = next;
    return { checkins: { ...s.checkins, [habitId]: forHabit } };
  });
  void write(empty ? ["DELETE FROM habit_checkins WHERE habit_id = $1 AND date = $2", [habitId, date]] : checkinUpsert(next));
}

/** Tap: once-habits toggle; counted habits add `delta` (the row's menu offers −1). Check-ins toast an Undo. */
export function tapCheckin(h: Habit, date: LocalDate, delta = 1) {
  const value = checkinOf(h.id, date)?.value ?? 0;
  const next = h.goal.kind === "once" ? (isDone(h, value) ? 0 : 1) : Math.max(0, value + delta);
  setCheckin(h.id, date, { value: next });
  if (next > value) toast(isDone(h, next) && !isDone(h, value) ? `${h.name} done` : `${h.name}: ${next}`, { label: "Undo", run: () => setCheckin(h.id, date, { value }) });
}

export const setMood = (habitId: string, date: LocalDate, mood: Mood | null) => setCheckin(habitId, date, { mood });

const mapCache = new WeakMap<Record<LocalDate, HabitCheckin>, CheckinMap>();
const EMPTY: CheckinMap = new Map();
/** date → value, cached per (immutable) check-in record. */
export function valuesOf(records: Record<LocalDate, HabitCheckin> | undefined): CheckinMap {
  if (!records) return EMPTY;
  let m = mapCache.get(records);
  if (!m) mapCache.set(records, (m = new Map(Object.values(records).map((c) => [c.date, c.value]))));
  return m;
}

// ---------- groups ----------

export function addGroup(name: string): HabitGroup {
  const g: HabitGroup = { id: uid(), name, sortOrder: after(Object.values(get().groups)) };
  set((s) => ({ groups: { ...s.groups, [g.id]: g } }));
  void write(upsert("habit_groups", { id: g.id, name: g.name, sort_order: g.sortOrder }));
  return g;
}

export function removeGroup(id: string) {
  set((s) => {
    const { [id]: _g, ...groups } = s.groups;
    const habits = Object.fromEntries(Object.entries(s.habits).map(([k, h]) => [k, h.groupId === id ? { ...h, groupId: null } : h]));
    return { groups, habits };
  });
  void write(["DELETE FROM habit_groups WHERE id = $1", [id]]);
}
