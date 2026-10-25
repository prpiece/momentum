/// <reference types="node" />
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { atLocalTime, durationMinutes, timed, wallKey } from "./dates";
import { describeRule, detachOccurrence, effective, nextOccurrence, occurrencesBetween, shiftAnchor, splitSeries } from "./recurrence";
import type { Schedule, Task } from "./types";

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

describe("shiftAnchor (all occurrences)", () => {
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
});
