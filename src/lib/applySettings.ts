import { useEffect } from "react";
import { accentForeground } from "../domain/color";
import type { Settings } from "../domain/types";
import { useSettings } from "../stores/settings";

const FONT_PX: Record<Settings["fontSize"], string> = { sm: "14px", md: "15px", lg: "16.5px" };
const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");

function apply(s: Settings) {
  const root = document.documentElement;
  root.dataset.theme = s.theme === "system" ? (darkQuery.matches ? "dark" : "light") : s.theme;
  root.dataset.density = s.density;
  root.style.setProperty("--accent", s.accent);
  root.style.setProperty("--accent-fg", accentForeground(s.accent));
  root.style.fontSize = FONT_PX[s.fontSize];
}

/** Mirrors appearance settings onto <html> and follows the OS theme while set to "system". */
export function useApplySettings() {
  const settings = useSettings((s) => s.settings);
  useEffect(() => {
    apply(settings);
    if (settings.theme !== "system") return;
    const onChange = () => apply(settings);
    darkQuery.addEventListener("change", onChange);
    return () => darkQuery.removeEventListener("change", onChange);
  }, [settings]);
}
