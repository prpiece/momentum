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

/**
 * The theme accent (D198): a preset id that tokens.css styles per theme through html[data-accent].
 * light/dark repeat each preset's --accent there (tokens.test.ts keeps them equal) for swatches,
 * the app icon and quadrant colours. The first nine follow ACCENT_PRESETS' order, which v0.9 stored as hexes.
 */
export const ACCENTS = [
  { id: "indigo", name: "Indigo", light: "#5151cc", dark: "#9c9cf2" },
  { id: "ocean", name: "Ocean", light: "#2563d9", dark: "#7aa8f7" },
  { id: "teal", name: "Teal", light: "#0b7a75", dark: "#4fc4bc" },
  { id: "fern", name: "Fern", light: "#277f4b", dark: "#62c48a" },
  { id: "amber", name: "Amber", light: "#e0a021", dark: "#e8b04a" },
  { id: "coral", name: "Coral", light: "#c8432b", dark: "#f28b74" },
  { id: "rose", name: "Rose", light: "#c23668", dark: "#f084ab" },
  { id: "violet", name: "Violet", light: "#7a45c8", dark: "#b892f0" },
  { id: "slate", name: "Slate", light: "#525b73", dark: "#a3abbf" },
  { id: "graphite", name: "Graphite", light: "#3a3733", dark: "#d6d2cb" },
] as const;

export type AccentId = (typeof ACCENTS)[number]["id"];
export type Theme = "light" | "dark";

/** An accent id, or a v0.9 preset hex mapped to its preset; anything else is null. */
export function parseAccent(v: unknown): AccentId | null {
  if (typeof v !== "string") return null;
  const s = v.toLowerCase();
  const legacy = ACCENT_PRESETS.findIndex((p) => p.hex === s);
  return ACCENTS.find((a) => a.id === s)?.id ?? (legacy >= 0 ? ACCENTS[legacy].id : null);
}

export function accentHex(id: AccentId, theme: Theme): string {
  return (ACCENTS.find((a) => a.id === id) ?? ACCENTS[0])[theme];
}

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

export type Hsv = { h: number; s: number; v: number };

/** h in 0-360, s and v in 0-1. */
export function hexToHsv(hex: string): Hsv {
  const [r, g, b] = channels(hex).map((c) => c / 255);
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  let h = 0;
  if (d > 0) h = max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: h * 60, s: max === 0 ? 0 : d / max, v: max };
}

export function hsvToHex({ h, s, v }: Hsv): string {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return Math.round((v - v * s * Math.max(0, Math.min(k, 4 - k, 1))) * 255);
  };
  return "#" + [f(5), f(3), f(1)].map((c) => c.toString(16).padStart(2, "0")).join("");
}

/** A quadrant colour: an accent preset id, or a custom lowercase #rrggbb (D216). */
export type QuadrantColor = AccentId | `#${string}`;

export function parseQuadrantColor(v: unknown): QuadrantColor | null {
  return parseAccent(v) ?? (isHex(v) ? (v.toLowerCase() as QuadrantColor) : null);
}

/** The colour to draw: a custom hex as is, a preset per theme. */
export function quadrantHex(c: QuadrantColor, theme: Theme): string {
  return isHex(c) ? c : accentHex(c as AccentId, theme);
}
