import { describe, expect, it } from "vitest";
import { ACCENT_PRESETS, accentForeground, contrast, isHex } from "./color";

describe("contrast", () => {
  it("matches WCAG reference values", () => {
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrast("#ffffff", "#ffffff")).toBeCloseTo(1, 5);
    expect(contrast("#777777", "#ffffff")).toBeCloseTo(4.48, 2);
  });
});

describe("accentForeground", () => {
  it("picks dark text on light accents and white on dark ones", () => {
    expect(accentForeground("#ffe14d")).toBe("#15161a");
    expect(accentForeground("#1e1b4b")).toBe("#ffffff");
  });

  it("gives every preset AA-legible foreground for large UI text", () => {
    for (const { hex } of ACCENT_PRESETS) {
      expect(contrast(hex, accentForeground(hex))).toBeGreaterThanOrEqual(3);
    }
  });
});

describe("isHex", () => {
  it("accepts only #rrggbb", () => {
    expect(isHex("#5b5bd6")).toBe(true);
    expect(isHex("#fff")).toBe(false);
    expect(isHex("red")).toBe(false);
    expect(isHex(42)).toBe(false);
  });
});
