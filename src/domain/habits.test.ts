import { describe, expect, it } from "vitest";
import { addDaysLocal } from "./dates";
import { bestStreak, completionRate, currentStreak, frequencyLabel, goalLabel, isDone, isDueToday, isScheduled, type Habit, type HabitFrequency, type HabitGoal, periodValue } from "./habits";

// 2026-10-25 is a Sunday. Weeks start Monday (weekStart = 1).
const TODAY = "2026-10-25";
const WS = 1 as const;

function habit(frequency: HabitFrequency, goal: HabitGoal = { kind: "once" }, startDate = "2026-09-01"): Habit {
  return { id: "h", name: "H", icon: "💧", color: "#000", goal, frequency, reminders: [], groupId: null, sortOrder: 0, archived: false, startDate, createdAt: "2026-09-01T00:00:00.000Z" };
}
/** Days back from today that were done, e.g. done(0, 1, 2) = today, yesterday, day before. */
const done = (...back: number[]) => new Map(back.map((b) => [addDaysLocal(TODAY, -b), 1]));

describe("weekly limit and quit habits count only elapsed days from the start date", () => {
  const quit = (startDate: string) => habit({ kind: "perWeek", count: 3 }, { kind: "quit" }, startDate);
  it("is not met on Tuesday just because the rest of the week is unlogged", () => {
    expect(isDueToday(quit("2026-10-19"), new Map(), "2026-10-20", WS)).toBe(true);
    expect(currentStreak(quit("2026-10-19"), new Map(), "2026-10-20", WS).count).toBe(0);
  });
  it("ignores days before the start date", () => {
    expect(currentStreak(quit("2026-10-23"), new Map(), TODAY, WS).count).toBe(0); // Fri + Sat passed = 2 < 3
    expect(currentStreak(quit("2026-10-22"), new Map(), TODAY, WS).count).toBe(1); // Thu, Fri, Sat = 3
  });
  it("a slip on a passed day does not count", () => {
    const slip = new Map([["2026-10-23", 1]]);
    expect(currentStreak(quit("2026-10-22"), slip, TODAY, WS).count).toBe(0);
  });
});

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
    const water = habit({ kind: "daily" }, { kind: "count", target: 8, unit: "glasses", period: "day" });
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

describe("limit habits", () => {
  const h = habit({ kind: "daily" }, { kind: "limit", cap: 5, unit: "min" });
  it("succeeds at or under the cap, fails over it", () => {
    expect(isDone(h, undefined)).toBe(true);
    expect(isDone(h, 5)).toBe(true);
    expect(isDone(h, 6)).toBe(false);
  });
  it("counts unlogged days as success and breaks on an over day", () => {
    const m = new Map([[addDaysLocal(TODAY, -2), 9]]);
    expect(currentStreak(h, m, TODAY, WS).count).toBe(2); // yesterday and today
    expect(bestStreak(h, m, TODAY, WS).count).toBe(52); // 1 Sep .. the day before the over day
  });
  it("an over-limit today breaks the streak straight away", () => {
    expect(currentStreak(h, new Map([[TODAY, 9]]), TODAY, WS).count).toBe(0);
  });
  it("completion rate includes today once it has failed", () => {
    expect(completionRate(h, new Map([[TODAY, 9]]), addDaysLocal(TODAY, -3), TODAY, TODAY, WS)).toBe(0.75);
    expect(completionRate(h, new Map(), addDaysLocal(TODAY, -3), TODAY, TODAY, WS)).toBe(1);
  });
});

describe("quit habits", () => {
  const h = habit({ kind: "daily" }, { kind: "quit" });
  it("a slip fails the day", () => {
    expect(isDone(h, undefined)).toBe(true);
    expect(isDone(h, 1)).toBe(false);
  });
  it("streak counts days since the last slip", () => {
    const m = new Map([[addDaysLocal(TODAY, -3), 1]]);
    expect(currentStreak(h, m, TODAY, WS).count).toBe(3);
  });
});

it("goalLabel describes each kind", () => {
  expect(goalLabel({ kind: "limit", cap: 5, unit: "min" })).toBe("max 5 min a day");
  expect(goalLabel({ kind: "quit" })).toBe("none");
  expect(goalLabel({ kind: "once" })).toBe("");
});

describe("weekly totals for count and amount (D267)", () => {
  const run = habit({ kind: "daily" }, { kind: "amount", target: 20, unit: "km", period: "week" });
  const checkins = (xs: [string, number][]) => new Map(xs);
  it("a week succeeds once its check-ins add up to the target", () => {
    const m = checkins([["2026-10-19", 8], ["2026-10-21", 7]]);
    expect(currentStreak(run, m, "2026-10-21", WS)).toEqual({ count: 0, unit: "week" });
    const met = checkins([["2026-10-19", 8], ["2026-10-21", 7], ["2026-10-23", 6]]);
    expect(currentStreak(run, met, "2026-10-23", WS)).toEqual({ count: 1, unit: "week" });
    expect(periodValue(run, met, "2026-10-23", WS)).toBe(21);
    expect(goalLabel(run.goal)).toBe("20 km a week");
  });
  it("stays in Today all week and counts weeks for the completion rate", () => {
    const m = checkins([["2026-10-12", 25], ["2026-10-20", 5]]);
    expect(isDueToday(run, m, "2026-10-20", WS)).toBe(true);
    // The current week (5 of 20 km so far) is still open, so only the met week counts.
    expect(completionRate(run, m, "2026-10-12", "2026-10-25", "2026-10-25", WS)).toBe(1);
    expect(completionRate(run, m, "2026-10-12", "2026-10-25", "2026-10-26", WS)).toBe(0.5);
  });
});
