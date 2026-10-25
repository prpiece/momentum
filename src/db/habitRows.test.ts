import { describe, expect, it } from "vitest";
import type { Habit } from "../domain/habits";
import { habitToRow, parseCheckin, parseFrequency, parseGoal, parseHabit } from "./habitRows";

describe("habit rows", () => {
  const h: Habit = {
    id: "h1",
    name: "Water",
    icon: "💧",
    color: "#2f6fed",
    goal: { kind: "count", target: 8, unit: "glasses" },
    frequency: { kind: "weekdays", days: [1, 3, 5] },
    reminders: ["09:00", "15:00"],
    groupId: null,
    sortOrder: 2,
    archived: false,
    startDate: "2026-09-01",
    createdAt: "2026-09-01T00:00:00.000Z",
  };

  it("round-trips", () => expect(parseHabit(habitToRow(h))).toEqual(h));

  it("repairs invalid goal, frequency and reminders", () => {
    expect(parseGoal({ kind: "count", target: -3 })).toEqual({ kind: "count", target: 1, unit: "" });
    expect(parseGoal("nope")).toEqual({ kind: "once" });
    expect(parseFrequency({ kind: "weekdays", days: [9, "x"] })).toEqual({ kind: "daily" });
    expect(parseFrequency({ kind: "perWeek", count: 12 })).toEqual({ kind: "perWeek", count: 7 });
    expect(parseHabit({ ...habitToRow(h), reminders: '["9am","10:30"]', color: "red" })).toMatchObject({ reminders: ["10:30"], color: "#5b5bd6" });
  });

  it("validates check-ins", () => {
    expect(parseCheckin({ habit_id: "h1", date: "2026-10-25", value: 3, note: "", mood: 9 })).toEqual({ habitId: "h1", date: "2026-10-25", value: 3, note: "", mood: null });
    expect(parseCheckin({ habit_id: "h1", date: "yesterday", value: 1 })).toBeNull();
  });
});
