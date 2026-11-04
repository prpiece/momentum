import { describe, expect, it } from "vitest";
import { fitModules } from "./dockFit";

describe("fitModules", () => {
  it("keeps everything when it fits", () => {
    expect(fitModules(6 * 60 + 5 * 2, 60, 2, 6)).toBe(6);
  });
  it("reserves a slot for More when it does not", () => {
    // 6 items need 370; at 369 five would fit but More needs the sixth slot.
    expect(fitModules(369, 60, 2, 6)).toBe(4);
    expect(fitModules(250, 60, 2, 6)).toBe(3);
  });
  it("never goes below zero", () => {
    expect(fitModules(10, 60, 2, 6)).toBe(0);
  });
});
