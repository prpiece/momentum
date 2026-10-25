export const ACCENT_PRESETS = [
  { name: "Indigo", hex: "#5b5bd6" },
  { name: "Ocean", hex: "#2f6fed" },
  { name: "Teal", hex: "#0e8a85" },
  { name: "Fern", hex: "#2f9358" },
  { name: "Amber", hex: "#d18a14" },
  { name: "Coral", hex: "#e1583f" },
  { name: "Rose", hex: "#d6457a" },
  { name: "Violet", hex: "#8a4fd8" },
  { name: "Slate", hex: "#56607a" },
] as const;

const HEX = /^#([0-9a-f]{6})$/i;

export function isHex(v: unknown): v is string {
  return typeof v === "string" && HEX.test(v);
}

function channels(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** WCAG 2.x relative luminance. */
export function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

export const ON_DARK = "#ffffff";
export const ON_LIGHT = "#15161a";

/** Text color for content placed on the accent (buttons, checks): whichever contrasts more. */
export function accentForeground(accent: string): string {
  return contrast(accent, ON_DARK) >= contrast(accent, ON_LIGHT) ? ON_DARK : ON_LIGHT;
}
