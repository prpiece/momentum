/*
 * Momentum's colours on the phone, from the desktop's tokens (tokens.ts is generated from
 * src/styles/tokens.css). Follows the user's synced Theme and Accent settings, like desktop.
 * Type roles, spacing and motion are the phone's own (docs/design/mobile/04-system.md).
 */
import { useColorScheme, type TextStyle } from "react-native";
import type { AccentId } from "@core/domain/color";
import { useSettings } from "@core/stores/settings";
import { TOKENS } from "./tokens";

type Mode = "light" | "dark";
const base = (mode: Mode, accent: AccentId) => {
  const t = TOKENS[mode];
  const a = (TOKENS.accents as Record<string, { light: Record<string, string>; dark: Record<string, string> }>)[accent]?.[mode] ?? {};
  const v = { ...t, ...a } as Record<string, string>;
  return {
    mode,
    bg: v.bg,
    surface: v.surface,
    surface2: v["surface-2"],
    raised: v.raised,
    border: v.border,
    borderStrong: v["border-strong"],
    controlBorder: v["control-border"],
    fg: v.fg,
    fg2: v["fg-2"],
    muted: v.muted,
    accent: v.accent,
    accentFg: v["accent-fg"],
    accentSoft: v["accent-soft"],
    accentText: v["accent-text"],
    danger: v.danger,
    dangerSoft: v["danger-soft"],
    success: v.success,
    successSoft: v["success-soft"],
    streak: v.streak,
    scrim: mode === "dark" ? "rgba(0,0,0,0.5)" : "rgba(31,29,26,0.32)",
    /** Any token by name, for `var(--x)` colours stored in data (priority, list and habit presets). */
    token: v,
  };
};
export type Colors = ReturnType<typeof base>;

export function useColors(): Colors {
  const system = useColorScheme();
  const theme = useSettings((s) => s.settings.theme);
  const accent = useSettings((s) => s.settings.accent);
  return base(theme === "system" ? (system === "dark" ? "dark" : "light") : theme, accent);
}

/** A stored colour (a hex, or `var(--token)` as desktop writes presets) as a hex for this theme. */
export function resolveColor(c: Colors, color: string | null | undefined, fallback = c.accent): string {
  if (!color) return fallback;
  const m = /^var\(--([a-z0-9-]+)\)$/.exec(color);
  return m ? (c.token[m[1]] ?? fallback) : color;
}

/** Custom fonts pick their weight by family name (Android ignores fontWeight for them). Loaded in the root layout. */
export const FONTS = {
  400: "Inter_400Regular",
  500: "Inter_500Medium",
  600: "Inter_600SemiBold",
  title: "BricolageGrotesque_600SemiBold",
  mono: "JetBrainsMono_500Medium",
} as const;

/** The type roles (04 §1). Sizes scale with the system text size; see `T` for the caps. */
export const TYPE = {
  display: { fontFamily: FONTS.title, fontSize: 34, lineHeight: 40, letterSpacing: -0.3 },
  title: { fontFamily: FONTS.title, fontSize: 24, lineHeight: 30 },
  heading: { fontFamily: FONTS[600], fontSize: 20, lineHeight: 28 },
  body: { fontFamily: FONTS[400], fontSize: 16, lineHeight: 22 },
  bodyStrong: { fontFamily: FONTS[500], fontSize: 16, lineHeight: 22 },
  secondary: { fontFamily: FONTS[400], fontSize: 15, lineHeight: 22 },
  meta: { fontFamily: FONTS[400], fontSize: 13, lineHeight: 18 },
  label: { fontFamily: FONTS[600], fontSize: 12, lineHeight: 16, letterSpacing: 0.7, textTransform: "uppercase" },
  tab: { fontFamily: FONTS[500], fontSize: 12, lineHeight: 16 },
  timer: { fontFamily: FONTS.mono, fontSize: 88, lineHeight: 100, fontVariant: ["tabular-nums"] },
} satisfies Record<string, TextStyle>;
export type Role = keyof typeof TYPE;

/** Page edge gutter and the inset for cards (04 §2). */
export const GUTTER = 20;
export const INSET = 16;
