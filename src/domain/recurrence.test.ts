/// <reference types="node" />
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { atLocalTime, durationMinutes, timed, wallKey } from "./dates";
import { customRule, describeRule, detachOccurrence, isValidRule, effective, missedKeys, nextOccurrence, occurrencesBetween, shiftSeries, splitSeries, summarizeSchedule } from "./recurrence";
import type { Schedule, Task } from "./types";

describe("summarizeSchedule", () => {
  it("summarises date, time and repeat", () => {
    expect(summarizeSchedule({ kind: "none" }, null)).toBe("No date");
    expect(summarizeSchedule({ kind: "day", date: "2024-11-05" }, null)).toBe("Tue 5 Nov");
    expect(summarizeSchedule(timed(atLocalTime("2024-11-05", "09:00"), 60), "FREQ=WEEKLY")).toBe("Tue 5 Nov · 09:00 · Weekly");
    expect(summarizeSchedule({ kind: "day", date: "2024-11-05" }, "FREQ=DAILY;INTERVAL=3")).toMatch(/^Tue 5 Nov · Every 3 days/);
  });
});

// TZ=America/New_York (vite.config.ts). DST 2026: Mar 8 spring forward, Nov 1 fall back.

function task(schedule: Schedule, rule: string, exdates: string[] = []): Task {
  return {
    id: "s",
    title: "Series",
    description: "",
    listId: "inbox",
    parentId: null,
    sectionId: null,
    status: "open",
    priority: 0,
    schedule,
    recurrence: { rule, exdates },
    deadline: null, durationMin: null, waiting: null, recurrenceParentId: null,
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
}

const start = (s: Schedule) => (s.kind === "timed" ? new Date(s.start) : new Date(NaN));
const keys = (t: Task, from: Date, to: Date) => occurrencesBetween(t, from, to).map((o) => o.key);
const HOUR = 3_600_000;

describe("expansion across DST", () => {
  it("keeps 09:00 wall-clock through spring forward (23h day)", () => {
    const t = task(timed(atLocalTime("2026-03-06", "09:00"), 30), "FREQ=DAILY");
    const occ = occurrencesBetween(t, atLocalTime("2026-03-06", "00:00"), atLocalTime("2026-03-10", "23:59"));
    expect(occ.map((o) => wallKey(start(o.schedule)))).toEqual([
      "2026-03-06T09:00",
      "2026-03-07T09:00",
      "2026-03-08T09:00",
      "2026-03-09T09:00",
      "2026-03-10T09:00",
    ]);
    expect(start(occ[2].schedule).getTime() - start(occ[1].schedule).getTime()).toBe(23 * HOUR);
    expect(occ.every((o) => durationMinutes(o.schedule) === 30)).toBe(true);
  });

  it("keeps 09:00 wall-clock through fall back (25h day)", () => {
    const t = task(timed(atLocalTime("2026-10-30", "09:00"), 60), "FREQ=DAILY");
    const occ = occurrencesBetween(t, atLocalTime("2026-10-31", "00:00"), atLocalTime("2026-11-01", "23:59"));
    expect(occ.map((o) => wallKey(start(o.schedule)))).toEqual(["2026-10-31T09:00", "2026-11-01T09:00"]);
    expect(start(occ[1].schedule).getTime() - start(occ[0].schedule).getTime()).toBe(25 * HOUR);
  });

  it("preserves duration for an occurrence that spans the DST jump", () => {
    const t = task(timed(atLocalTime("2026-03-01", "01:30"), 90), "FREQ=WEEKLY");
    const [occ] = occurrencesBetween(t, atLocalTime("2026-03-08", "00:00"), atLocalTime("2026-03-08", "23:59"));
    expect(durationMinutes(occ.schedule)).toBe(90);
  });

  describe("southern hemisphere (Australia/Sydney, DST ends Apr 5 2026)", () => {
    const prev = process.env.TZ;
    beforeAll(() => void (process.env.TZ = "Australia/Sydney"));
    afterAll(() => void (process.env.TZ = prev));

    it("keeps 07:15 wall-clock through the change", () => {
      const t = task(timed(atLocalTime("2026-04-03", "07:15"), 15), "FREQ=DAILY");
      const occ = occurrencesBetween(t, atLocalTime("2026-04-03", "00:00"), atLocalTime("2026-04-06", "23:59"));
      expect(occ.map((o) => wallKey(start(o.schedule)).slice(11))).toEqual(["07:15", "07:15", "07:15", "07:15"]);
      expect(start(occ[2].schedule).getTime() - start(occ[1].schedule).getTime()).toBe(25 * HOUR);
    });
  });
});

describe("rules", () => {
  it("clamps monthly and yearly series to the month's last day (TIME-18, TIME-14)", () => {
    const monthly = task({ kind: "day", date: "2026-01-31" }, "FREQ=MONTHLY");
    expect(keys(monthly, atLocalTime("2026-01-01", "00:00"), atLocalTime("2026-04-30", "23:59"))).toEqual(["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"]);
    const leap = task({ kind: "day", date: "2024-02-29" }, "FREQ=YEARLY");
    expect(keys(leap, atLocalTime("2024-01-01", "00:00"), atLocalTime("2026-12-31", "23:59"))).toEqual(["2024-02-29", "2025-02-28", "2026-02-28"]);
    // Splitting at a clamped occurrence keeps the month-end rule for the tail.
    const { tail } = splitSeries(monthly, "2026-02-28", "n", "now");
    expect(keys(tail, atLocalTime("2026-02-01", "00:00"), atLocalTime("2026-04-30", "23:59"))).toEqual(["2026-02-28", "2026-03-31", "2026-04-30"]);
  });

  it("counts custom multi-week rules from the user's week start (TIME-09)", () => {
    const rule = customRule("WEEKLY", 2, ["SU", "MO"], 0);
    expect(rule).toBe("FREQ=WEEKLY;INTERVAL=2;BYDAY=SU,MO;WKST=SU");
    expect(customRule("WEEKLY", 2, ["SU", "MO"], 1)).toBe("FREQ=WEEKLY;INTERVAL=2;BYDAY=SU,MO");
    expect(customRule("DAILY", 3, ["MO"], 0)).toBe("FREQ=DAILY;INTERVAL=3");
    const t = task({ kind: "day", date: "2026-11-15" }, rule);
    expect(keys(t, atLocalTime("2026-11-15", "00:00"), atLocalTime("2026-12-14", "23:59"))).toEqual(["2026-11-15", "2026-11-16", "2026-11-29", "2026-11-30", "2026-12-13", "2026-12-14"]);
  });

  it("rejects rules that parse but can't expand, and sub-hourly ones (TIME-12)", () => {
    expect(isValidRule("FREQ=DAILY;BYDAY=XX")).toBe(false);
    expect(isValidRule("FREQ=SECONDLY")).toBe(false);
    expect(isValidRule("FREQ=MINUTELY")).toBe(false);
    expect(isValidRule("FREQ=WEEKLY;BYDAY=MO,WE")).toBe(true);
    expect(isValidRule("DTSTART;TZID=Europe/London:20260302T090000\nRRULE:FREQ=WEEKLY")).toBe(true);
  });

  it("expands weekly BYDAY on all-day schedules", () => {
    const t = task({ kind: "day", date: "2026-10-26" }, "FREQ=WEEKLY;BYDAY=MO,WE");
    expect(keys(t, atLocalTime("2026-10-26", "00:00"), atLocalTime("2026-11-08", "00:00"))).toEqual([
      "2026-10-26",
      "2026-10-28",
      "2026-11-02",
      "2026-11-04",
    ]);
  });

  it("skips months that lack the 31st (RFC 5545)", () => {
    const t = task({ kind: "day", date: "2026-01-31" }, "FREQ=MONTHLY;BYMONTHDAY=31");
    expect(keys(t, atLocalTime("2026-01-01", "00:00"), atLocalTime("2026-05-31", "23:59"))).toEqual([
      "2026-01-31",
      "2026-03-31",
      "2026-05-31",
    ]);
  });

  it("does not emit the anchor when it doesn't match BYDAY", () => {
    // Sunday anchor, Monday rule: first occurrence is Monday.
    const t = task({ kind: "day", date: "2026-10-25" }, "FREQ=WEEKLY;BYDAY=MO");
    expect(nextOccurrence(t)?.key).toBe("2026-10-26");
  });

  it("describes rules in English", () => {
    expect(describeRule("FREQ=WEEKLY;BYDAY=MO,WE")).toBe("Every week on Monday, Wednesday");
    expect(describeRule("garbage")).toBe("Custom");
  });
});

describe("exceptions", () => {
  it("removes exdates from expansion and from the current occurrence", () => {
    const t = task({ kind: "day", date: "2026-10-25" }, "FREQ=DAILY", ["2026-10-25", "2026-10-26"]);
    expect(keys(t, atLocalTime("2026-10-25", "00:00"), atLocalTime("2026-10-28", "00:00"))).toEqual([
      "2026-10-27",
      "2026-10-28",
    ]);
    expect(effective(t)?.schedule).toEqual({ kind: "day", date: "2026-10-27" });
  });

  it("reports a finished series once every occurrence is handled", () => {
    const t = task({ kind: "day", date: "2026-10-25" }, "FREQ=DAILY;COUNT=2", ["2026-10-25", "2026-10-26"]);
    expect(effective(t)).toBeNull();
  });

  it("detaches one occurrence as a standalone task", () => {
    const t = task(timed(atLocalTime("2026-10-25", "18:00"), 45), "FREQ=DAILY");
    const { series, single } = detachOccurrence(t, "2026-10-27T18:00", "n", "2026-10-25T00:00:00.000Z");
    expect(series.recurrence?.exdates).toEqual(["2026-10-27T18:00"]);
    expect(single.recurrence).toBeNull();
    expect(single.recurrenceParentId).toBe("s");
    expect(wallKey(start(single.schedule))).toBe("2026-10-27T18:00");
    expect(durationMinutes(single.schedule)).toBe(45);
  });
});

describe("splitSeries (this and following)", () => {
  const from = atLocalTime("2026-10-01", "00:00");
  const to = atLocalTime("2026-10-31", "23:59");

  it("partitions an open-ended series exactly", () => {
    const t = task({ kind: "day", date: "2026-10-01" }, "FREQ=WEEKLY;BYDAY=TH", ["2026-10-08"]);
    const all = keys(t, from, to);
    const { head, tail } = splitSeries(t, "2026-10-22", "n", "2026-10-01T00:00:00.000Z");
    expect(head && keys(head, from, to)).toEqual(["2026-10-01", "2026-10-15"]);
    expect(keys(tail, from, to)).toEqual(["2026-10-22", "2026-10-29"]);
    expect([...keys(head!, from, to), ...keys(tail, from, to)]).toEqual(all);
    expect(tail.id).toBe("n");
  });

  it("splits COUNT between the two halves", () => {
    const t = task({ kind: "day", date: "2026-10-01" }, "FREQ=DAILY;COUNT=5");
    const { head, tail } = splitSeries(t, "2026-10-03", "n", "x");
    expect(head && keys(head, from, to)).toEqual(["2026-10-01", "2026-10-02"]);
    expect(keys(tail, from, to)).toEqual(["2026-10-03", "2026-10-04", "2026-10-05"]);
  });

  it("returns no head when splitting at the first occurrence", () => {
    const t = task({ kind: "day", date: "2026-10-01" }, "FREQ=DAILY");
    expect(splitSeries(t, "2026-10-01", "n", "x").head).toBeNull();
  });

  it("splits timed series at the wall-clock key across DST", () => {
    const t = task(timed(atLocalTime("2026-10-29", "09:00"), 30), "FREQ=DAILY");
    const { head, tail } = splitSeries(t, "2026-11-02T09:00", "n", "x");
    const f = atLocalTime("2026-10-29", "00:00");
    const e = atLocalTime("2026-11-04", "00:00");
    expect(head && keys(head, f, e)).toEqual([
      "2026-10-29T09:00",
      "2026-10-30T09:00",
      "2026-10-31T09:00",
      "2026-11-01T09:00",
    ]);
    expect(keys(tail, f, e)).toEqual(["2026-11-02T09:00", "2026-11-03T09:00"]);
  });
});

describe("shiftSeries (all occurrences)", () => {
  const shiftAnchor = (anchor: Schedule, from: Schedule, to: Schedule) => {
    const key = from.kind === "timed" ? wallKey(new Date(from.start)) : from.kind === "day" ? from.date : "";
    return shiftSeries(task(anchor, "FREQ=DAILY"), key, to).schedule;
  };
  it("moves a day series by the same number of days", () => {
    expect(shiftAnchor({ kind: "day", date: "2026-10-01" }, { kind: "day", date: "2026-10-08" }, { kind: "day", date: "2026-10-10" })).toEqual({
      kind: "day",
      date: "2026-10-03",
    });
  });

  it("adopts the new wall-clock time and duration, even across DST", () => {
    const anchor = timed(atLocalTime("2026-10-29", "09:00"), 30);
    const from = timed(atLocalTime("2026-11-02", "09:00"), 30);
    const to = timed(atLocalTime("2026-11-02", "14:15"), 45);
    const s = shiftAnchor(anchor, from, to);
    expect(wallKey(start(s))).toBe("2026-10-29T14:15");
    expect(durationMinutes(s)).toBe(45);
  });

  it("turns a timed series all-day", () => {
    const anchor = timed(atLocalTime("2026-10-01", "09:00"), 30);
    expect(shiftAnchor(anchor, timed(atLocalTime("2026-10-05", "09:00"), 30), { kind: "day", date: "2026-10-06" })).toEqual({
      kind: "day",
      date: "2026-10-02",
    });
  });

  it("keeps handled occurrences handled when the time or day moves (TIME-02)", () => {
    const t = task(timed(atLocalTime("2026-11-01", "09:00"), 30), "FREQ=DAILY", ["2026-11-01T09:00", "2026-11-02T09:00", "2026-11-03T09:00"]);
    const later = { ...t, ...shiftSeries(t, "2026-11-04T09:00", timed(atLocalTime("2026-11-04", "10:00"), 30)) };
    expect(effective(later)?.key).toBe("2026-11-04T10:00");
    const dayLater = { ...t, ...shiftSeries(t, "2026-11-04T09:00", timed(atLocalTime("2026-11-05", "09:00"), 30)) };
    expect(dayLater.recurrence?.exdates).toEqual(["2026-11-02T09:00", "2026-11-03T09:00", "2026-11-04T09:00"]);
    expect(effective(dayLater)?.key).toBe("2026-11-05T09:00");
  });

  it("moves the dragged weekday of a BYDAY rule instead of the start date (TIME-08)", () => {
    const t = task({ kind: "day", date: "2026-11-16" }, "FREQ=WEEKLY;BYDAY=MO,WE,FR", ["2026-11-18"]);
    const moved = { ...t, ...shiftSeries(t, "2026-11-25", { kind: "day", date: "2026-11-26" }) };
    expect(moved.schedule).toEqual({ kind: "day", date: "2026-11-16" });
    expect(moved.recurrence?.exdates).toEqual(["2026-11-19"]);
    expect(keys(moved, atLocalTime("2026-11-16", "00:00"), atLocalTime("2026-11-22", "23:59"))).toEqual(["2026-11-16", "2026-11-20"]);
    expect(keys(moved, atLocalTime("2026-11-23", "00:00"), atLocalTime("2026-11-29", "23:59"))).toEqual(["2026-11-23", "2026-11-26", "2026-11-27"]);
  });
});

describe("custom rule end and nth weekday (TIME-19)", () => {
  const day = (date: string, rule: string, exdates: string[] = []) => task({ kind: "day", date }, rule, exdates);

  it("writes COUNT and a floating UNTIL", () => {
    expect(customRule("DAILY", 1, [], 1, { end: { kind: "count", n: 5 } })).toBe("FREQ=DAILY;COUNT=5");
    expect(customRule("WEEKLY", 2, [], 1, { end: { kind: "until", date: "2026-12-31" } })).toBe("FREQ=WEEKLY;INTERVAL=2;UNTIL=20261231T235959");
    expect(customRule("DAILY", 1, [], 1, { end: { kind: "never" } })).toBe("FREQ=DAILY");
  });

  it("stops at the count and at the until date", () => {
    const counted = day("2026-11-16", customRule("DAILY", 1, [], 1, { end: { kind: "count", n: 3 } }));
    expect(occurrencesBetween(counted, atLocalTime("2026-11-01", "00:00"), atLocalTime("2026-12-31", "00:00")).map((o) => o.key)).toEqual(["2026-11-16", "2026-11-17", "2026-11-18"]);
    const until = day("2026-11-16", customRule("DAILY", 1, [], 1, { end: { kind: "until", date: "2026-11-18" } }));
    expect(occurrencesBetween(until, atLocalTime("2026-11-01", "00:00"), atLocalTime("2026-12-31", "00:00")).map((o) => o.key)).toEqual(["2026-11-16", "2026-11-17", "2026-11-18"]);
  });

  it("repeats monthly on the 2nd Tuesday and the last Friday", () => {
    expect(customRule("MONTHLY", 1, [], 1, { nth: { n: 2, day: "TU" } })).toBe("FREQ=MONTHLY;BYDAY=2TU");
    expect(customRule("MONTHLY", 1, [], 1, { nth: { n: -1, day: "FR" } })).toBe("FREQ=MONTHLY;BYDAY=-1FR");
    const second = day("2026-11-10", "FREQ=MONTHLY;BYDAY=2TU");
    expect(occurrencesBetween(second, atLocalTime("2026-11-01", "00:00"), atLocalTime("2027-01-31", "00:00")).map((o) => o.key)).toEqual(["2026-11-10", "2026-12-08", "2027-01-12"]);
    const last = day("2026-11-27", "FREQ=MONTHLY;BYDAY=-1FR");
    expect(occurrencesBetween(last, atLocalTime("2026-11-01", "00:00"), atLocalTime("2027-01-31", "00:00")).map((o) => o.key)).toEqual(["2026-11-27", "2026-12-25", "2027-01-29"]);
  });

  it("describes them in words", () => {
    expect(describeRule("FREQ=MONTHLY;BYDAY=2TU")).toMatch(/2nd Tuesday/);
    expect(describeRule("FREQ=MONTHLY;BYDAY=-1FR")).toMatch(/last Friday/);
    expect(describeRule("FREQ=DAILY;COUNT=5")).toMatch(/for 5 times/);
    expect(describeRule("FREQ=DAILY;UNTIL=20261231T235959")).toMatch(/until December 31, 2026/);
  });
});

describe("missedKeys (TIME-20)", () => {
  it("lists unhandled occurrences before today", () => {
    const t = task({ kind: "day", date: "2026-11-10" }, "FREQ=DAILY", ["2026-11-11"]);
    expect(missedKeys(t, "2026-11-14")).toEqual(["2026-11-10", "2026-11-12", "2026-11-13"]);
    expect(missedKeys(t, "2026-11-10")).toEqual([]);
    expect(missedKeys({ ...t, recurrence: null }, "2026-11-14")).toEqual([]);
  });
});
