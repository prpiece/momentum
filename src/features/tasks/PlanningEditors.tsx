import { X } from "lucide-react";
import { useMemo, useState } from "react";
import { addDaysLocal, formatMinutes, todayLocal } from "../../domain/dates";
import { matchScore } from "../../domain/taskViews";
import { WAIT_DEFAULT_DAYS } from "../../domain/quickAdd";
import { waitLoops } from "../../domain/waiting";
import type { LocalDate, Task, Waiting } from "../../domain/types";
import { useData } from "../../stores/data";

const DURATIONS = [5, 10, 15, 30, 45, 60, 90, 120, 180];

/** Deadline (D267): the date it must be done by, apart from the planned date. */
export function DeadlineEditor({ value, onChange }: { value: LocalDate | null; onChange: (d: LocalDate | null) => void }) {
  const today = todayLocal();
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {[
        ["Today", today],
        ["Friday", nextWeekday(today, 5)],
        ["Next week", addDaysLocal(today, 7)],
      ].map(([label, d]) => (
        <button key={label} type="button" onClick={() => onChange(d)} className={`chip ${value === d ? "bg-accent text-accent-fg" : ""}`}>
          {label}
        </button>
      ))}
      <input type="date" aria-label="Deadline" value={value ?? ""} onChange={(e) => onChange(e.target.value || null)} className="input" />
      {value && (
        <button type="button" aria-label="Clear deadline" onClick={() => onChange(null)} className="btn btn-ghost btn-sm icon-btn text-muted">
          <X size={14} />
        </button>
      )}
    </div>
  );
}

const nextWeekday = (from: LocalDate, dow: number) => {
  for (let i = 1; i <= 7; i++) {
    const d = addDaysLocal(from, i);
    if (new Date(`${d}T12:00`).getDay() === dow) return d;
  }
  return from;
};

/** Duration without a time (D267). A timed task's duration is its length, set in Planned. */
export function DurationEditor({ value, timedMinutes, onChange }: { value: number | null; timedMinutes: number | null; onChange: (m: number | null) => void }) {
  if (timedMinutes !== null) return <p className="max-w-60 text-sm text-muted">{formatMinutes(timedMinutes)}, from its start and end time. Change it under Planned.</p>;
  return (
    <div className="flex max-w-72 flex-wrap items-center gap-1.5">
      {DURATIONS.map((m) => (
        <button key={m} type="button" onClick={() => onChange(m)} className={`chip tabular-nums ${value === m ? "bg-accent text-accent-fg" : ""}`}>
          {formatMinutes(m)}
        </button>
      ))}
      <input
        type="number"
        min={1}
        max={1440}
        aria-label="Minutes"
        placeholder="min"
        value={value ?? ""}
        onChange={(e) => {
          const n = Math.round(Number(e.target.value));
          onChange(n >= 1 && n <= 1440 ? n : null);
        }}
        className="input w-20"
      />
      {value !== null && (
        <button type="button" aria-label="Clear duration" onClick={() => onChange(null)} className="btn btn-ghost btn-sm icon-btn text-muted">
          <X size={14} />
        </button>
      )}
    </div>
  );
}

/** Waiting for (D267): a person by a follow-up date, or another open task. Loops are refused. */
export function WaitingEditor({ task, onChange }: { task: Task; onChange: (w: Waiting | null) => void }) {
  const tasks = useData((s) => s.tasks);
  const w = task.waiting;
  const [mode, setMode] = useState<Waiting["kind"]>(w?.kind ?? "person");
  const [who, setWho] = useState(w?.kind === "person" ? w.who : "");
  const [followUp, setFollowUp] = useState(w?.kind === "person" ? w.followUp : addDaysLocal(todayLocal(), WAIT_DEFAULT_DAYS));
  const [q, setQ] = useState("");
  const matches = useMemo(
    () =>
      q.trim()
        ? Object.values(tasks)
            .filter((t) => t.id !== task.id && t.status === "open" && !t.deletedAt && matchScore(t.title, q) !== null && !waitLoops(task.id, { kind: "task", taskId: t.id }, tasks))
            .slice(0, 6)
        : [],
    [q, tasks, task.id],
  );
  return (
    <div className="w-72 max-w-full space-y-2.5">
      <div role="radiogroup" aria-label="Waiting for" className="seg">
        {(["person", "task"] as const).map((k) => (
          <button key={k} type="button" role="radio" aria-checked={mode === k} onClick={() => setMode(k)} className={`seg-item ${mode === k ? "is-on" : ""}`}>
            {k === "person" ? "A person" : "Another task"}
          </button>
        ))}
      </div>
      {mode === "person" ? (
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (who.trim() && followUp) onChange({ kind: "person", who: who.trim(), followUp });
          }}
        >
          <input className="input w-full" aria-label="Who" placeholder="Who are you waiting for?" value={who} onChange={(e) => setWho(e.target.value)} />
          <label className="flex items-center gap-2 text-sm text-fg-2">
            Follow up
            <input type="date" className="input" aria-label="Follow-up date" value={followUp} onChange={(e) => setFollowUp(e.target.value)} />
          </label>
          <button type="submit" disabled={!who.trim() || !followUp} className="btn btn-primary btn-sm">
            Set
          </button>
        </form>
      ) : (
        <div className="space-y-1">
          <input className="input w-full" aria-label="Find a task" placeholder="Find a task…" value={q} onChange={(e) => setQ(e.target.value)} />
          {w?.kind === "task" && tasks[w.taskId] && <p className="text-sm text-fg-2">Waiting on “{tasks[w.taskId].title}”</p>}
          {matches.map((t) => (
            <button key={t.id} type="button" onClick={() => onChange({ kind: "task", taskId: t.id })} className="menu-item w-full">
              {t.title}
            </button>
          ))}
        </div>
      )}
      {w && (
        <button type="button" onClick={() => onChange(null)} className="btn btn-ghost btn-sm">
          Not waiting
        </button>
      )}
    </div>
  );
}
