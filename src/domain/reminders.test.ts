import { describe, expect, it } from "vitest";
import { atLocalTime, timed, wallKey } from "./dates";
import type { Habit } from "./habits";
import { reminderAt, remindersBetween } from "./reminders";
import { toVM, type TaskVM } from "./taskViews";
import type { Reminder, Schedule, Task } from "./types";

// TZ=America/New_York; 2026-10-25 is a Sunday.

describe("reminders", () => {
  const vm = (schedule: Schedule, reminders: Reminder[], p: Partial<Task> = {}) =>
    toVM({ id: "t", title: "Dentist", description: "", listId: "inbox", parentId: null, sectionId: null, status: "open", priority: 0, schedule, recurrence: null, recurrenceParentId: null, tags: [], checklist: [], reminders, sortOrder: 0, pinned: false, createdAt: "", updatedAt: "", completedAt: null, deletedAt: null, ...p }) as TaskVM;

  it("computes fire times for timed and day schedules, across DST", () => {
    expect(wallKey(reminderAt(timed(atLocalTime("2026-10-26", "09:00"), 30), { kind: "before", minutes: 15 })!)).toBe("2026-10-26T08:45");
    expect(reminderAt({ kind: "day", date: "2026-10-26" }, { kind: "before", minutes: 15 })).toBeNull();
    expect(wallKey(reminderAt({ kind: "day", date: "2026-11-02" }, { kind: "dayOf", daysBefore: 1, time: "18:00" })!)).toBe("2026-11-01T18:00");
    // "1 day before" is wall-clock: 09:00 on Nov 1 (after fall-back) reminds at 09:00 Oct 31, not 10:00.
    expect(wallKey(reminderAt(timed(atLocalTime("2026-11-01", "09:00"), 30), { kind: "before", minutes: 1440 })!)).toBe("2026-10-31T09:00");
    expect(wallKey(reminderAt(timed(atLocalTime("2026-03-08", "09:00"), 30), { kind: "before", minutes: 1440 })!)).toBe("2026-03-07T09:00");
  });

  it("returns only reminders inside the window, for open tasks, with stable keys", () => {
    const a = vm(timed(atLocalTime("2026-10-25", "10:00"), 30), [{ kind: "before", minutes: 0 }, { kind: "before", minutes: 60 }]);
    const done = vm(timed(atLocalTime("2026-10-25", "10:00"), 30), [{ kind: "before", minutes: 0 }], { status: "done", id: "d" });
    const fires = remindersBetween([a, done], [], () => new Map(), atLocalTime("2026-10-25", "09:30"), atLocalTime("2026-10-25", "10:00"), "24h", 1);
    expect(fires.map((f) => wallKey(f.at))).toEqual(["2026-10-25T10:00"]);
    expect(fires[0].key).toBe(`task:t::${atLocalTime("2026-10-25", "10:00").toISOString()}`);
    expect(fires[0].body).toBe("Today at 10:00");
  });

  it("fires habit reminders only while the habit is still due", () => {
    const h: Habit = { id: "h", name: "Read", icon: "📚", color: "#000", goal: { kind: "once" }, frequency: { kind: "daily" }, reminders: ["20:00"], groupId: null, sortOrder: 0, archived: false, startDate: "2026-01-01", createdAt: "" };
    const win = [atLocalTime("2026-10-25", "19:00"), atLocalTime("2026-10-25", "21:00")] as const;
    expect(remindersBetween([], [h], () => new Map(), ...win, "24h", 1)).toHaveLength(1);
    expect(remindersBetween([], [h], () => new Map([["2026-10-25", 1]]), ...win, "24h", 1)).toHaveLength(0);
  });
});
