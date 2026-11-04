import { describe, expect, it } from "vitest";
import { addDaysLocal, atLocalTime } from "./dates";
import type { Habit, HabitFrequency } from "./habits";
import { dayOf, dayRun, levelOf, prepare, trophyCounts, TROPHIES, tierOfRun, weekQualifies, weekRun, type ProgressInput } from "./perfect";
import type { LocalDate, Task } from "./types";

// A Monday, so with weekStart 1 the week is 2026-10-26 … 2026-11-01.
const MON = "2026-10-26";
const day = (n: number) => addDaysLocal(MON, n);
const at = (d: LocalDate) => atLocalTime(d, "12:00").toISOString();

function task(due: LocalDate, handled: LocalDate | null, p: Partial<Task> = {}): Task {
  return {
    id: Math.random().toString(36),
    title: "",
    description: "",
    listId: "inbox",
    parentId: null,
    sectionId: null,
    status: handled ? "done" : "open",
    priority: 0,
    schedule: { kind: "day", date: due },
    recurrence: null,
    recurrenceParentId: null,
    tags: [],
    checklist: [],
    reminders: [],
    sortOrder: 0,
    pinned: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    completedAt: handled ? at(handled) : null,
    deletedAt: null,
    ...p,
  };
}

function habit(id: string, frequency: HabitFrequency = { kind: "daily" }): Habit {
  return { id, name: id, icon: "", color: "#000", goal: { kind: "once" }, frequency, reminders: [], groupId: null, sortOrder: 0, archived: false, startDate: "2026-01-01", createdAt: "2026-01-01T00:00:00.000Z" };
}

function input(p: Partial<ProgressInput> & { done?: Record<string, LocalDate[]> } = {}): ProgressInput {
  const maps = new Map(Object.entries(p.done ?? {}).map(([id, ds]) => [id, new Map(ds.map((d) => [d, 1]))]));
  return { tasks: [], habits: [], checkins: (id) => maps.get(id) ?? new Map(), restDays: new Set(), pushes: [], weekStart: 1, today: day(6), ...p };
}
const kind = (i: ProgressInput, d: LocalDate) => dayOf(prepare(i, MON), d).kind;

describe("perfect day", () => {
  it("is perfect when every due task is done that day", () => {
    expect(kind(input({ tasks: [task(day(0), day(0)), task(day(0), day(0))] }), day(0))).toBe("perfect");
  });
  it("fails on an open task, and on an overdue one from earlier", () => {
    expect(kind(input({ tasks: [task(day(0), day(0)), task(day(0), null)] }), day(0))).toBe("failed");
    expect(kind(input({ tasks: [task(day(1), day(1)), task(day(0), day(2))] }), day(1))).toBe("failed");
  });
  it("is neutral with nothing due, and a rest day overrides", () => {
    expect(kind(input(), day(0))).toBe("neutral");
    expect(kind(input({ tasks: [task(day(0), null)], restDays: new Set([day(0)]) }), day(0))).toBe("rest");
  });
  it("needs every daily habit at its goal; per-week habits don't count per day", () => {
    const tasks = [task(day(0), day(0))];
    const habits = [habit("a"), habit("w", { kind: "perWeek", count: 3 })];
    expect(kind(input({ tasks, habits }), day(0))).toBe("failed");
    expect(kind(input({ tasks, habits, done: { a: [day(0)] } }), day(0))).toBe("perfect");
  });
  it("fails when a task was pushed off on its due day", () => {
    const tasks = [task(day(0), day(0))];
    expect(kind(input({ tasks, pushes: [{ on: day(0), from: day(0), to: day(1) }] }), day(0))).toBe("failed");
    // Moving something before its day arrives is planning, not procrastinating.
    expect(kind(input({ tasks, pushes: [{ on: day(0), from: day(3), to: day(4) }] }), day(0))).toBe("perfect");
  });
  it("fails while a repeating task has a missed occurrence", () => {
    const series = task(day(0), null, { recurrence: { rule: "FREQ=DAILY", exdates: [] } });
    expect(kind(input({ tasks: [series] }), day(1))).toBe("failed");
  });
  it("stays pending today until it's perfect", () => {
    expect(kind(input({ tasks: [task(day(6), null)] }), day(6))).toBe("pending");
  });
});

describe("runs and weeks", () => {
  it("counts perfect days back from today, skipping neutral days", () => {
    const tasks = [task(day(2), day(2)), task(day(4), day(4)), task(day(5), day(5))];
    expect(dayRun(prepare(input({ tasks }), MON))).toBe(3);
    // A task left overdue fails every day until it's done.
    expect(dayRun(prepare(input({ tasks: [...tasks, task(day(3), day(6))] }), MON))).toBe(0);
  });
  it("qualifies a week at 90% with 3 active days, not below", () => {
    const good = [0, 1, 2, 3, 4].flatMap((n) => [task(day(n), day(n)), task(day(n), day(n))]);
    expect(weekQualifies(prepare(input({ tasks: good }), MON), MON)).toBe(true);
    const tenth = [...good.slice(0, 9), task(day(4), day(5))];
    expect(weekQualifies(prepare(input({ tasks: tenth }), MON), MON)).toBe(true);
    const two = [...good.slice(0, 8), task(day(4), day(5)), task(day(4), day(5))];
    expect(weekQualifies(prepare(input({ tasks: two }), MON), MON)).toBe(false);
    expect(weekQualifies(prepare(input({ tasks: good.slice(0, 4) }), MON), MON)).toBe(false);
  });
  it("requires weekly habits to reach their count", () => {
    const tasks = [0, 1, 2].map((n) => task(day(n), day(n)));
    const done = { w: [day(0), day(1), day(2)] };
    expect(weekQualifies(prepare(input({ tasks, habits: [habit("w", { kind: "perWeek", count: 4 })], done }), MON), MON)).toBe(false);
    expect(weekQualifies(prepare(input({ tasks, habits: [habit("w", { kind: "perWeek", count: 3 })], done }), MON), MON)).toBe(true);
  });
  it("chains weeks into months and years", () => {
    const tasks = [0, -7].flatMap((w) => [0, 1, 2].map((n) => task(day(w + n), day(w + n))));
    expect(weekRun(prepare(input({ tasks }), day(-7)), MON)).toBe(2);
    expect([1, 4, 8, 52].map(tierOfRun)).toEqual(["week", "month", "month", "year"]);
  });
});

describe("trophies", () => {
  it("counts from history and all-time totals", () => {
    const tasks = [0, 1, 2].map((n) => task(day(n), day(n)));
    const got = trophyCounts(prepare(input({ tasks }), MON), MON, { doneTasks: 100, focusMinutes: 90, bestHabitDays: 30 });
    expect(got).toEqual({ tasks: 100, focus: 1.5, habit: 30, days: 3, weeks: 1 });
  });
  it("climbs levels at each threshold", () => {
    const tasks = TROPHIES[0];
    expect([0, 9, 10, 24, 25, 2500, 9999].map((n) => levelOf(tasks, n))).toEqual([0, 0, 1, 1, 2, 8, 8]);
  });
});
