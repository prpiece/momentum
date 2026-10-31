import { format } from "date-fns";
import { Pause, Play, SkipForward, Square, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { BarChart } from "../../components/ui/BarChart";
import { TaskCheckbox } from "../../components/ui/TaskCheckbox";
import { fromLocalDate, toLocalDate, todayLocal } from "../../domain/dates";
import { elapsedMs, formatClock, phaseMs, remainingMs, type FocusMode, type Phase } from "../../domain/focus";
import { perWeek, type Bucket } from "../../domain/stats";
import { sortVMs } from "../../domain/taskViews";
import { addDaysLocal } from "../../domain/dates";
import { useData } from "../../stores/data";
import { deleteSession, pauseFocus, resumeFocus, setFocusTask, skipPhase, startFocus, stopFocus, useFocus } from "../../stores/focus";
import { useSettings } from "../../stores/settings";
import { addStatsSection } from "../stats/StatsView";
import { toggleDone } from "../tasks/actions";
import { useDerived } from "../tasks/selectors";

export function focusPhaseLabel(next: Phase): string {
  if (next === "focus") return "Break's over. Time to focus.";
  return next === "long" ? "Great session! Take a long break." : "Nice work! Take a short break.";
}

const PHASE_NAME: Record<Phase, string> = { focus: "Focus", short: "Short break", long: "Long break" };

/** Re-render every `ms` while `active`. */
export function useNow(active: boolean, ms = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [active, ms]);
  return active ? now : Date.now();
}

/** Focus minutes per local day for the last `n` days. */
function minutesPerDay(sessions: Record<string, { startAt: string; seconds: number }>, n: number): Bucket[] {
  const by = new Map<string, number>();
  for (const s of Object.values(sessions)) {
    const d = toLocalDate(new Date(s.startAt));
    by.set(d, (by.get(d) ?? 0) + s.seconds / 60);
  }
  const today = todayLocal();
  return Array.from({ length: n }, (_, i) => {
    const d = addDaysLocal(today, i - n + 1);
    return { start: d, label: d, value: Math.round(by.get(d) ?? 0) };
  });
}

addStatsSection({
  id: "focus",
  render: () => <FocusStats />,
});

function FocusStats() {
  const sessions = useFocus((s) => s.sessions);
  const ws = useSettings((s) => s.settings.weekStart);
  const days = useMemo(() => minutesPerDay(sessions, 14), [sessions]);
  const week = useMemo(() => {
    const map = new Map(minutesPerDay(sessions, 21).map((b) => [b.start, b.value]));
    return perWeek((d) => map.get(d) ?? 0, todayLocal(), 1, ws)[0]?.value ?? 0;
  }, [sessions, ws]);
  if (!Object.keys(sessions).length) return null;
  return (
    <section className="mt-6 rounded-lg border border-border bg-surface-2 p-5 shadow-sm">
      <div className="mb-3 flex items-baseline">
        <h2 className="flex-1 text-sm font-semibold">Focus time · last 14 days</h2>
        <span className="font-mono text-xs text-muted">this week {Math.floor(week / 60)}h {week % 60}m</span>
      </div>
      <BarChart
        title="Focus minutes per day, last 14 days"
        data={days}
        format={(v) => `${v}m`}
        label={(b) => format(fromLocalDate(b.start), "EEE, MMM d")}
        tick={(b, i) => (i % 2 === 1 ? "" : format(fromLocalDate(b.start), "d MMM"))}
        color="var(--p3)"
      />
    </section>
  );
}

