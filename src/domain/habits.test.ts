import { describe, expect, it } from "vitest";
import { addDaysLocal } from "./dates";
import { dropHabitOn, daysSinceSlip, isPausedOn, resumedOn, withPause, bestStreak, completionRate, currentStreak, frequencyLabel, goalLabel, isDone, isDoneOn, isDueToday, isScheduled, type Habit, type HabitFrequency, type HabitGoal, periodValue } from "./habits";

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

describe("v1.2.4 fixes", () => {
  it("HAB-02: a target below 1 is honoured", () => {
    const h = habit({ kind: "daily" }, { kind: "amount", target: 0.5, unit: "L", period: "day" });
    expect(isDone(h, 0.5)).toBe(true);
    expect(isDone(h, 0.4)).toBe(false);
  });
  it("HAB-08: a partial first week is judged against the days that exist", () => {
    // Start Thu 2026-10-22; Thu..Sun done; per-week 5 can only ever reach 4 in week 1
    const h = habit({ kind: "perWeek", count: 5 }, { kind: "once" }, "2026-10-22");
    const c = new Map(["2026-10-22", "2026-10-23", "2026-10-24", "2026-10-25"].map((d) => [d, 1]));
    expect(currentStreak(h, c, TODAY, WS).count).toBe(1);
    expect(completionRate(h, c, "2026-10-22", TODAY, TODAY, WS)).toBe(1);
  });
  it("HAB-09: one done-on rule for weekly totals and per-week habits", () => {
    const wk = habit({ kind: "daily" }, { kind: "amount", target: 20, unit: "km", period: "week" });
    const c = new Map([["2026-10-20", 21]]);
    expect(isDoneOn(wk, c, TODAY, WS)).toBe(true); // week met, even though today's value is 0
    expect(isDueToday(wk, c, TODAY, WS)).toBe(false); // and it leaves Today
    expect(isDueToday(wk, new Map([...c, [TODAY, 1]]), TODAY, WS)).toBe(true); // unless logged today
    const pw = habit({ kind: "perWeek", count: 2 });
    expect(isDoneOn(pw, new Map([["2026-10-20", 1], ["2026-10-21", 1]]), TODAY, WS)).toBe(true);
    expect(isDoneOn(pw, new Map([["2026-10-20", 1]]), TODAY, WS)).toBe(false);
  });
});

describe("HAB-23: paused habits", () => {
  const paused = (from: string, to: string | null, f: HabitFrequency = { kind: "daily" }): Habit => ({ ...habit(f), pauses: [{ from, to }] });
  it("a paused day isn't scheduled or due, and doesn't break the streak", () => {
    const h = paused(addDaysLocal(TODAY, -3), addDaysLocal(TODAY, -2)); // two missed days
    expect(isPausedOn(h, addDaysLocal(TODAY, -2))).toBe(true);
    expect(isScheduled(h, addDaysLocal(TODAY, -3))).toBe(false);
    expect(currentStreak(h, done(0, 1, 4, 5), TODAY, WS).count).toBe(4);
    expect(currentStreak({ ...h, pauses: [] }, done(0, 1, 4, 5), TODAY, WS).count).toBe(2);
    expect(bestStreak(h, done(0, 1, 4, 5), TODAY, WS).count).toBe(4);
  });
  it("an open pause isn't due today and skips quit days from completion", () => {
    const h = paused(addDaysLocal(TODAY, -1), null);
    expect(isDueToday(h, new Map(), TODAY, WS)).toBe(false);
    expect(completionRate(h, done(3), addDaysLocal(TODAY, -3), TODAY, TODAY, WS)).toBe(0.5); // days -3 done, -2 missed; -1 and today paused
  });
  it("a per-week target shrinks to the unpaused days, and a fully paused week is met", () => {
    const week = habit({ kind: "perWeek", count: 5 }); // week of Mon 2026-10-19
    const h = { ...week, pauses: [{ from: "2026-10-22", to: "2026-10-25" }] }; // Mon-Wed left
    expect(isDoneOn(h, new Map([["2026-10-19", 1], ["2026-10-20", 1], ["2026-10-21", 1]]), "2026-10-25", WS)).toBe(true);
    expect(isDoneOn(h, new Map([["2026-10-19", 1]]), "2026-10-25", WS)).toBe(false);
    expect(isDoneOn({ ...week, pauses: [{ from: "2026-10-19", to: "2026-10-25" }] }, new Map(), "2026-10-25", WS)).toBe(true);
  });
  it("resume closes the pause the day before; a pause not yet started is dropped", () => {
    expect(resumedOn([{ from: "2026-10-20", to: null }], "2026-10-25")).toEqual([{ from: "2026-10-20", to: "2026-10-24" }]);
    expect(resumedOn([{ from: "2026-10-25", to: "2026-10-27" }, { from: "2026-10-01", to: "2026-10-03" }], "2026-10-25")).toEqual([{ from: "2026-10-01", to: "2026-10-03" }]);
    expect(withPause(undefined, "2026-10-25", "2026-10-25")).toEqual([{ from: "2026-10-25", to: "2026-10-25" }]);
  });
});

