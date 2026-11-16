import { expect, it } from "vitest";
import { actualMinutes, actualVsEstimate } from "./timeReport";

const s = (taskId: string | null, seconds: number) => ({ taskId, startAt: "2026-01-01T10:00:00Z", seconds });

it("sums the focus minutes of one task", () => {
  expect(actualMinutes([s("a", 1200), s("b", 600), s("a", 1500)], "a")).toBe(45);
  expect(actualMinutes([s("b", 600)], "a")).toBeNull();
});

it("words actual against the estimate", () => {
  expect(actualVsEstimate(45, 30)).toBe("Actual 45m vs estimate 30m");
  expect(actualVsEstimate(45, null)).toBe("Actual 45m");
  expect(actualVsEstimate(null, 30)).toBeNull();
});
