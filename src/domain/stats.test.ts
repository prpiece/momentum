import { describe, expect, it } from "vitest";
import { atLocalTime } from "./dates";
import type { Habit } from "./habits";
import { byWeekday, completedByList, completedPerDay, completedPerWeek, dayStreaks, habitConsistency, heatLevel, niceScale } from "./stats";
import type { Task } from "./types";

const TODAY = "2026-10-25";
const done = (local: string, p: Partial<Task> = {}): Task =>
  ({
    id: Math.random().toString(36),
    title: "",
    description: "",
    listId: "inbox",
    parentId: null,
    sectionId: null,
    status: "done",
    priority: 0,
    schedule: { kind: "none" },
    recurrence: null,
    recurrenceParentId: null,
    tags: [],
    checklist: [],
    reminders: [],
    sortOrder: 0,
    pinned: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    completedAt: atLocalTime(local.slice(0, 10), local.slice(11) || "12:00").toISOString(),
    deletedAt: null,
    ...p,
  }) satisfies Task;

describe("completedPerDay", () => {
  it("buckets by local completion day and ignores open/deleted tasks", () => {
    const tasks = [done("2026-10-25T23:50"), done("2026-10-25T00:10"), done("2026-10-24"), done("2026-10-20"), done("2026-10-25", { status: "open" }), done("2026-10-25", { deletedAt: "2026-10-25T01:00:00.000Z" })];
    expect(completedPerDay(tasks, TODAY, 3).map((b) => [b.start, b.value])).toEqual([
      ["2026-10-23", 0],
      ["2026-10-24", 1],
      ["2026-10-25", 2],
    ]);
  });

  it("sums weeks by the week-start setting", () => {
    const tasks = [done("2026-10-19"), done("2026-10-25"), done("2026-10-18")];
    expect(completedPerWeek(tasks, TODAY, 2, 1).map((b) => [b.start, b.value])).toEqual([
      ["2026-10-12", 1],
      ["2026-10-19", 2],
    ]);
    expect(completedPerWeek(tasks, TODAY, 1, 0).map((b) => [b.start, b.value])).toEqual([["2026-10-25", 1]]);
  });
});

describe("habitConsistency", () => {
  it("averages per-habit rates and skips habits that expected nothing", () => {
    const h = (id: string, startDate: string): Habit => ({ id, name: id, icon: "", color: "#000", goal: { kind: "once" }, frequency: { kind: "daily" }, reminders: [], groupId: null, sortOrder: 0, archived: false, startDate, createdAt: "" });
    const values = (id: string) => new Map(id === "a" ? [["2026-10-23", 1]] : [["2026-10-23", 1], ["2026-10-24", 1]]);
    // a: 1 of 2 days (23, 24) = 0.5; b: 2 of 2 = 1; c starts later: ignored.
    expect(habitConsistency([h("a", "2026-10-23"), h("b", "2026-10-23"), h("c", "2026-11-01")], values, "2026-10-23", TODAY, TODAY, 1)).toBe(0.75);
  });
});

describe("niceScale", () => {
  it("rounds the axis up to friendly steps", () => {
    expect(niceScale(0)).toEqual({ top: 3, step: 1 });
    expect(niceScale(7)).toEqual({ top: 9, step: 3 });
    expect(niceScale(10)).toEqual({ top: 10, step: 5 });
    expect(niceScale(130)).toEqual({ top: 150, step: 50 });
  });
});

describe("motivation stats", () => {
  const b = (values: number[]) => values.map((value, i) => ({ start: `2026-10-${String(20 + i).padStart(2, "0")}`, label: "", value }));

  it("counts the current streak through an empty today, and the best run", () => {
    expect(dayStreaks(b([1, 1, 0, 2, 1, 3, 0]))).toEqual({ current: 3, best: 3 });
    expect(dayStreaks(b([1, 1, 1, 1, 0, 0, 1]))).toEqual({ current: 1, best: 4 });
    expect(dayStreaks(b([0, 0]))).toEqual({ current: 0, best: 0 });
  });

  it("sums by weekday and by list, and grades heat", () => {
    // 2026-10-20 is a Tuesday.
    expect(byWeekday(b([2, 0, 5]))).toEqual([0, 0, 2, 0, 5, 0, 0]);
    const tasks = [done("2026-10-25", { listId: "a" }), done("2026-10-24", { listId: "a" }), done("2026-10-24", { listId: "b" }), done("2026-09-01", { listId: "b" })];
    expect(completedByList(tasks, "2026-10-01")).toEqual([
      { listId: "a", value: 2 },
      { listId: "b", value: 1 },
    ]);
    expect([0, 1, 5, 10].map((v) => heatLevel(v, 10))).toEqual([0, 1, 2, 4]);
  });
});
