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

/**
 * Plays a floating layer's exit after React has removed it (D208): a short-lived, inert copy of the element
 * stays where it was with `is-closing`, which the CSS animates out (adapted from transitions.dev's menu dropdown
 * and modal recipes). Works however the layer was closed, so callers don't change. Skipped under reduced motion.
 */
export function exitGhost(el: HTMLElement | null | undefined, ms = 150) {
  if (!el || reducedMotion() || document.hidden) return;
  const ghost = el.cloneNode(true) as HTMLElement;
  ghost.inert = true;
  ghost.setAttribute("aria-hidden", "true");
  ghost.removeAttribute("id");
  ghost.querySelectorAll("[id]").forEach((n) => n.removeAttribute("id"));
  ghost.style.pointerEvents = "none";
  ghost.classList.add("is-closing");
  document.body.appendChild(ghost);
  setTimeout(() => ghost.remove(), ms);
}
