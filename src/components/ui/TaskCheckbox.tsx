import { Check, X } from "lucide-react";
import { useState } from "react";
import { motionOn } from "../../lib/celebrate";
import { Logo } from "../Logo";
import type { Priority, TaskStatus } from "../../domain/types";

const RING: Record<Priority, string> = {
  0: "var(--fg-muted)",
  1: "var(--p1)",
  2: "var(--p2)",
  3: "var(--p3)",
};

/** Round check, ringed in the priority color; pops when completed and sends a logo badge up (D63). */
export function TaskCheckbox(props: {
  status: TaskStatus;
  priority: Priority;
  onToggle: () => void;
  label: string;
  size?: number;
}) {
  const size = props.size ?? 18;
  const done = props.status === "done";
  const wont = props.status === "wont_do";
  const color = RING[props.priority];
  const [burst, setBurst] = useState(0);
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={done}
      aria-label={props.label}
      onClick={(e) => {
        e.stopPropagation();
        if (props.status === "open" && motionOn()) setBurst(Date.now());
        props.onToggle();
      }}
      onPointerDown={(e) => e.stopPropagation()}
      className="group/check relative grid shrink-0 place-items-center rounded-full transition-colors duration-[var(--dur)]"
      style={{
        width: size,
        height: size,
        border: `1.75px solid ${done ? "var(--accent)" : color}`,
        background: done ? "var(--accent)" : `color-mix(in oklch, ${color} 8%, transparent)`,
      }}
    >
      {done ? (
        <Check key="done" size={size - 6} strokeWidth={3.5} className="anim-pop text-accent-fg" />
      ) : wont ? (
        <X size={size - 6} strokeWidth={3} className="text-muted" />
      ) : (
        <Check size={size - 6} strokeWidth={3} className="opacity-0 transition-opacity group-hover/check:opacity-40" style={{ color }} />
      )}
      {burst > 0 && (
        <span key={burst} className="anim-badge pointer-events-none absolute -top-1 left-1/2 z-10" onAnimationEnd={() => setBurst(0)}>
          <Logo size={20} />
        </span>
      )}
    </button>
  );
}
