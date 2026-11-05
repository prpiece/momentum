import { describe, expect, it } from "vitest";
import { atLocalTime } from "./dates";
import type { FocusSession } from "./focus";
import { shareSummary } from "./shareCard";
import type { Task } from "./types";

const TODAY = "2026-10-28"; // a Wednesday
const done = (day: string) => ({ id: day + Math.random(), status: "done", completedAt: atLocalTime(day, "12:00").toISOString(), deletedAt: null }) as unknown as Task;
const session = (day: string, seconds: number): FocusSession => ({ id: day, taskId: null, mode: "pomodoro", startAt: atLocalTime(day, "09:00").toISOString(), endAt: atLocalTime(day, "10:00").toISOString(), seconds });
const counts = { tasks: 30, focus: 6, habit: 0, days: 0, weeks: 0 };

describe("shareSummary", () => {
  const tasks = [done("2026-10-26"), done("2026-10-27"), done("2026-10-28"), done("2026-10-28"), done("2026-10-20")];
  const sessions = [session("2026-10-27", 5400), session("2026-10-20", 3600)];

  it("sums a Monday-start week", () => {
    const s = shareSummary(tasks, sessions, TODAY, "week", 1, (d) => d === "2026-10-27", counts);
    expect(s.from).toBe("2026-10-26");
    expect(s.bars.map((b) => b.value)).toEqual([1, 1, 2, 0, 0, 0, 0]);
    expect([s.tasks, s.focusHours, s.perfectDays, s.streak]).toEqual([4, 1.5, 1, 3]);
  });
  it("covers the last 30 days for a month", () => {
    const s = shareSummary(tasks, sessions, TODAY, "month", 1, () => false, counts);
    expect(s.bars).toHaveLength(30);
    expect([s.tasks, s.focusHours]).toEqual([5, 2.5]);
  });
  it("picks the highest trophy level", () => {
    expect(shareSummary([], [], TODAY, "week", 1, () => false, counts).top).toEqual({ id: "tasks", level: 2 });
    expect(shareSummary([], [], TODAY, "week", 1, () => false, { ...counts, tasks: 0, focus: 0 }).top).toBeNull();
  });
});
