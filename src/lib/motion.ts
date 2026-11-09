import { flushSync } from "react-dom";

/** Mirrors the CSS rule in tokens.css: Settings → Animations wins, "system" follows the OS. */
export function reducedMotion(): boolean {
  const pref = document.documentElement.dataset.motion;
  return pref === "off" || (pref !== "on" && matchMedia("(prefers-reduced-motion: reduce)").matches);
}

/**
 * Runs a UI change as a View Transition (D207), so things can animate out and reflow, not only in.
 * `scope` is a class on <html> for the transition's length, which the CSS uses to name what morphs.
 * Instant under reduced motion or where the API is missing (older WebKit).
 */
export function withTransition(change: () => void, scope?: string) {
  if (reducedMotion() || !document.startViewTransition) return change();
  const root = document.documentElement;
  if (scope) root.classList.add(scope);
  const vt = document.startViewTransition(() => flushSync(change));
  if (scope) void vt.finished.finally(() => root.classList.remove(scope));
}
