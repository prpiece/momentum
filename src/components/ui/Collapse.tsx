import { type ReactNode, useEffect, useState } from "react";
import { reducedMotion } from "../../lib/motion";

/**
 * Animates height open and closed. Content unmounts once closed so hidden sidebar rows
 * can't catch drops (dnd-kit measures clipped elements too).
 */
export function Collapse({ open, children }: { open: boolean; children: ReactNode }) {
  const [mounted, setMounted] = useState(open);
  const [expanded, setExpanded] = useState(open);
  useEffect(() => {
    if (!open) {
      setExpanded(false);
      // No transition runs under reduced motion, so transitionend never fires.
      if (reducedMotion()) setMounted(false);
      return;
    }
    setMounted(true);
    // React commits a click's updates before the next paint; wait until the collapsed
    // state has been drawn with the content in it, or there's nothing to animate from.
    let frame = requestAnimationFrame(() => (frame = requestAnimationFrame(() => setExpanded(true))));
    return () => cancelAnimationFrame(frame);
  }, [open]);
  return (
    <div
      inert={!open}
      onTransitionEnd={(e) => e.target === e.currentTarget && !open && setMounted(false)}
      className={`grid transition-[grid-template-rows] duration-[var(--dur)] ease-[var(--ease)] ${expanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}
    >
      <div className="min-h-0 overflow-hidden">{mounted && children}</div>
    </div>
  );
}
