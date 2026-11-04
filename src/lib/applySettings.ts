import { useEffect } from "react";
import { accentForeground } from "../domain/color";
import { effectiveDensity, parseSettings } from "../domain/settings";
import type { Settings } from "../domain/types";
import { useSettings } from "../stores/settings";

const FONT_PX: Record<Settings["fontSize"], string> = { sm: "14px", md: "15px", lg: "16.5px", xl: "18px", xxl: "20px" };
const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");

export type Appearance = Pick<Settings, "theme" | "accent" | "density" | "motion" | "fontSize" | "timeFormat" | "smartParse">;

/** `windowHeight` (main window only) lets short windows go compact without touching the saved setting. */
export function apply(s: Appearance, windowHeight = Infinity) {
  const root = document.documentElement;
  root.dataset.theme = s.theme === "system" ? (darkQuery.matches ? "dark" : "light") : s.theme;
  root.dataset.density = effectiveDensity(s.density, windowHeight);
  root.dataset.motion = s.motion;
  root.style.setProperty("--accent", s.accent);
  root.style.setProperty("--accent-fg", accentForeground(s.accent));
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
    apply(settings, window.innerHeight);
    const onResize = () => apply(settings, window.innerHeight);
    window.addEventListener("resize", onResize);
    try {
      const { theme, accent, density, motion, fontSize, timeFormat, smartParse } = settings;
      localStorage.setItem(APPEARANCE_KEY, JSON.stringify({ theme, accent, density, motion, fontSize, timeFormat, smartParse }));
    } catch {
      // Storage unavailable: popups fall back to default appearance.
    }
    const onChange = () => apply(settings, window.innerHeight);
    if (settings.theme === "system") darkQuery.addEventListener("change", onChange);
    return () => {
      window.removeEventListener("resize", onResize);
      darkQuery.removeEventListener("change", onChange);
    };
  }, [settings]);
}
