import { describe, expect, it } from "vitest";
import { fitItems } from "./dockFit";

describe("fitItems", () => {
  const widths = [60, 80, 70, 90];
  // Each item takes its width plus a 2px gap: 62, 144, 216, 308.

  it("keeps everything when it fits", () => {
    expect(fitItems(308, widths, 2, 50)).toBe(4);
  });
  it("leaves room for More when it does not", () => {
    // 307 can't hold all four; three need 216 + More 50 = 266.
    expect(fitItems(307, widths, 2, 50)).toBe(3);
    expect(fitItems(265, widths, 2, 50)).toBe(2);
  });
  it("uses each item's own width", () => {
    expect(fitItems(200, [20, 20, 200], 0, 40)).toBe(2);
  });
  it("never goes below zero", () => {
    expect(fitItems(10, widths, 2, 50)).toBe(0);
    expect(fitItems(0, [], 2, 50)).toBe(0);
  });
});
