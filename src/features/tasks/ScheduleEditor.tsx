import { Bell, CalendarDays, Clock, Plus, Repeat, X } from "lucide-react";
import { useState } from "react";
import { addDaysLocal, atLocalTime, durationMinutes, hhmm, scheduleDate, timed, todayLocal } from "../../domain/dates";
import { describeRule, REPEAT_PRESETS } from "../../domain/recurrence";
import type { Recurrence, Reminder, Schedule } from "../../domain/types";

const DURATIONS = [15, 30, 45, 60, 90, 120, 180, 240];
const BEFORE_PRESETS = [
  { label: "At start", minutes: 0 },
  { label: "5 min before", minutes: 5 },
  { label: "15 min before", minutes: 15 },
  { label: "30 min before", minutes: 30 },
  { label: "1 hour before", minutes: 60 },
  { label: "1 day before", minutes: 1440 },
];
const DAY_PRESETS: { label: string; daysBefore: number; time: string }[] = [
  { label: "On the day, 9:00", daysBefore: 0, time: "09:00" },
  { label: "Day before, 9:00", daysBefore: 1, time: "09:00" },
  { label: "Day before, 18:00", daysBefore: 1, time: "18:00" },
  { label: "2 days before, 9:00", daysBefore: 2, time: "09:00" },
];
const WEEKDAYS = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];

export function reminderLabel(r: Reminder): string {
  if (r.kind === "before") return BEFORE_PRESETS.find((p) => p.minutes === r.minutes)?.label ?? `${r.minutes} min before`;
  const when = r.daysBefore === 0 ? "On the day" : r.daysBefore === 1 ? "Day before" : `${r.daysBefore} days before`;
  return `${when}, ${r.time}`;
}

const sameReminder = (a: Reminder, b: Reminder) => JSON.stringify(a) === JSON.stringify(b);
const field = "h-8 rounded-sm border border-border bg-surface px-2 text-sm outline-none focus:border-accent";

