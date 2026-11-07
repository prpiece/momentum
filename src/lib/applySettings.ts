import { useEffect } from "react";
import { accentHex } from "../domain/color";
import { parseSettings } from "../domain/settings";
import type { Settings } from "../domain/types";
import { useSettings } from "../stores/settings";

// The design tokens are rem at a 16px root, so the default size is 16px (D198).
const FONT_PX: Record<Settings["fontSize"], string> = { sm: "15px", md: "16px", lg: "17.5px", xl: "19px", xxl: "21px" };
const QUADRANT_PROPS = ["--q-do", "--q-schedule", "--q-delegate", "--q-drop"] as const;
const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");

export type Appearance = Pick<Settings, "theme" | "accent" | "density" | "motion" | "fontSize" | "timeFormat" | "smartParse" | "matrixColors">;

export function apply(s: Appearance) {
  const root = document.documentElement;
  const theme = s.theme === "system" ? (darkQuery.matches ? "dark" : "light") : s.theme;
  root.dataset.theme = theme;
  // A picked quadrant colour replaces the theme default with that preset's colour for this theme (D85, D198).
  s.matrixColors.forEach((c, i) => {
    if (c) root.style.setProperty(QUADRANT_PROPS[i], accentHex(c, theme));
    else root.style.removeProperty(QUADRANT_PROPS[i]);
  });
  root.dataset.density = s.density;
  root.dataset.motion = s.motion;
  root.dataset.accent = s.accent;
  root.style.fontSize = FONT_PX[s.fontSize];
}

export const APPEARANCE_KEY = "momentum:appearance";

/** Popup windows can't read the database; they follow the main window's appearance via this snapshot. */
export function readAppearance(): Appearance | null {
  try {
    const raw = localStorage.getItem(APPEARANCE_KEY);
    // Same boundary parser as the database copy: unknown fields fall back to defaults.
    return raw ? parseSettings(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

/** Mirrors appearance settings onto <html> and follows the OS theme while set to "system". */
export function useApplySettings() {
  const settings = useSettings((s) => s.settings);
  useEffect(() => {
    apply(settings);
    try {
      const { theme, accent, density, motion, fontSize, timeFormat, smartParse, matrixColors } = settings;
      localStorage.setItem(APPEARANCE_KEY, JSON.stringify({ theme, accent, density, motion, fontSize, timeFormat, smartParse, matrixColors }));
    } catch {
      // Storage unavailable: popups fall back to default appearance.
    }
    const onChange = () => apply(settings);
    if (settings.theme === "system") darkQuery.addEventListener("change", onChange);
    return () => {
      darkQuery.removeEventListener("change", onChange);
    };
  }, [settings]);
}