export function FocusView() {
  const t = useFocus((s) => s.timer);
  const sessions = useFocus((s) => s.sessions);
  const cfg = useSettings((s) => s.settings.pomodoro);
  const update = useSettings((s) => s.update);
  const derived = useDerived();
  const tasks = useData((s) => s.tasks);
  const [mode, setMode] = useState<FocusMode>("pomodoro");
  const [taskId, setTaskId] = useState<string | null>(null);
  const now = useNow(t.status === "running");

  const options = useMemo(() => sortVMs(derived.roots.filter((v) => v.task.status === "open"), "date").slice(0, 200), [derived]);
  const activeMode = t.status === "idle" ? mode : t.mode;
  const remaining = remainingMs(t, now, cfg);
  const elapsed = elapsedMs(t, now);
  const total = t.status !== "idle" && t.mode === "pomodoro" ? phaseMs(t.phase, cfg) : 0;
  const progress = total ? 1 - (remaining ?? 0) / total : 0;
  const clock = t.status === "idle" ? (mode === "pomodoro" ? formatClock(cfg.focusMin * 60_000) : "00:00") : formatClock(remaining ?? elapsed);
  const today = todayLocal();
  const todays = Object.values(sessions)
    .filter((s) => toLocalDate(new Date(s.startAt)) === today)
    .sort((a, b) => b.startAt.localeCompare(a.startAt));
  const todayMin = Math.round(todays.reduce((n, s) => n + s.seconds, 0) / 60);
  const R = 120;
  const C = 2 * Math.PI * R;
  const boundTask = t.status === "idle" ? taskId : t.taskId;

  return (
    // Narrow windows stack the timer above today's sessions and scroll; nothing may shrink under the ring.
    <div className="scroll-thin flex h-full min-h-0 flex-col overflow-y-auto lg:flex-row lg:overflow-hidden">
      <div className="scroll-thin flex shrink-0 flex-col items-center justify-center-safe gap-5 p-6 lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
        {t.status === "idle" && (
          <div role="radiogroup" aria-label="Timer mode" className="flex rounded-sm border border-border bg-bg p-0.5">
            {(["pomodoro", "stopwatch"] as const).map((m) => (
              <button key={m} type="button" role="radio" aria-checked={mode === m} onClick={() => setMode(m)} className={`h-8 rounded-[6px] px-4 text-sm capitalize ${mode === m ? "bg-surface-2 font-semibold shadow-sm" : "text-muted"}`}>
                {m}
              </button>
            ))}
          </div>
        )}

        <div className="relative grid size-[clamp(12rem,42vh,16.5rem)] shrink-0 place-items-center">
          <svg viewBox={`0 0 ${2 * R + 24} ${2 * R + 24}`} className="absolute inset-0 size-full -rotate-90" aria-hidden="true">
            <circle cx={R + 12} cy={R + 12} r={R} fill="none" stroke="var(--border)" strokeWidth={8} />
            {activeMode === "pomodoro" && t.status !== "idle" && (
              <circle cx={R + 12} cy={R + 12} r={R} fill="none" stroke={t.phase === "focus" ? "var(--accent)" : "var(--success)"} strokeWidth={8} strokeLinecap="round" strokeDasharray={`${C * progress} ${C}`} className="transition-[stroke-dasharray] duration-1000 ease-linear" />
            )}
          </svg>
          <div className="text-center" role="timer" aria-live="off">
            <div className="text-xs font-semibold uppercase tracking-widest text-muted">
              {t.status === "idle" ? "Ready" : t.mode === "stopwatch" ? "Stopwatch" : `${PHASE_NAME[t.phase]}${t.phase === "focus" ? ` · round ${t.round}` : ""}`}
              {t.status === "paused" && " · paused"}
            </div>
            <div className={`font-mono font-semibold tabular-nums tracking-tight ${clock.length > 5 ? "text-[clamp(1.9rem,5vh,2.75rem)]" : "text-[clamp(2.5rem,7vh,3.75rem)]"}`}>{clock}</div>
          </div>
        </div>

        <select
          value={boundTask ?? ""}
          onChange={(e) => (t.status === "idle" ? setTaskId(e.target.value || null) : setFocusTask(e.target.value || null))}
          aria-label="Task to focus on"
          className="h-10 w-80 max-w-full rounded-md border border-border bg-surface px-3 text-sm"
        >
          <option value="">No specific task</option>
          {boundTask && !options.some((o) => o.task.id === boundTask) && tasks[boundTask] && <option value={boundTask}>{tasks[boundTask].title}</option>}
          {options.map((o) => (
            <option key={o.task.id} value={o.task.id}>
              {o.task.title}
            </option>
          ))}
        </select>
        {boundTask && <Steps parentId={boundTask} />}

        <div className="flex items-center gap-3">
          {t.status === "idle" ? (
            <button type="button" onClick={() => startFocus(mode, taskId)} className="flex h-12 items-center gap-2 rounded-full bg-accent px-8 text-base font-semibold text-accent-fg shadow-sm hover:bg-accent-hover">
              <Play size={18} fill="currentColor" /> Start
            </button>
          ) : (
            <>
              {t.status === "running" ? (
                <button type="button" onClick={pauseFocus} aria-label="Pause" className="grid size-12 place-items-center rounded-full bg-accent text-accent-fg hover:bg-accent-hover">
                  <Pause size={20} fill="currentColor" />
                </button>
              ) : (
                <button type="button" onClick={resumeFocus} aria-label="Resume" className="grid size-12 place-items-center rounded-full bg-accent text-accent-fg hover:bg-accent-hover">
                  <Play size={20} fill="currentColor" />
                </button>
              )}
              {t.mode === "pomodoro" && (
                <button type="button" onClick={skipPhase} aria-label="Skip to next phase" title="Skip" className="grid size-12 place-items-center rounded-full bg-hover text-fg-2 hover:text-fg">
                  <SkipForward size={18} />
                </button>
              )}
              <button type="button" onClick={stopFocus} aria-label="Stop and save" title="Stop" className="grid size-12 place-items-center rounded-full bg-hover text-fg-2 hover:text-danger">
                <Square size={16} fill="currentColor" />
              </button>
            </>
          )}
        </div>

        {t.status === "idle" && mode === "pomodoro" && (
          <div className="flex flex-wrap items-center justify-center gap-3 text-xs text-muted">
            {(
              [
                ["focusMin", "Focus", 1, 180],
                ["shortMin", "Short break", 1, 60],
                ["longMin", "Long break", 1, 90],
                ["longEvery", "Long break every", 2, 12],
              ] as const
            ).map(([k, label, lo, hi]) => (
              <label key={k} className="flex items-center gap-1.5">
                {label}
                <input
                  type="number"
                  min={lo}
                  max={hi}
                  value={cfg[k]}
                  onChange={(e) => {
                    const n = Math.round(Number(e.target.value));
                    if (n >= lo && n <= hi) update({ pomodoro: { ...cfg, [k]: n } });
                  }}
                  className="h-7 w-14 rounded-sm border border-border bg-surface px-1.5 text-fg outline-none focus:border-accent"
                />
                {k === "longEvery" ? "rounds" : "min"}
              </label>
            ))}
          </div>
        )}
      </div>

      <aside className="flex shrink-0 flex-col border-t border-border p-4 lg:w-72 lg:border-l lg:border-t-0" aria-label="Today's focus">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">Today</h2>
        <div className="mt-1 font-mono text-3xl font-semibold tabular-nums">
          {Math.floor(todayMin / 60)}
          <span className="font-sans text-sm text-muted">h </span>
          {todayMin % 60}
          <span className="font-sans text-sm text-muted">m</span>
        </div>
        <div className="text-xs text-muted">{todays.length} session{todays.length === 1 ? "" : "s"}</div>
        <ul className="scroll-thin mt-4 min-h-0 flex-1 space-y-1 overflow-y-auto">
          {todays.map((s) => (
            <li key={s.id} className="group flex items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-hover">
              <span className="font-mono text-xs text-muted">{format(new Date(s.startAt), "HH:mm")}</span>
              <span className="min-w-0 flex-1 truncate">{(s.taskId && tasks[s.taskId]?.title) || "Focus"}</span>
              <span className="font-mono text-xs text-fg-2">{Math.round(s.seconds / 60)}m</span>
              <button type="button" aria-label="Delete session" onClick={() => deleteSession(s.id)} className="opacity-0 group-hover:opacity-100">
                <Trash2 size={13} className="text-muted hover:text-danger" />
              </button>
            </li>
          ))}
          {!todays.length && <li className="px-2 py-6 text-center text-xs text-muted">Finished focus sessions show up here.</li>}
        </ul>
      </aside>
    </div>
  );
}

