import { Check, X } from "lucide-react";
import { useState } from "react";
import { motionOn } from "../../lib/celebrate";
import { Logo } from "../Logo";
import type { Priority, TaskStatus } from "../../domain/types";

const RING: Record<Priority, string> = { 0: "", 1: "p-low", 2: "p-med", 3: "p-high" };

/** Round check (.check), ringed in the priority colour; ticks when completed and sends a logo badge up (D63). */
export function TaskCheckbox(props: {
  status: TaskStatus;
  priority: Priority;
  onToggle: () => void;
  label: string;
  size?: number;
}) {
  const done = props.status === "done";
  const wont = props.status === "wont_do";
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
      className={`check ${done ? "" : RING[props.priority]} ${wont ? "is-wont" : ""}`}
      style={props.size ? { width: props.size, height: props.size } : undefined}
    >
      {wont ? <X strokeWidth={2.75} /> : <Check key={done ? "done" : "open"} strokeWidth={2.75} className={done ? "anim-draw" : undefined} />}
      {burst > 0 && (
        <span key={burst} className="anim-badge pointer-events-none absolute -top-1 left-1/2 z-10" onAnimationEnd={() => setBurst(0)}>
          <Logo size={20} />
        </span>
      )}
    </button>
  );
}
