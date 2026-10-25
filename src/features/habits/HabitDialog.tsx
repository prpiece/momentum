import { Check, X } from "lucide-react";
import { useMemo, useState } from "react";
import { Button, Dialog } from "../../components/ui/Dialog";
import { ACCENT_PRESETS } from "../../domain/color";
import type { Habit, HabitFrequency, HabitGoal } from "../../domain/habits";
import { addGroup, addHabit, updateHabit, useHabits } from "../../stores/habits";

const ICONS = ["✅", "💧", "🧘", "🏃", "📚", "💪", "🥗", "😴", "🚶", "🦷", "📵", "✍️", "🎸", "🧹", "💊", "🌞", "🙏", "💰", "🧠", "🚴"];
const DAYS = ["S", "M", "T", "W", "T", "F", "S"];
const field = "h-9 rounded-sm border border-border bg-surface px-2.5 text-sm outline-none focus:border-accent";

export function HabitDialog({ habit, onClose }: { habit?: Habit; onClose: () => void }) {
  const groupMap = useHabits((s) => s.groups);
  const groups = useMemo(() => Object.values(groupMap).sort((a, b) => a.sortOrder - b.sortOrder), [groupMap]);
  const [name, setName] = useState(habit?.name ?? "");
  const [icon, setIcon] = useState(habit?.icon ?? "✅");
  const [color, setColor] = useState(habit?.color ?? ACCENT_PRESETS[0].hex);
  const [goal, setGoal] = useState<HabitGoal>(habit?.goal ?? { kind: "once" });
  const [freq, setFreq] = useState<HabitFrequency>(habit?.frequency ?? { kind: "daily" });
  const [reminders, setReminders] = useState<string[]>(habit?.reminders ?? []);
  const [groupId, setGroupId] = useState<string | null>(habit?.groupId ?? null);
  const [newGroup, setNewGroup] = useState("");

  const save = () => {
    if (!name.trim()) return;
    const gid = newGroup.trim() ? addGroup(newGroup.trim()).id : groupId;
    const data = { name: name.trim(), icon, color, goal, frequency: freq, reminders, groupId: gid };
    if (habit) updateHabit(habit.id, data);
    else addHabit(data);
    onClose();
  };

  return (
    <Dialog label={habit ? "Edit habit" : "New habit"} onClose={onClose} width="max-w-lg">
      <form
        className="space-y-5 p-6"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <h2 className="text-lg font-semibold">{habit ? "Edit habit" : "New habit"}</h2>
        <div className="flex items-center gap-2 rounded-md border border-border bg-surface px-3 focus-within:border-accent">
          <span className="text-xl">{icon}</span>
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Drink water" aria-label="Name" className="h-11 flex-1 bg-transparent outline-none" />
        </div>

        <div className="flex flex-wrap gap-1" role="group" aria-label="Icon">
          {ICONS.map((i) => (
            <button key={i} type="button" aria-pressed={icon === i} onClick={() => setIcon(i)} className={`grid size-9 place-items-center rounded-sm text-lg ${icon === i ? "bg-accent-soft ring-1 ring-accent" : "hover:bg-hover"}`}>
              {i}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap gap-2" role="group" aria-label="Color">
          {ACCENT_PRESETS.map((p) => (
            <button key={p.hex} type="button" aria-label={p.name} aria-pressed={color === p.hex} onClick={() => setColor(p.hex)} className="grid size-7 place-items-center rounded-full" style={{ background: p.hex }}>
              {color === p.hex && <Check size={14} strokeWidth={3} className="text-white" />}
            </button>
          ))}
        </div>

        <fieldset className="space-y-2">
          <legend className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted">Goal</legend>
          <div className="flex gap-1.5">
            {(
              [
                ["once", "Complete once"],
                ["count", "Count up"],
                ["amount", "Enter amount"],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                aria-pressed={goal.kind === k}
                onClick={() => setGoal(k === "once" ? { kind: "once" } : { kind: k, target: goal.kind === "once" ? (k === "count" ? 8 : 5) : goal.target, unit: goal.kind === "once" ? (k === "count" ? "times" : "km") : goal.unit })}
                className={`h-8 flex-1 rounded-sm text-xs ${goal.kind === k ? "bg-accent text-accent-fg" : "bg-hover text-fg-2"}`}
              >
                {label}
              </button>
            ))}
          </div>
          {goal.kind !== "once" && (
            <div className="flex items-center gap-2 text-sm">
              Target
              <input type="number" min={0.1} step="any" value={goal.target} onChange={(e) => setGoal({ ...goal, target: Math.max(0.1, Number(e.target.value) || 1) })} aria-label="Target" className={`${field} w-20`} />
              <input value={goal.unit} onChange={(e) => setGoal({ ...goal, unit: e.target.value.slice(0, 20) })} placeholder="unit" aria-label="Unit" className={`${field} w-28`} />
              per day
            </div>
          )}
        </fieldset>

        <fieldset className="space-y-2">
          <legend className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted">Frequency</legend>
          <div className="flex gap-1.5">
            {(
              [
                ["daily", "Every day"],
                ["weekdays", "Specific days"],
                ["perWeek", "Times per week"],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                aria-pressed={freq.kind === k}
                onClick={() => setFreq(k === "daily" ? { kind: "daily" } : k === "weekdays" ? { kind: "weekdays", days: [1, 2, 3, 4, 5] } : { kind: "perWeek", count: 3 })}
                className={`h-8 flex-1 rounded-sm text-xs ${freq.kind === k ? "bg-accent text-accent-fg" : "bg-hover text-fg-2"}`}
              >
                {label}
              </button>
            ))}
          </div>
          {freq.kind === "weekdays" && (
            <div className="flex gap-1">
              {DAYS.map((d, i) => (
                <button
                  key={i}
                  type="button"
                  aria-pressed={freq.days.includes(i)}
                  aria-label={["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][i]}
                  onClick={() => {
                    const days = freq.days.includes(i) ? freq.days.filter((x) => x !== i) : [...freq.days, i];
                    if (days.length) setFreq({ kind: "weekdays", days });
                  }}
                  className={`size-8 rounded-full text-xs font-semibold ${freq.days.includes(i) ? "bg-accent text-accent-fg" : "bg-hover text-fg-2"}`}
                >
                  {d}
                </button>
              ))}
            </div>
          )}
          {freq.kind === "perWeek" && (
            <div className="flex items-center gap-2 text-sm">
              <input type="number" min={1} max={7} value={freq.count} onChange={(e) => setFreq({ kind: "perWeek", count: Math.min(7, Math.max(1, Math.round(Number(e.target.value)) || 1)) })} aria-label="Times per week" className={`${field} w-16`} />
              times a week
            </div>
          )}
        </fieldset>

        <fieldset>
          <legend className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted">Reminders</legend>
          <div className="flex flex-wrap items-center gap-1.5">
            {reminders.map((r) => (
              <span key={r} className="inline-flex items-center gap-1 rounded-full bg-accent-soft py-0.5 pl-2.5 pr-1 font-mono text-xs">
                {r}
                <button type="button" aria-label={`Remove ${r}`} onClick={() => setReminders(reminders.filter((x) => x !== r))} className="rounded-full p-0.5 hover:bg-hover">
                  <X size={11} />
                </button>
              </span>
            ))}
            <input type="time" aria-label="Add reminder time" onChange={(e) => e.target.value && !reminders.includes(e.target.value) && setReminders([...reminders, e.target.value].sort())} className={`${field} h-8`} />
          </div>
        </fieldset>

        <div className="flex flex-wrap items-center gap-2 text-sm">
          Group
          <select value={groupId ?? ""} onChange={(e) => setGroupId(e.target.value || null)} className={field}>
            <option value="">None</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
          <input value={newGroup} onChange={(e) => setNewGroup(e.target.value)} placeholder="or new group…" aria-label="New group" className={`${field} w-36`} />
        </div>

        <div className="flex justify-end gap-2 border-t border-border pt-4">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" disabled={!name.trim()}>
            {habit ? "Save" : "Create habit"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
