import { Play } from "lucide-react";
import { SOUNDS, type SoundEvent, type SoundSettings } from "../../domain/types";
import { playSound, SOUND_LABELS } from "../../lib/sounds";
import { useSettings } from "../../stores/settings";
import { Line, Switch } from "./NotificationSection";

const EVENTS: [SoundEvent, string, string][] = [
  ["task", "Task completed", "Each time you tick a task off"],
  ["habit", "Habit checked in", "Each time a habit gets a check-in"],
  ["streak", "Habit streak milestone", "7, 30, 100 and 365 days in a row"],
  ["dayDone", "All done today", "Perfect days, weeks, months and years"],
  ["focusEnd", "Focus timer ends", "Plays three times, like an alarm"],
  ["longBreak", "Long break reached", "After the last focus round of a set"],
];

export function SoundsSection() {
  const s = useSettings((st) => st.settings.sounds);
  const update = useSettings((st) => st.update);
  const set = (patch: Partial<SoundSettings>) => update({ sounds: { ...useSettings.getState().settings.sounds, ...patch } });

  return (
    <div className="space-y-4">
      <Line title="Sound effects" hint="Little sounds for finishing things. Reminder chimes are under Notifications.">
        <Switch checked={s.enabled} onChange={(enabled) => set({ enabled })} label="Sound effects" />
      </Line>
      <div className={`space-y-3 transition-opacity duration-[var(--dur)] ${s.enabled ? "" : "pointer-events-none opacity-45"}`} aria-disabled={!s.enabled}>
        <Line title="Volume">
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={s.volume}
            aria-label="Sound volume"
            onChange={(e) => set({ volume: Number(e.target.value) })}
            onPointerUp={() => playSound(s.picks.task, s.volume)}
            className="w-40 accent-[var(--accent)]"
          />
        </Line>
        <div className="space-y-3 border-t border-border pt-4">
          {EVENTS.map(([e, title, hint]) => (
            <Line key={e} title={title} hint={hint}>
              <select
                aria-label={`${title} sound`}
                value={s.picks[e]}
                onChange={(ev) => {
                  const v = SOUNDS.find((x) => x === ev.target.value);
                  if (!v) return;
                  set({ picks: { ...s.picks, [e]: v } });
                  playSound(v, s.volume);
                }}
                className="h-8 rounded-sm border border-border bg-surface px-2 text-sm outline-none focus:border-accent"
              >
                {SOUNDS.map((x) => (
                  <option key={x} value={x}>
                    {SOUND_LABELS[x]}
                  </option>
                ))}
              </select>
              <button
                type="button"
                aria-label={`Play the ${title.toLowerCase()} sound`}
                disabled={s.picks[e] === "none"}
                onClick={() => playSound(s.picks[e], s.volume)}
                className="grid size-8 place-items-center rounded-sm border border-border text-fg-2 hover:bg-hover hover:text-fg focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-40"
              >
                <Play size={14} />
              </button>
            </Line>
          ))}
        </div>
      </div>
    </div>
  );
}
