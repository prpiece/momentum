import { describe, expect, it } from "vitest";
import { ACCENT_PRESETS, accentForeground, contrast, hexToHsv, hsvToHex, isHex, parseQuadrantColor, quadrantHex } from "./color";

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

describe("hsv", () => {
  it("converts known colours", () => {
    expect(hexToHsv("#ff0000")).toEqual({ h: 0, s: 1, v: 1 });
    expect(hexToHsv("#000000")).toEqual({ h: 0, s: 0, v: 0 });
    expect(hsvToHex({ h: 120, s: 1, v: 1 })).toBe("#00ff00");
    expect(hsvToHex({ h: 240, s: 0.5, v: 0.5 })).toBe("#404080");
  });
  it("round-trips hex", () => {
    for (const { hex } of ACCENT_PRESETS) expect(hsvToHex(hexToHsv(hex))).toBe(hex);
  });
});

describe("quadrant colours", () => {
  it("keeps presets, legacy hexes and custom hexes", () => {
    expect(parseQuadrantColor("teal")).toBe("teal");
    expect(parseQuadrantColor("#2F6FED")).toBe("ocean");
    expect(parseQuadrantColor("#ABCDEF")).toBe("#abcdef");
    expect(parseQuadrantColor("red")).toBeNull();
    expect(quadrantHex("#abcdef", "dark")).toBe("#abcdef");
    expect(quadrantHex("teal", "dark")).toBe("#4fc4bc");
  });
});
