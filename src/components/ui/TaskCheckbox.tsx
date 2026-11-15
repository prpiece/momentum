import { Check, X } from "lucide-react";
import type { Priority, TaskStatus } from "../../domain/types";

const RING: Record<Priority, string> = { 0: "", 1: "p-low", 2: "p-med", 3: "p-high" };

/** Round check (.check), ringed in the priority colour; ticks when completed. */
export function TaskCheckbox(props: {
  status: TaskStatus;
  priority: Priority;
  onToggle: () => void;
  label: string;
  size?: number;
}) {
  const done = props.status === "done";
  const wont = props.status === "wont_do";
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={done}
      aria-label={props.label}
      onClick={(e) => {
        e.stopPropagation();
        if (e.detail > 1) return; // the second click of a double click would undo the first
        props.onToggle();
      }}
      onPointerDown={(e) => e.stopPropagation()}
      className={`check ${done ? "" : RING[props.priority]} ${wont ? "is-wont" : ""}`}
      style={props.size ? { width: props.size, height: props.size } : undefined}
    >
      {wont ? <X strokeWidth={2.75} /> : <Check key={done ? "done" : "open"} strokeWidth={2.75} className={done ? "anim-draw" : undefined} />}
    </button>
  );
}
