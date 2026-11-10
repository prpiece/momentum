import * as Tooltip from "@radix-ui/react-tooltip";
import type { ReactNode } from "react";
import { Keys } from "./Keys";

/**
 * A tooltip for icon-only controls (D208): Radix handles hover/focus delay, Escape, collision and aria-describedby;
 * the look is the app's `.layer`, with transitions.dev's tooltip timing (delayed in, instant out).
 * Needs the `Tooltip.Provider` in App.tsx, so popup windows (mini, quick add) keep `title`.
 */
export function Tip({ label, desc, keys, side = "bottom", disabled, children }: { label: string; desc?: string; keys?: string; side?: "top" | "right" | "bottom" | "left"; disabled?: boolean; children: ReactNode }) {
  if (disabled) return children;
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content side={side} sideOffset={6} collisionPadding={8} className="tip layer pointer-events-none z-[70] whitespace-nowrap rounded-control px-2 py-1 text-xs font-medium">
          {desc || keys ? (
            <span className="flex items-center gap-2">
              <span>
                {label}
                {desc && <span className="font-normal text-muted"> — {desc}</span>}
              </span>
              {keys && <Keys keys={keys} />}
            </span>
          ) : (
            label
          )}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

export const TipProvider = Tooltip.Provider;
