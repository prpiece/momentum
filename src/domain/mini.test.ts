import { describe, expect, it } from "vitest";
import { DEFAULT_POMODORO, pause, start, type TimerState } from "./focus";
import { DEFAULT_RULES } from "./matrix";
import { buildSnapshot, miniClockMs, parseMiniAction, parseMiniSnapshot } from "./mini";
import { toVM, type TaskVM } from "./taskViews";
import type { Priority, Schedule, Task } from "./types";

const TODAY = "2026-10-25";
function vm(id: string, priority: Priority, schedule: Schedule, status: Task["status"] = "open"): TaskVM {
  const t: Task = {
    id, title: `T${id}`, description: "", listId: "inbox", parentId: null, sectionId: null, status, priority, schedule,
    recurrence: null, recurrenceParentId: null, tags: [], checklist: [], reminders: [], sortOrder: 0, pinned: false,
    createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", completedAt: null, deletedAt: null,
  };
  return toVM(t) as TaskVM;
}
const day = (date: string): Schedule => ({ kind: "day", date });
const idle: TimerState = { status: "idle" };
const snap = (vms: TaskVM[], timer: TimerState = idle, now = 1000) =>
  buildSnapshot(vms, new Map(vms.map((v) => [v.task.id, v])), timer, DEFAULT_POMODORO, DEFAULT_RULES, TODAY, now);

describe("buildSnapshot", () => {
  const vms = [vm("a", 3, day(TODAY)), vm("b", 0, day("2026-10-20")), vm("c", 2, day("2026-12-01")), vm("d", 0, { kind: "none" }), vm("e", 3, day(TODAY), "done")];

  it("lists open Today tasks (overdue included) and counts quadrants", () => {
    const s = snap(vms);
    expect(s.tasks.map((t) => t.id)).toEqual(["b", "a"]);
    expect(s.focusing).toBe(false);
    expect(s.matrix.map((q) => q.count)).toEqual([1, 1, 1, 1]); // a | c | b (overdue, low) | d
  });

  it("caps Today at 5 and each quadrant's titles at 3", () => {
    const many = Array.from({ length: 8 }, (_, i) => vm(`x${i}`, 3, day(TODAY)));
    const s = snap(many);
    expect(s.tasks).toHaveLength(5);
    expect(s.matrix[0].count).toBe(8);
    expect(s.matrix[0].top).toHaveLength(3);
  });

  it("shows only the focused task while the timer runs on an open task", () => {
    const s = snap(vms, start("pomodoro", "c", 0), 60_000);
    expect(s.tasks.map((t) => t.id)).toEqual(["c"]);
    expect(s.focusing).toBe(true);
    expect(s.timer).toMatchObject({ status: "running", phase: "focus", elapsedMs: 60_000, remainingMs: 24 * 60_000 });
  });

  it("falls back to Today when the focused task is done or unknown", () => {
    expect(snap(vms, start("pomodoro", "e", 0)).focusing).toBe(false);
    expect(snap(vms, start("pomodoro", "zzz", 0)).tasks.map((t) => t.id)).toEqual(["b", "a"]);
  });

  it("survives a JSON round trip through the validator", () => {
    const s = snap(vms, pause(start("stopwatch", "a", 0), 5000), 5000);
    expect(parseMiniSnapshot(JSON.parse(JSON.stringify(s)))).toEqual(s);
  });
});

describe("parsers", () => {
  it("accepts valid actions", () => {
    expect(parseMiniAction({ type: "toggle", id: "a", key: null })).toEqual({ type: "toggle", id: "a", key: null });
    expect(parseMiniAction({ type: "open", id: "a", key: "k" })).toEqual({ type: "open", id: "a", key: "k" });
    expect(parseMiniAction({ type: "focus", op: "start", taskId: null })).toEqual({ type: "focus", op: "start", taskId: null });
    expect(parseMiniAction({ type: "focus", op: "skip" })).toEqual({ type: "focus", op: "skip" });
  });
  it("rejects malformed actions and snapshots", () => {
    for (const bad of [null, "x", {}, { type: "toggle" }, { type: "toggle", id: 3 }, { type: "focus", op: "nuke" }, { type: "focus", op: "start" }, { type: "toggle", id: "a", key: 1 }])
      expect(parseMiniAction(bad)).toBeNull();
    expect(parseMiniSnapshot({})).toBeNull();
    expect(parseMiniSnapshot({ ...snap([]), matrix: [] })).toBeNull();
    expect(parseMiniSnapshot({ ...snap([]), timer: { status: "running" } })).toBeNull();
  });
});

describe("miniClockMs", () => {
  it("counts down a running pomodoro, counts up a stopwatch, holds when paused", () => {
    expect(miniClockMs({ status: "running", mode: "pomodoro", phase: "focus", elapsedMs: 0, remainingMs: 10_000 }, 0, 3000)).toBe(7000);
    expect(miniClockMs({ status: "running", mode: "pomodoro", phase: "focus", elapsedMs: 0, remainingMs: 1000 }, 0, 3000)).toBe(0);
    expect(miniClockMs({ status: "running", mode: "stopwatch", phase: "focus", elapsedMs: 5000, remainingMs: null }, 0, 2000)).toBe(7000);
    expect(miniClockMs({ status: "paused", mode: "stopwatch", phase: "focus", elapsedMs: 5000, remainingMs: null }, 0, 2000)).toBe(5000);
    expect(miniClockMs({ status: "idle" }, 0, 2000)).toBe(0);
  });
});
