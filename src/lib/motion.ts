/** Mirrors the CSS rule in tokens.css: Settings → Animations wins, "system" follows the OS. */
export function reducedMotion(): boolean {
  const pref = document.documentElement.dataset.motion;
  return pref === "off" || (pref !== "on" && matchMedia("(prefers-reduced-motion: reduce)").matches);
}
