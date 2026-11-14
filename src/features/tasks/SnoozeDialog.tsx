import { useState } from "react";
import { create } from "zustand";
import { Dialog } from "../../components/ui/Dialog";
import { addDaysLocal, atLocalTime, formatTime, relativeDayLabel, taskMinutes, timed, todayLocal } from "../../domain/dates";
import { DEFAULT_TASK_MINUTES } from "../../domain/quickAdd";
import { scheduleForKey } from "../../domain/recurrence";
import { useData } from "../../stores/data";
import { useSettings } from "../../stores/settings";
import { editTask } from "./actions";

/** Snooze to a chosen time (D267): the task moves to that day and time and reminds you as it starts. */
const useSnooze = create<{ target: { id: string; key: string | null } | null }>(() => ({ target: null }));
export const openSnooze = (id: string, key: string | null) => useSnooze.setState({ target: { id, key } });
const close = () => useSnooze.setState({ target: null });

const TIMES = ["09:00", "13:00", "17:00", "20:00"];

export function SnoozeDialog() {
  const target = useSnooze((s) => s.target);
  if (!target) return null;
  return <SnoozeForm id={target.id} occurrence={target.key} />;
}

function SnoozeForm({ id, occurrence }: { id: string; occurrence: string | null }) {
  const t = useData((s) => s.tasks[id]);
  const fmt = useSettings((s) => s.settings.timeFormat);
  const today = todayLocal();
  const [date, setDate] = useState(addDaysLocal(today, 1));
  const [time, setTime] = useState("09:00");
  if (!t) return null;
  const snooze = () => {
    const at = atLocalTime(date, time);
    const from = occurrence ? scheduleForKey(t.schedule, occurrence) : t.schedule;
    const minutes = taskMinutes({ schedule: from, durationMin: t.durationMin }) ?? DEFAULT_TASK_MINUTES;
    const remind = t.reminders.some((r) => r.kind === "before" && r.minutes === 0) ? t.reminders : [...t.reminders.filter((r) => r.kind === "before"), { kind: "before" as const, minutes: 0 }];
    void editTask(t.id, { schedule: timed(at, minutes), reminders: remind }, occurrence);
    close();
  };
  return (
    <Dialog label="Snooze" width="max-w-sm" onClose={close}>
      <form
        className="space-y-4 p-5"
        onSubmit={(e) => {
          e.preventDefault();
          snooze();
        }}
      >
        <h2 className="text-[length:var(--fs-lg)] font-semibold">Snooze “{t.title}”</h2>
        <div className="flex flex-wrap gap-1.5">
          {[today, addDaysLocal(today, 1), addDaysLocal(today, 2), addDaysLocal(today, 7)].map((d) => (
            <button key={d} type="button" aria-pressed={date === d} onClick={() => setDate(d)} className={`chip ${date === d ? "bg-accent text-accent-fg" : ""}`}>
              {relativeDayLabel(d, today)}
            </button>
          ))}
          <input type="date" aria-label="Date" value={date} min={today} onChange={(e) => e.target.value && setDate(e.target.value)} className="input" />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {TIMES.map((h) => (
            <button key={h} type="button" aria-pressed={time === h} onClick={() => setTime(h)} className={`chip tabular-nums ${time === h ? "bg-accent text-accent-fg" : ""}`}>
              {formatTime(atLocalTime(today, h), fmt)}
            </button>
          ))}
          <input type="time" aria-label="Time" value={time} onChange={(e) => e.target.value && setTime(e.target.value)} className="input" />
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={close} className="btn btn-secondary">
            Cancel
          </button>
          <button type="submit" disabled={atLocalTime(date, time) <= new Date()} className="btn btn-primary">
            Snooze
          </button>
        </div>
      </form>
    </Dialog>
  );
}
