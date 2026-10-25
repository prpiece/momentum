import { describe, expect, it } from "vitest";
import { addDaysLocal } from "./dates";
import { bestStreak, completionRate, currentStreak, frequencyLabel, isDueToday, isScheduled, type Habit, type HabitFrequency, type HabitGoal } from "./habits";

// 2026-10-25 is a Sunday. Weeks start Monday (weekStart = 1).
const TODAY = "2026-10-25";
const WS = 1 as const;

function habit(frequency: HabitFrequency, goal: HabitGoal = { kind: "once" }, startDate = "2026-09-01"): Habit {
  return { id: "h", name: "H", icon: "💧", color: "#000", goal, frequency, reminders: [], groupId: null, sortOrder: 0, archived: false, startDate, createdAt: "2026-09-01T00:00:00.000Z" };
}
/** Days back from today that were done, e.g. done(0, 1, 2) = today, yesterday, day before. */
const done = (...back: number[]) => new Map(back.map((b) => [addDaysLocal(TODAY, -b), 1]));

describe("daily streaks", () => {
  const h = habit({ kind: "daily" });
  it("counts consecutive days and breaks on a miss", () => {
    expect(currentStreak(h, done(0, 1, 2, 4), TODAY, WS)).toEqual({ count: 3, unit: "day" });
  });
  it("does not break because today isn't done yet", () => {
    expect(currentStreak(h, done(1, 2), TODAY, WS).count).toBe(2);
    expect(currentStreak(h, done(2, 3), TODAY, WS).count).toBe(0);
  });
  it("tracks the best run separately", () => {
    expect(bestStreak(h, done(1, 5, 6, 7, 8), TODAY, WS).count).toBe(4);
  });
  it("needs the target for counted goals", () => {
    const water = habit({ kind: "daily" }, { kind: "count", target: 8, unit: "glasses" });
    const m = new Map([
      [TODAY, 8],
      [addDaysLocal(TODAY, -1), 7],
    ]);
    expect(currentStreak(water, m, TODAY, WS).count).toBe(1);
  });
});

describe("specific weekdays", () => {
  const mwf = habit({ kind: "weekdays", days: [1, 3, 5] });
  it("only expects check-ins on scheduled days", () => {
    expect(isScheduled(mwf, "2026-10-26")).toBe(true); // Mon
    expect(isScheduled(mwf, "2026-10-25")).toBe(false); // Sun
    expect(isDueToday(mwf, new Map(), TODAY, WS)).toBe(false);
  });
  it("skips unscheduled days without breaking the streak", () => {
    // Fri 23, Wed 21, Mon 19 done; Sat/Sun/Tue/Thu irrelevant.
    const m = new Map(["2026-10-23", "2026-10-21", "2026-10-19"].map((d) => [d, 1]));
    expect(currentStreak(mwf, m, TODAY, WS).count).toBe(3);
    m.delete("2026-10-21");
    expect(currentStreak(mwf, m, TODAY, WS).count).toBe(1);
  });
});

describe("X times per week", () => {
  const thrice = habit({ kind: "perWeek", count: 3 });
  it("counts weeks that met the target, and the current week only once met", () => {
    // This week (Mon 19 – Sun 25): 2 done. Last week (12–18): 3 done. Week before (5–11): 3 done.
    const m = new Map(["2026-10-20", "2026-10-22", "2026-10-13", "2026-10-15", "2026-10-17", "2026-10-06", "2026-10-07", "2026-10-08"].map((d) => [d, 1]));
    expect(currentStreak(thrice, m, TODAY, WS)).toEqual({ count: 2, unit: "week" });
    m.set("2026-10-24", 1);
    expect(currentStreak(thrice, m, TODAY, WS).count).toBe(3);
  });
  it("is due today until this week's target is met", () => {
    const m = new Map(["2026-10-20", "2026-10-22"].map((d) => [d, 1]));
    expect(isDueToday(thrice, m, TODAY, WS)).toBe(true);
    m.set("2026-10-23", 1);
    expect(isDueToday(thrice, m, TODAY, WS)).toBe(false);
  });
  it("respects the week start setting", () => {
    // Sunday-start week Oct 25–31 has only today; Monday-start week has Mon–Sun.
    const m = new Map(["2026-10-20", "2026-10-22", "2026-10-24"].map((d) => [d, 1]));
    expect(currentStreak(thrice, m, TODAY, 1).count).toBe(1);
    expect(currentStreak(thrice, m, TODAY, 0).count).toBe(1); // previous Sun-start week (18–24) met it
  });
});

describe("completionRate", () => {
  it("ignores days before the habit started and today while unfinished", () => {
    const h = habit({ kind: "daily" }, { kind: "once" }, "2026-10-21");
    // Scheduled: 21, 22, 23, 24 (today excluded while not done). Done: 21, 23.
    expect(completionRate(h, new Map(["2026-10-21", "2026-10-23"].map((d) => [d, 1])), "2026-10-01", TODAY, TODAY, WS)).toBe(0.5);
    expect(completionRate(h, new Map(), "2026-10-01", "2026-10-10", TODAY, WS)).toBeNull();
  });
});

describe("frequencyLabel", () => {
  it("describes frequencies", () => {
    expect(frequencyLabel({ kind: "weekdays", days: [5, 1, 3] })).toBe("Mon, Wed, Fri");
    expect(frequencyLabel({ kind: "weekdays", days: [1, 2, 3, 4, 5] })).toBe("Weekdays");
    expect(frequencyLabel({ kind: "perWeek", count: 3 })).toBe("3× a week");
  });
});
