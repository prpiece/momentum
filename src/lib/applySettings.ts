import { useEffect } from "react";
import { accentForeground } from "../domain/color";
import { parseSettings } from "../domain/settings";
import type { Settings } from "../domain/types";
import { useSettings } from "../stores/settings";

const FONT_PX: Record<Settings["fontSize"], string> = { sm: "14px", md: "15px", lg: "16.5px" };
const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");

export type Appearance = Pick<Settings, "theme" | "accent" | "density" | "fontSize" | "timeFormat" | "smartParse">;

export function apply(s: Appearance) {
  const root = document.documentElement;
  root.dataset.theme = s.theme === "system" ? (darkQuery.matches ? "dark" : "light") : s.theme;
  root.dataset.density = s.density;
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
    apply(settings);
    try {
      const { theme, accent, density, fontSize, timeFormat, smartParse } = settings;
      localStorage.setItem(APPEARANCE_KEY, JSON.stringify({ theme, accent, density, fontSize, timeFormat, smartParse }));
    } catch {
      // Storage unavailable: popups fall back to default appearance.
    }
    if (settings.theme !== "system") return;
    const onChange = () => apply(settings);
    darkQuery.addEventListener("change", onChange);
    return () => darkQuery.removeEventListener("change", onChange);
  }, [settings]);
}
