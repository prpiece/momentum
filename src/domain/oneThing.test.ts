import { describe, expect, it } from "vitest";
import { atLocalTime, setDayEndHour, timed } from "./dates";
import { DEFAULT_RULES } from "./matrix";
import { pickOneThing } from "./oneThing";
import { toVM, type TaskVM } from "./taskViews";
import type { Task } from "./types";

const TODAY = "2026-10-25";
let n = 0;
const vm = (p: Partial<Task>): TaskVM =>
  toVM({
    id: `t${++n}`, title: `T${n}`, description: "", listId: "inbox", parentId: null, sectionId: null, status: "open", priority: 0,
    schedule: { kind: "day", date: TODAY }, deadline: null, durationMin: null, waiting: null, recurrence: null, recurrenceParentId: null,
    tags: [], checklist: [], reminders: [], sortOrder: n, pinned: false, createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z",
    completedAt: null, deletedAt: null, ...p,
  }) as TaskVM;

describe("pickOneThing", () => {
  it("a block just after midnight belongs to the running day under an end-of-day hour", () => {
    const night = vm({ schedule: timed(atLocalTime("2026-10-26", "01:00"), 30) });
    setDayEndHour(3);
    try {
      expect(pickOneThing([night], TODAY, DEFAULT_RULES, "normal")?.task.id).toBe(night.task.id);
    } finally {
      setDayEndHour(0);
    }
  });
  it("picks by quadrant, then deadline, then the incoming order", () => {
    const low = vm({ priority: 0 });
    const imp = vm({ priority: 3, schedule: { kind: "day", date: "2026-10-24" } });
    const impLater = vm({ priority: 3, deadline: "2026-10-26" });
    const impSoon = vm({ priority: 3, deadline: "2026-10-25" });
    expect(pickOneThing([low, imp, impLater, impSoon], TODAY, DEFAULT_RULES, "normal")?.task.id).toBe(impSoon.task.id);
    expect(pickOneThing([low, imp], TODAY, DEFAULT_RULES, "normal")?.task.id).toBe(imp.task.id);
    expect(pickOneThing([vm({}), low], TODAY, DEFAULT_RULES, "normal")?.task.id).not.toBe(low.task.id);
  });
  it("Low energy shows only tasks of 15 minutes or less; no duration counts as Normal", () => {
    const long = vm({ priority: 3, durationMin: 60 });
    const none = vm({ priority: 3 });
    const short = vm({ durationMin: 15 });
    const timedShort = vm({ schedule: timed(atLocalTime(TODAY, "09:00"), 10) });
    expect(pickOneThing([long, none, short], TODAY, DEFAULT_RULES, "low")?.task.id).toBe(short.task.id);
    expect(pickOneThing([long, none, timedShort], TODAY, DEFAULT_RULES, "low")?.task.id).toBe(timedShort.task.id);
    expect(pickOneThing([long, none], TODAY, DEFAULT_RULES, "low")).toBeNull();
  });
  it("skips tasks moved to tomorrow even when a past deadline keeps them in Today", () => {
    const later = vm({ priority: 3, deadline: "2026-10-20", schedule: { kind: "day", date: "2026-10-26" } });
    const other = vm({});
    expect(pickOneThing([later, other], TODAY, DEFAULT_RULES, "normal")?.task.id).toBe(other.task.id);
  });
});