/** The focused task's subtasks, checked off without leaving the timer (D58). */
function Steps({ parentId }: { parentId: string }) {
  const kids = useDerived().childrenOf(parentId);
  if (!kids.length) return null;
  return (
    <ul aria-label="Subtasks" className="-mt-2 w-80 max-w-full space-y-0.5">
      {kids.map(({ task: k, key }) => (
        <li key={k.id} className="flex items-center gap-2.5 rounded-sm px-3 py-1 text-sm hover:bg-hover">
          <TaskCheckbox status={k.status} priority={k.priority} onToggle={() => toggleDone(k.id, key)} label={`Complete ${k.title}`} size={16} />
          <span className={`min-w-0 flex-1 truncate ${k.status !== "open" ? "text-muted line-through" : ""}`}>{k.title || "Untitled"}</span>
        </li>
      ))}
    </ul>
  );
}

/** Live remaining time for the sidebar while a timer runs. */
export function FocusBadge() {
  const t = useFocus((s) => s.timer);
  const cfg = useSettings((s) => s.settings.pomodoro);
  const now = useNow(t.status === "running");
  if (t.status === "idle") return null;
  const ms = remainingMs(t, now, cfg) ?? elapsedMs(t, now);
  return <span className={`font-mono text-[0.7rem] ${t.status === "paused" ? "text-muted" : "text-accent"}`}>{formatClock(ms)}</span>;
}
