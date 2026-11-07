import { describe, expect, it } from "vitest";
import { countdownDays, eventCountdown, targetDate } from "./countdown";

describe("countdowns", () => {
  const T = "2026-10-25";
  it("counts until and since", () => {
    expect(countdownDays({ date: "2026-12-25", repeat: "none", direction: "until" }, T)).toBe(61);
    expect(countdownDays({ date: "2026-10-01", repeat: "none", direction: "since" }, T)).toBe(24);
  });
  it("rolls repeating dates to the next anniversary, clamping short months", () => {
    expect(targetDate({ date: "1990-03-14", repeat: "yearly", direction: "until" }, T)).toBe("2027-03-14");
    expect(targetDate({ date: "1990-12-01", repeat: "yearly", direction: "until" }, T)).toBe("2026-12-01");
    expect(targetDate({ date: "2024-02-29", repeat: "yearly", direction: "until" }, "2027-01-10")).toBe("2027-02-28");
    expect(targetDate({ date: "2026-01-31", repeat: "monthly", direction: "until" }, "2026-02-10")).toBe("2026-02-28");
    expect(targetDate({ date: "2026-01-15", repeat: "monthly", direction: "until" }, T)).toBe("2026-11-15");
  });
  it("reads a countdown from all-day events only", () => {
    const day = { kind: "day" as const, date: "2026-12-25" };
    expect(eventCountdown({ schedule: day, recurrence: { rule: "FREQ=YEARLY", exdates: [] }, countdown: "until" })).toEqual({ date: "2026-12-25", direction: "until", repeat: "yearly" });
    expect(eventCountdown({ schedule: day, recurrence: { rule: "FREQ=WEEKLY", exdates: [] }, countdown: "since" })?.repeat).toBe("none");
    expect(eventCountdown({ schedule: day, recurrence: null, countdown: null })).toBeNull();
    expect(eventCountdown({ schedule: { kind: "timed", start: "2026-12-25T10:00:00.000Z", end: "2026-12-25T11:00:00.000Z" }, recurrence: null, countdown: "until" })).toBeNull();
  });
});
