import { describe, expect, it } from "vitest";
import { countdownDays, countdownLabel, targetDate } from "./countdown";

describe("countdowns", () => {
  const T = "2026-10-25";
  it("counts until and since", () => {
    expect(countdownDays({ date: "2026-12-25", repeat: "none", direction: "until" }, T)).toBe(61);
    expect(countdownDays({ date: "2026-10-01", repeat: "none", direction: "since" }, T)).toBe(24);
    expect(countdownLabel({ date: "2026-10-20", repeat: "none", direction: "until" }, T)).toBe("5 days ago");
    expect(countdownLabel({ date: T, repeat: "none", direction: "until" }, T)).toBe("Today");
  });
  it("rolls repeating dates to the next anniversary, clamping short months", () => {
    expect(targetDate({ date: "1990-03-14", repeat: "yearly", direction: "until" }, T)).toBe("2027-03-14");
    expect(targetDate({ date: "1990-12-01", repeat: "yearly", direction: "until" }, T)).toBe("2026-12-01");
    expect(targetDate({ date: "2024-02-29", repeat: "yearly", direction: "until" }, "2027-01-10")).toBe("2027-02-28");
    expect(targetDate({ date: "2026-01-31", repeat: "monthly", direction: "until" }, "2026-02-10")).toBe("2026-02-28");
    expect(targetDate({ date: "2026-01-15", repeat: "monthly", direction: "until" }, T)).toBe("2026-11-15");
  });
});