describe("HAB-24: days since last slip", () => {
  const quit = { ...habit({ kind: "daily" }, { kind: "quit" }), startDate: "2026-10-15" };
  it("counts from the last slip, ignoring earlier ones", () => {
    expect(daysSinceSlip(quit, new Map([["2026-10-18", 2], ["2026-10-22", 1]]), TODAY)).toEqual({ days: 3, slipped: true });
  });
  it("counts from the start when never slipped, 0 on the start day", () => {
    expect(daysSinceSlip(quit, new Map(), TODAY)).toEqual({ days: 10, slipped: false });
    expect(daysSinceSlip(quit, new Map(), "2026-10-15")?.days).toBe(0);
  });
  it("a limit habit slips only over the cap; build habits have none", () => {
    const limit = { ...habit({ kind: "daily" }, { kind: "limit", cap: 5, unit: "min" }), startDate: "2026-10-15" };
    expect(daysSinceSlip(limit, new Map([["2026-10-24", 5], ["2026-10-20", 6]]), TODAY)).toEqual({ days: 5, slipped: true });
    expect(daysSinceSlip(habit({ kind: "daily" }), new Map(), TODAY)).toBeNull();
  });
});

describe("dropHabitOn", () => {
  const h = (id: string, groupId: string | null, sortOrder: number, archived = false): Habit => ({ ...habit({ kind: "daily" }), id, groupId, sortOrder, archived });
  const G = new Set(["A", "B"]);
  const apply = (hs: Habit[], r: NonNullable<ReturnType<typeof dropHabitOn>>, id: string) => hs.filter((x) => (x.id === id ? r.groupId : x.groupId) === r.groupId && !x.archived).map((x) => ({ id: x.id, o: r.changes.find((c) => c.id === x.id)?.sortOrder ?? x.sortOrder })).sort((a, b) => a.o - b.o).map((x) => x.id);
  const hs = [h("a1", "A", 0), h("n1", null, 1), h("a2", "A", 2), h("b1", "B", 3), h("b2", "B", 4)];

  it("a habit from another group lands directly above the target, in the target's group", () => {
    const r = dropHabitOn(hs, G, "n1", "a2")!;
    expect(r.groupId).toBe("A");
    expect(apply(hs, r, "n1")).toEqual(["a1", "n1", "a2"]);
  });
  it("moves within a group: down lands after the target, up before it", () => {
    expect(apply(hs, dropHabitOn(hs, G, "a1", "a2")!, "a1")).toEqual(["a2", "a1"]);
    expect(apply(hs, dropHabitOn(hs, G, "a2", "a1")!, "a2")).toEqual(["a2", "a1"]);
  });
  it("dangling group counts as ungrouped; self, archived and unknown drops do nothing", () => {
    const d = [h("x", "gone", 0), h("n", null, 1)];
    expect(dropHabitOn(d, G, "n", "x")!.groupId).toBeNull();
    expect(dropHabitOn(hs, G, "a1", "a1")).toBeNull();
    expect(dropHabitOn([...hs, h("z", "A", 9, true)], G, "a1", "z")).toBeNull();
    expect(dropHabitOn(hs, G, "a1", "nope")).toBeNull();
  });
});
