import { describe, expect, it } from "vitest";
import { atLocalTime, timed, wallKey } from "./dates";
import { DEFAULT_RULES, patchForQuadrant, quadrantOf, type MatrixRules, type Quadrant } from "./matrix";
import { toVM, type TaskVM } from "./taskViews";
import type { Priority, Schedule, Task } from "./types";

const TODAY = "2026-10-25";
function vm(priority: Priority, schedule: Schedule = { kind: "none" }): TaskVM {
  const t: Task = {
    id: Math.random().toString(36),
    title: "t",
    description: "",
    listId: "inbox",
    parentId: null,
    sectionId: null,
    status: "open",
    priority,
    schedule,
    recurrence: null,
    recurrenceParentId: null,
    tags: [],
    checklist: [],
    reminders: [],
    sortOrder: 0,
    pinned: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    completedAt: null,
    deletedAt: null,
  };
  return toVM(t) as TaskVM;
}
const day = (date: string): Schedule => ({ kind: "day", date });
const q = (v: TaskVM, r: MatrixRules = DEFAULT_RULES) => quadrantOf(v, TODAY, r);

describe("quadrantOf (default rules: important = medium/high, urgent = due within 2 days or overdue)", () => {
  it("classifies the four combinations", () => {
    expect(q(vm(3, day(TODAY)))).toBe(1);
    expect(q(vm(2, day("2026-10-27")))).toBe(1); // 2 days out is still urgent
    expect(q(vm(3, day("2026-10-28")))).toBe(2); // 3 days out is not
    expect(q(vm(3))).toBe(2); // no date: never urgent
    expect(q(vm(1, day("2026-10-20")))).toBe(3); // overdue counts as urgent
    expect(q(vm(0))).toBe(4);
    expect(q(vm(1, day("2026-11-30")))).toBe(4);
  });

  it("follows custom thresholds", () => {
    const r: MatrixRules = { importantPriorities: [3], urgentDays: 0 };
    expect(q(vm(2, day(TODAY)), r)).toBe(3);
    expect(q(vm(3, day("2026-10-26")), r)).toBe(2);
  });
});

describe("patchForQuadrant", () => {
  const apply = (v: TaskVM, target: Quadrant, r = DEFAULT_RULES) => {
    const p = patchForQuadrant(v, target, TODAY, r);
    const next = toVM({ ...v.task, ...p }) as TaskVM;
    return { p, lands: quadrantOf(next, TODAY, r) };
  };

  it("moving to Do First sets High and due today when there's no date", () => {
    const { p, lands } = apply(vm(0), 1);
    expect(p).toEqual({ priority: 3, schedule: { kind: "day", date: TODAY } });
    expect(lands).toBe(1);
  });

  it("only touches attributes that disagree with the target", () => {
    expect(apply(vm(2, day(TODAY)), 2).p).toEqual({ schedule: { kind: "day", date: "2026-10-28" } });
    expect(apply(vm(2, day("2026-11-30")), 2).p).toEqual({});
    expect(apply(vm(3, day(TODAY)), 3).p).toEqual({ priority: 1 });
  });

  it("always lands in the requested quadrant from any starting point", () => {
    const starts = [vm(0), vm(1, day("2026-10-20")), vm(2, day(TODAY)), vm(3, day("2026-12-01")), vm(3, timed(atLocalTime("2026-11-10", "14:30"), 30))];
    for (const r of [DEFAULT_RULES, { importantPriorities: [3] as Priority[], urgentDays: 0 }, { importantPriorities: [1, 2, 3] as Priority[], urgentDays: 7 }])
      for (const s of starts) for (const target of [1, 2, 3, 4] as Quadrant[]) expect(apply(s, target, r).lands).toBe(target);
  });

  it("keeps a timed task's time of day when changing urgency", () => {
    const { p } = apply(vm(3, timed(atLocalTime("2026-11-10", "14:30"), 30)), 1);
    expect(p.schedule?.kind === "timed" && wallKey(new Date(p.schedule.start))).toBe("2026-10-25T14:30");
  });
});
