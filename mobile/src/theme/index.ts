/*
 * Momentum's colours on the phone, from the desktop's tokens (tokens.ts is generated from
 * src/styles/tokens.css). Follows the user's synced Theme and Accent settings, like desktop.
 */
import { useColorScheme } from "react-native";
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
    fg: v.fg,
    fg2: v["fg-2"],
    muted: v.muted,
    accent: v.accent,
    accentFg: v["accent-fg"],
    accentSoft: v["accent-soft"],
    accentText: v["accent-text"],
    danger: v.danger,
    success: v.success,
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
