import { AppIcon, IconPicker } from "../../components/ui/AppIcon";
import { X } from "lucide-react";
import { useMemo, useState } from "react";
import { Button, Dialog } from "../../components/ui/Dialog";
import { ColorField } from "../../components/ui/ColorField";
import { ACCENT_PRESETS } from "../../domain/color";
import { isBuild, type Habit, type HabitFrequency, type HabitGoal } from "../../domain/habits";
import { addGroup, addHabit, updateHabit, useHabits } from "../../stores/habits";

const DAYS = ["S", "M", "T", "W", "T", "F", "S"];
const field = "input";
const KINDS = [
  ["build", "Build a habit", { kind: "once" }],
  ["limit", "Limit something", { kind: "limit", cap: 5, unit: "minutes" }],
  ["quit", "Quit something", { kind: "quit" }],
] as const satisfies readonly (readonly [string, string, HabitGoal])[];
const LIMIT_UNITS = ["times", "minutes", "hours"];
const PLACEHOLDER = { build: "e.g. Drink water", limit: "e.g. Instagram", quit: "e.g. Smoking" };

export function HabitDialog({ habit, onClose }: { habit?: Habit; onClose: () => void }) {
  const groupMap = useHabits((s) => s.groups);
  const groups = useMemo(() => Object.values(groupMap).sort((a, b) => a.sortOrder - b.sortOrder), [groupMap]);
  const [name, setName] = useState(habit?.name ?? "");
  const [icon, setIcon] = useState(habit?.icon ?? "check");
  const [color, setColor] = useState(habit?.color ?? ACCENT_PRESETS[0].hex);
  const [goal, setGoal] = useState<HabitGoal>(habit?.goal ?? { kind: "once" });
  const [freq, setFreq] = useState<HabitFrequency>(habit?.frequency ?? { kind: "daily" });
  const [reminders, setReminders] = useState<string[]>(habit?.reminders ?? []);
  const [groupId, setGroupId] = useState<string | null>(habit?.groupId ?? null);
  const [newGroup, setNewGroup] = useState("");

  const build = isBuild({ goal });
  const kind = goal.kind === "limit" || goal.kind === "quit" ? goal.kind : "build";
  const pickKind = (k: (typeof KINDS)[number]) => {
    if (k[0] === kind) return;
    setGoal(k[2]);
    if (k[0] !== "build" && freq.kind === "perWeek") setFreq({ kind: "daily" }); // avoid-habits have no weekly target
  };

  const save = () => {
    if (!name.trim()) return;
    const gid = newGroup.trim() ? addGroup(newGroup.trim()).id : groupId;
    const data = { name: name.trim(), icon, color, goal, frequency: freq, reminders: build ? reminders : [], groupId: gid };
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
        <div className="input-wrap h-[var(--control-lg)]">
          <AppIcon name={icon} size={20} color={color} />
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder={PLACEHOLDER[kind]} aria-label="Name" />
        </div>

        <IconPicker value={icon} onChange={(k) => k && setIcon(k)} color={color} />

        <ColorField value={color} onChange={setColor} />

        <fieldset>
          <legend className="mb-1.5 t-label text-muted">Type</legend>
          <div className="flex gap-1.5">
            {KINDS.map((k) => (
              <button key={k[0]} type="button" aria-pressed={kind === k[0]} onClick={() => pickKind(k)} className={`h-8 flex-1 rounded-control text-xs ${kind === k[0] ? "bg-accent text-accent-fg" : "bg-surface-2 text-fg-2"}`}>
                {k[1]}
              </button>
            ))}
          </div>
        </fieldset>

        {goal.kind === "limit" && (
          <fieldset className="space-y-2">
            <legend className="mb-1.5 t-label text-muted">Daily limit</legend>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              At most
              <input type="number" min={0} step="any" value={goal.cap} onChange={(e) => setGoal({ ...goal, cap: Math.max(0, Number(e.target.value) || 0) })} aria-label="Daily limit" className={`${field} w-20`} />
              <input value={goal.unit} onChange={(e) => setGoal({ ...goal, unit: e.target.value.slice(0, 20) })} placeholder="unit" aria-label="Unit" className={`${field} w-28`} />
              a day
            </div>
            <div className="flex gap-1.5" role="group" aria-label="Common units">
              {LIMIT_UNITS.map((u) => (
                <button key={u} type="button" aria-pressed={goal.unit === u} onClick={() => setGoal({ ...goal, unit: u })} className={`h-7 rounded-control px-3 text-xs ${goal.unit === u ? "bg-accent-soft font-semibold text-fg" : "bg-surface-2 text-fg-2"}`}>
                  {u}
                </button>
              ))}
            </div>
            <p className="text-xs text-muted">Log what you use each day. Days you log nothing count as success.</p>
          </fieldset>
        )}
        {goal.kind === "quit" && <p className="text-xs text-muted">Every day counts as a win until you log a slip.</p>}

        {build && (
        <fieldset className="space-y-2">
          <legend className="mb-1.5 t-label text-muted">Goal</legend>
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
                onClick={() => setGoal(k === "once" ? { kind: "once" } : { kind: k, target: goal.kind === "count" || goal.kind === "amount" ? goal.target : k === "count" ? 8 : 5, unit: goal.kind === "count" || goal.kind === "amount" ? goal.unit : k === "count" ? "times" : "km" })}
                className={`h-8 flex-1 rounded-control text-xs ${goal.kind === k ? "bg-accent text-accent-fg" : "bg-surface-2 text-fg-2"}`}
              >
                {label}
              </button>
            ))}
          </div>
          {(goal.kind === "count" || goal.kind === "amount") && (
            <div className="flex items-center gap-2 text-sm">
              Target
              <input type="number" min={0.1} step="any" value={goal.target} onChange={(e) => setGoal({ ...goal, target: Math.max(0.1, Number(e.target.value) || 1) })} aria-label="Target" className={`${field} w-20`} />
              <input value={goal.unit} onChange={(e) => setGoal({ ...goal, unit: e.target.value.slice(0, 20) })} placeholder="unit" aria-label="Unit" className={`${field} w-28`} />
              per day
            </div>
          )}
        </fieldset>
        )}

        <fieldset className="space-y-2">
          <legend className="mb-1.5 t-label text-muted">Frequency</legend>
          <div className="flex gap-1.5">
            {(
              [
                ["daily", "Every day"],
                ["weekdays", "Specific days"],
                ["perWeek", "Times per week"],
              ] as const
            )
              .filter(([k]) => build || k !== "perWeek")
              .map(([k, label]) => (
              <button
                key={k}
                type="button"
                aria-pressed={freq.kind === k}
                onClick={() => setFreq(k === "daily" ? { kind: "daily" } : k === "weekdays" ? { kind: "weekdays", days: [1, 2, 3, 4, 5] } : { kind: "perWeek", count: 3 })}
                className={`h-8 flex-1 rounded-control text-xs ${freq.kind === k ? "bg-accent text-accent-fg" : "bg-surface-2 text-fg-2"}`}
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
                  className={`size-8 rounded-full text-xs font-semibold ${freq.days.includes(i) ? "bg-accent text-accent-fg" : "bg-surface-2 text-fg-2"}`}
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

        {build && (
        <fieldset>
          <legend className="mb-1.5 t-label text-muted">Reminders</legend>
          <div className="flex flex-wrap items-center gap-1.5">
            {reminders.map((r) => (
              <span key={r} className="inline-flex items-center gap-1 rounded-full bg-accent-soft py-0.5 pl-2.5 pr-1 tabular-nums text-xs">
                {r}
                <button type="button" aria-label={`Remove ${r}`} onClick={() => setReminders(reminders.filter((x) => x !== r))} className="rounded-full p-0.5 hover:bg-surface-2">
                  <X size={11} />
                </button>
              </span>
            ))}
            <input type="time" aria-label="Add reminder time" onChange={(e) => e.target.value && !reminders.includes(e.target.value) && setReminders([...reminders, e.target.value].sort())} className={`${field} h-8`} />
          </div>
        </fieldset>
        )}

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
