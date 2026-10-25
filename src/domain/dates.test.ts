import { describe, expect, it } from "vitest";
import {
  addDaysLocal,
  atLocalTime,
  daysBetween,
  durationMinutes,
  isInstant,
  isLocalDate,
  moveToDate,
  relativeDayLabel,
  scheduleDate,
  timed,
  toLocalDate,
  wallKey,
} from "./dates";

// vite.config.ts pins TZ=America/New_York for tests. DST 2026: starts Mar 8, ends Nov 1.

describe("local dates", () => {
  it("validates real calendar dates only", () => {
    expect(isLocalDate("2026-02-28")).toBe(true);
    expect(isLocalDate("2026-02-29")).toBe(false);
    expect(isLocalDate("2028-02-29")).toBe(true);
    expect(isLocalDate("2026-2-1")).toBe(false);
    expect(isInstant("2026-10-25T10:00:00.000Z")).toBe(true);
    expect(isInstant("2026-10-25")).toBe(false);
  });

  it("adds days across DST without drifting", () => {
    expect(addDaysLocal("2026-03-07", 1)).toBe("2026-03-08");
    expect(addDaysLocal("2026-03-08", 1)).toBe("2026-03-09");
    expect(addDaysLocal("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDaysLocal("2026-11-01", 1)).toBe("2026-11-02");
    expect(addDaysLocal("2026-12-31", 1)).toBe("2027-01-01");
    expect(daysBetween("2026-03-01", "2026-03-15")).toBe(14);
  });

  it("builds wall-clock times on DST days", () => {
    // 09:00 on the spring-forward day is still 09:00 local.
    expect(wallKey(atLocalTime("2026-03-08", "09:00"))).toBe("2026-03-08T09:00");
    // 01:30 on fall-back day exists (first occurrence).
    expect(wallKey(atLocalTime("2026-11-01", "01:30"))).toBe("2026-11-01T01:30");
  });

  it("measures timed durations in real minutes across a DST change", () => {
    const s = timed(atLocalTime("2026-03-08", "01:00"), 120);
    expect(durationMinutes(s)).toBe(120);
    // 01:00 + 2h real time = 04:00 local after spring-forward.
    expect(wallKey(new Date(s.kind === "timed" ? s.end : ""))).toBe("2026-03-08T04:00");
  });

  it("reports the local start day for late-evening timed tasks", () => {
    const s = timed(atLocalTime("2026-10-25", "23:30"), 60);
    expect(scheduleDate(s)).toBe("2026-10-25");
    expect(scheduleDate({ kind: "day", date: "2026-10-25" })).toBe("2026-10-25");
    expect(scheduleDate({ kind: "none" })).toBeNull();
    expect(toLocalDate(new Date(2026, 0, 5))).toBe("2026-01-05");
  });

  it("labels days relative to today", () => {
    expect(relativeDayLabel("2026-10-25", "2026-10-25")).toBe("Today");
    expect(relativeDayLabel("2026-10-26", "2026-10-25")).toBe("Tomorrow");
    expect(relativeDayLabel("2026-10-24", "2026-10-25")).toBe("Yesterday");
    expect(relativeDayLabel("2026-10-28", "2026-10-25")).toBe("Wed");
    expect(relativeDayLabel("2026-12-01", "2026-10-25")).toBe("Dec 1");
    expect(relativeDayLabel("2027-01-03", "2026-10-25")).toBe("Jan 3, 2027");
  });
});

describe("moveToDate", () => {
  it("keeps wall-clock time and duration when moving across DST", () => {
    const s = moveToDate(timed(atLocalTime("2026-03-07", "09:30"), 45), "2026-03-09");
    expect(s.kind === "timed" && wallKey(new Date(s.start))).toBe("2026-03-09T09:30");
    expect(durationMinutes(s)).toBe(45);
    expect(moveToDate({ kind: "none" }, "2026-03-09")).toEqual({ kind: "day", date: "2026-03-09" });
  });
});
