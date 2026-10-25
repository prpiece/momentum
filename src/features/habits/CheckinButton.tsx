import { Check, Plus } from "lucide-react";
import { useRef, useState } from "react";
import { Popover } from "../../components/ui/Popover";
import { accentForeground } from "../../domain/color";
import { isDone, targetOf, type Habit } from "../../domain/habits";
import type { LocalDate } from "../../domain/types";
import { setCheckin, tapCheckin, useHabits } from "../../stores/habits";

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

/**
 * One control for all goal types: tap to complete (once), tap to add one with a progress ring
 * (count; right-click removes one), or tap to type an amount (amount).
 */
export function CheckinButton({ habit, date, size = 36 }: { habit: Habit; date: LocalDate; size?: number }) {
  const value = useHabits((s) => s.checkins[habit.id]?.[date]?.value ?? 0);
  const target = targetOf(habit);
  const done = isDone(habit, value);
  const anchor = useRef<HTMLButtonElement>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const r = size / 2 - 3;
  const circ = 2 * Math.PI * r;
  const progress = Math.min(1, value / target);
  const label =
    habit.goal.kind === "once" ? `${done ? "Undo" : "Complete"} ${habit.name}` : `${habit.name}: ${fmt(value)} of ${fmt(target)} ${habit.goal.unit}`;

  return (
    <>
      <button
        ref={anchor}
        type="button"
        aria-label={label}
        title={habit.goal.kind === "count" ? `${label} (right-click to remove one)` : label}
        aria-pressed={habit.goal.kind === "once" ? done : undefined}
        onClick={(e) => {
          e.stopPropagation();
          if (habit.goal.kind === "amount") {
            setDraft(value ? fmt(value) : "");
            setEditing(true);
          } else tapCheckin(habit, date);
        }}
        onContextMenu={(e) => {
          if (habit.goal.kind !== "count") return;
          e.preventDefault();
          tapCheckin(habit, date, -1);
        }}
        className="relative grid shrink-0 place-items-center rounded-full transition-transform duration-[var(--dur)] active:scale-95"
        style={{ width: size, height: size }}
      >
        <svg width={size} height={size} className="absolute inset-0 -rotate-90" aria-hidden="true">
          <circle cx={size / 2} cy={size / 2} r={r} fill={done ? habit.color : "transparent"} stroke="var(--border)" strokeWidth={done ? 0 : 2.5} />
          {!done && progress > 0 && (
            <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={habit.color} strokeWidth={3} strokeLinecap="round" strokeDasharray={`${circ * progress} ${circ}`} />
          )}
        </svg>
        <span className="relative">
          {done ? (
            <Check key="d" size={size * 0.45} strokeWidth={3.25} className="anim-pop" style={{ color: accentForeground(habit.color) }} />
          ) : habit.goal.kind === "once" ? null : value > 0 ? (
            <span className="font-mono text-[0.65rem] font-semibold">{fmt(value)}</span>
          ) : (
            <Plus size={size * 0.4} className="text-muted" />
          )}
        </span>
      </button>
      {editing && habit.goal.kind === "amount" && (
        <Popover anchor={anchor} onClose={() => setEditing(false)} className="w-56 p-3">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const n = Number(draft);
              if (Number.isFinite(n) && n >= 0) setCheckin(habit.id, date, { value: n });
              setEditing(false);
            }}
          >
            <label className="text-xs font-semibold text-muted">
              {habit.name} · goal {fmt(target)} {habit.goal.unit}
              <div className="mt-1.5 flex items-center gap-2">
                <input autoFocus type="number" min={0} step="any" value={draft} onChange={(e) => setDraft(e.target.value)} className="h-9 w-full rounded-sm border border-border bg-surface px-2 text-sm text-fg outline-none focus:border-accent" />
                <span className="text-sm text-fg-2">{habit.goal.unit}</span>
              </div>
            </label>
            <button type="submit" className="mt-2 h-8 w-full rounded-sm bg-accent text-xs font-medium text-accent-fg">
              Save
            </button>
          </form>
        </Popover>
      )}
    </>
  );
}