export function ScheduleEditor(props: {
  schedule: Schedule;
  recurrence: Recurrence | null;
  reminders: Reminder[];
  onSchedule: (s: Schedule) => void;
  onRecurrence: (r: Recurrence | null) => void;
  onReminders: (r: Reminder[]) => void;
}) {
  const { schedule: s } = props;
  const today = todayLocal();
  const date = scheduleDate(s);
  const start = s.kind === "timed" ? new Date(s.start) : null;
  const dur = durationMinutes(s) ?? 60;
  const [custom, setCustom] = useState(false);

  const setDate = (d: string) => {
    if (!d) return props.onSchedule({ kind: "none" });
    props.onSchedule(start ? timed(atLocalTime(d, hhmm(start)), dur) : { kind: "day", date: d });
  };

  const rule = props.recurrence?.rule ?? "";
  const isPreset = REPEAT_PRESETS.some((p) => p.rule === rule);

  return (
    <div className="space-y-3">
      <Row icon={<CalendarDays size={16} />} label="Date">
        <div className="flex flex-wrap items-center gap-1.5">
          {[
            ["Today", today],
            ["Tomorrow", addDaysLocal(today, 1)],
            ["Next week", addDaysLocal(today, 7)],
          ].map(([label, d]) => (
            <button key={label} type="button" onClick={() => setDate(d)} className={`h-7 rounded-full px-2.5 text-xs ${date === d ? "bg-accent text-accent-fg" : "bg-hover text-fg-2 hover:text-fg"}`}>
              {label}
            </button>
          ))}
          <input type="date" aria-label="Date" value={date ?? ""} onChange={(e) => setDate(e.target.value)} className={field} />
          {s.kind !== "none" && (
            <button type="button" aria-label="Clear date" onClick={() => props.onSchedule({ kind: "none" })} className="grid size-7 place-items-center rounded-sm text-muted hover:bg-hover">
              <X size={14} />
            </button>
          )}
        </div>
      </Row>

      {date && (
        <Row icon={<Clock size={16} />} label="Time">
          {start ? (
            <div className="flex flex-wrap items-center gap-1.5">
              <input
                type="time"
                aria-label="Start time"
                value={hhmm(start)}
                onChange={(e) => e.target.value && props.onSchedule(timed(atLocalTime(date, e.target.value), dur))}
                className={field}
              />
              <select aria-label="Duration" value={DURATIONS.includes(dur) ? dur : ""} onChange={(e) => props.onSchedule(timed(start, Number(e.target.value)))} className={field}>
                {!DURATIONS.includes(dur) && <option value="">{dur} min</option>}
                {DURATIONS.map((m) => (
                  <option key={m} value={m}>
                    {m < 60 ? `${m} min` : `${m / 60} h`}
                  </option>
                ))}
              </select>
              <button type="button" onClick={() => props.onSchedule({ kind: "day", date })} className="h-7 rounded-full bg-hover px-2.5 text-xs text-fg-2 hover:text-fg">
                All day
              </button>
            </div>
          ) : (
            <button type="button" onClick={() => props.onSchedule(timed(atLocalTime(date, "09:00"), 60))} className="flex h-7 items-center gap-1 rounded-full bg-hover px-2.5 text-xs text-fg-2 hover:text-fg">
              <Plus size={12} /> Add time
            </button>
          )}
        </Row>
      )}

      {date && (
        <Row icon={<Repeat size={16} />} label="Repeat">
          <div className="flex flex-col gap-2">
            <select
              aria-label="Repeat"
              value={custom ? "__custom" : !rule ? "" : isPreset ? rule : "__current"}
              onChange={(e) => {
                const v = e.target.value;
                setCustom(v === "__custom");
                if (v === "__custom" || v === "__current") return;
                props.onRecurrence(v ? { rule: v, exdates: [] } : null);
              }}
              className={field}
            >
              <option value="">Does not repeat</option>
              {REPEAT_PRESETS.map((p) => (
                <option key={p.rule} value={p.rule}>
                  {p.label}
                </option>
              ))}
              {rule && !isPreset && <option value="__current">{describeRule(rule)}</option>}
              <option value="__custom">Custom…</option>
            </select>
            {custom && <RuleBuilder onDone={(r) => (setCustom(false), props.onRecurrence({ rule: r, exdates: [] }))} />}
          </div>
        </Row>
      )}

      {date && (
        <Row icon={<Bell size={16} />} label="Reminders">
          <div className="flex flex-wrap items-center gap-1.5">
            {props.reminders.map((r, i) => (
              <span key={i} className="inline-flex items-center gap-1 rounded-full bg-accent-soft py-0.5 pl-2.5 pr-1 text-xs">
                {reminderLabel(r)}
                <button type="button" aria-label="Remove reminder" onClick={() => props.onReminders(props.reminders.filter((_, j) => j !== i))} className="rounded-full p-0.5 hover:bg-hover">
                  <X size={11} />
                </button>
              </span>
            ))}
            <select
              aria-label="Add reminder"
              value=""
              onChange={(e) => {
                const opts: Reminder[] = start
                  ? BEFORE_PRESETS.map((p) => ({ kind: "before", minutes: p.minutes }))
                  : DAY_PRESETS.map((p) => ({ kind: "dayOf", daysBefore: p.daysBefore, time: p.time }));
                const r = opts[Number(e.target.value)];
                if (r && !props.reminders.some((x) => sameReminder(x, r))) props.onReminders([...props.reminders, r]);
              }}
              className={field}
            >
              <option value="">+ Add</option>
              {(start ? BEFORE_PRESETS : DAY_PRESETS).map((p, i) => (
                <option key={p.label} value={i}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>
        </Row>
      )}
    </div>
  );
}

function RuleBuilder({ onDone }: { onDone: (rule: string) => void }) {
  const [interval, setInterval] = useState(1);
  const [freq, setFreq] = useState("WEEKLY");
  const [days, setDays] = useState<string[]>([]);
  const rule = `FREQ=${freq}${interval > 1 ? `;INTERVAL=${interval}` : ""}${freq === "WEEKLY" && days.length ? `;BYDAY=${days.join(",")}` : ""}`;
  return (
    <div className="space-y-2 rounded-md border border-border p-2.5">
      <div className="flex items-center gap-1.5 text-sm">
        Every
        <input type="number" min={1} max={99} value={interval} onChange={(e) => setInterval(Math.max(1, Number(e.target.value) || 1))} className={`${field} w-14`} aria-label="Interval" />
        <select value={freq} onChange={(e) => setFreq(e.target.value)} className={field} aria-label="Unit">
          <option value="DAILY">day(s)</option>
          <option value="WEEKLY">week(s)</option>
          <option value="MONTHLY">month(s)</option>
          <option value="YEARLY">year(s)</option>
        </select>
      </div>
      {freq === "WEEKLY" && (
        <div className="flex gap-1">
          {WEEKDAYS.map((d) => (
            <button
              key={d}
              type="button"
              aria-pressed={days.includes(d)}
              onClick={() => setDays(days.includes(d) ? days.filter((x) => x !== d) : [...days, d])}
              className={`size-7 rounded-full text-[0.7rem] font-semibold ${days.includes(d) ? "bg-accent text-accent-fg" : "bg-hover text-fg-2"}`}
            >
              {d.slice(0, 2)}
            </button>
          ))}
        </div>
      )}
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted">{describeRule(rule)}</span>
        <button type="button" onClick={() => onDone(rule)} className="h-7 rounded-sm bg-accent px-3 text-xs font-medium text-accent-fg">
          Apply
        </button>
      </div>
    </div>
  );
}

function Row({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <span className="mt-1.5 text-muted" title={label}>
        {icon}
      </span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
