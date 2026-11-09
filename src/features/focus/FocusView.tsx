import { format } from "date-fns";
import { Pause, Play, SkipForward, Square, Trash2 } from "lucide-react";
import { type CSSProperties, useEffect, useMemo, useState } from "react";
import { BarChart } from "../../components/ui/BarChart";
import { NumField } from "../../components/ui/NumField";
import { TaskCheckbox } from "../../components/ui/TaskCheckbox";
import { fromLocalDate, toLocalDate, todayLocal } from "../../domain/dates";
import { DEFAULT_POMODORO, elapsedMs, formatClock, NO_PICK, phaseMs, remainingMs, type FocusMode, type FocusPick, type Phase } from "../../domain/focus";
import { perWeek, type Bucket } from "../../domain/stats";
import { addDaysLocal } from "../../domain/dates";
import { useData } from "../../stores/data";
import { deleteSession, pauseFocus, resumeFocus, setFocusTask, skipPhase, startFocus, stopFocus, useFocus } from "../../stores/focus";
import { useSettings } from "../../stores/settings";
import { addProgressSection } from "../progress/ProgressView";
import { toggleDone } from "../tasks/actions";
import { useDerived } from "../tasks/selectors";
import { TaskPicker } from "./TaskPicker";

export function focusPhaseLabel(next: Phase | "done"): string {
  if (next === "done") return "Session done. Well played!";
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

addProgressSection({
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
    <section className="card mt-6">
      <div className="card-h">
        <h3>Focus time · last 14 days</h3>
        <span className="text-[length:var(--fs-sm)] tabular-nums text-muted">this week {Math.floor(week / 60)}h {week % 60}m</span>
      </div>
      <BarChart
        title="Focus minutes per day, last 14 days"
        data={days}
        format={(v) => `${v}m`}
        label={(b) => format(fromLocalDate(b.start), "EEE, MMM d")}
        tick={(b, i) => (i % 2 === 1 ? "" : format(fromLocalDate(b.start), "d MMM"))}
        color="var(--accent)"
      />
    </section>
  );
}

export function FocusView() {
  const t = useFocus((s) => s.timer);
  const sessions = useFocus((s) => s.sessions);
  const cfg = useSettings((s) => s.settings.pomodoro);
  const update = useSettings((s) => s.update);
  const tasks = useData((s) => s.tasks);
  const [mode, setMode] = useState<FocusMode>("pomodoro");
  const [pick, setPick] = useState<FocusPick>(NO_PICK);
  const now = useNow(t.status === "running");

  const activeMode = t.status === "running" || t.status === "paused" ? t.mode : mode;
  const remaining = remainingMs(t, now, cfg);
  const elapsed = elapsedMs(t, now);
  const total = (t.status === "running" || t.status === "paused") && t.mode === "pomodoro" ? phaseMs(t.phase, cfg) : 0;
  const progress = total ? 1 - (remaining ?? 0) / total : 0;
  const clock = t.status === "done" ? `${Math.round(t.focusMs / 60_000)}m` : t.status === "idle" ? (mode === "pomodoro" ? formatClock(cfg.focusMin * 60_000) : "00:00") : formatClock(remaining ?? elapsed);
  const today = todayLocal();
  const todays = Object.values(sessions)
    .filter((s) => toLocalDate(new Date(s.startAt)) === today)
    .sort((a, b) => b.startAt.localeCompare(a.startAt));
  const todayMin = Math.round(todays.reduce((n, s) => n + s.seconds, 0) / 60);
  const boundPick: FocusPick = t.status === "idle" ? pick : t.status === "done" ? { taskId: t.taskId, subIds: [] } : { taskId: t.taskId, subIds: t.subIds };

  return (
    // Narrow windows stack the timer above today's sessions and scroll; nothing may shrink under the ring.
    <div className="flex h-full min-h-0 flex-col overflow-y-auto lg:flex-row lg:overflow-hidden">
      <div className="flex shrink-0 flex-col items-center justify-center-safe gap-5 p-6 lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
        {t.status === "idle" && (
          <div role="radiogroup" aria-label="Timer mode" className="seg">
            {(["pomodoro", "stopwatch"] as const).map((m) => (
              <button key={m} type="button" role="radio" aria-checked={mode === m} onClick={() => setMode(m)} className={`seg-item capitalize ${mode === m ? "is-on" : ""}`}>
                {m}
              </button>
            ))}
          </div>
        )}

        <TaskPicker value={boundPick} onChange={(p) => (t.status === "idle" ? setPick(p) : setFocusTask(p.taskId, p.subIds))} />
        {boundPick.taskId && <Steps parentId={boundPick.taskId} only={boundPick.subIds} />}

        <div className="flex flex-col items-center" role="timer" aria-live="off">
          <div className="t-label text-muted">
            {t.status === "idle" ? "Ready" : t.status === "done" ? "Session done" : t.mode === "stopwatch" ? "Stopwatch" : `${PHASE_NAME[t.phase]}${t.phase === "focus" ? ` · round ${t.round}${t.cycles.kind === "finite" ? ` of ${t.cycles.count}` : ""}` : ""}`}
            {t.status === "paused" && " · paused"}
          </div>
          <div className="t-timer my-2">{clock}</div>
          {activeMode === "pomodoro" && (t.status === "running" || t.status === "paused") && (
            <div className="w-[360px] max-w-full">
              <div className="bar">
                <span style={{ width: `${progress * 100}%`, ...(t.phase === "focus" ? {} : { "--c": "var(--success)" }) } as CSSProperties} />
              </div>
              <div className="mt-2 flex justify-between text-[length:var(--fs-sm)] tabular-nums text-muted">
                <span>{formatClock(total - (remaining ?? 0))}</span>
                <span>{formatClock(total)}</span>
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center gap-3">
          {t.status === "done" ? (
            <>
              <button type="button" onClick={() => startFocus("pomodoro", t.taskId)} className="btn btn-primary btn-lg">
                <Play size={18} strokeWidth={1.75} /> Start again
              </button>
              <button type="button" onClick={stopFocus} className="btn btn-secondary btn-lg">
                Close
              </button>
            </>
          ) : t.status === "idle" ? (
            <button type="button" onClick={() => startFocus(mode, pick.taskId, pick.subIds)} className="btn btn-primary btn-lg px-8">
              <Play size={18} strokeWidth={1.75} /> Start
            </button>
          ) : (
            <>
              {t.mode === "pomodoro" && (
                <button type="button" onClick={skipPhase} aria-label="Skip to next phase" title="Skip" className="btn btn-secondary btn-lg icon-btn w-[var(--control-lg)]">
                  <SkipForward size={18} strokeWidth={1.75} />
                </button>
              )}
              {t.status === "running" ? (
                <button type="button" onClick={pauseFocus} className="btn btn-primary btn-lg px-8">
                  <Pause size={18} strokeWidth={1.75} /> Pause
                </button>
              ) : (
                <button type="button" onClick={resumeFocus} className="btn btn-primary btn-lg px-8">
                  <Play size={18} strokeWidth={1.75} /> Resume
                </button>
              )}
              <button type="button" onClick={stopFocus} aria-label="Stop and save" title="Stop" className="btn btn-secondary btn-lg icon-btn w-[var(--control-lg)] hover:text-danger">
                <Square size={16} strokeWidth={1.75} />
              </button>
            </>
          )}
        </div>

        {t.status === "idle" && mode === "pomodoro" && (
          <div className="flex max-w-xl flex-wrap items-center justify-center gap-3 text-[length:var(--fs-sm)] text-muted">
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
                <NumField label={label} lo={lo} hi={hi} def={DEFAULT_POMODORO[k]} value={cfg[k]} onCommit={(n) => update({ pomodoro: { ...cfg, [k]: n } })} />
                {k === "longEvery" ? "rounds" : "min"}
              </label>
            ))}
            <span className="flex items-center gap-1.5">
              Cycles
              <button
                type="button"
                role="switch"
                aria-checked={cfg.cycles.kind === "infinite"}
                aria-label="Repeat until stopped"
                onClick={() => update({ pomodoro: { ...cfg, cycles: cfg.cycles.kind === "infinite" ? { kind: "finite", count: 4 } : { kind: "infinite" } } })}
                className={`btn btn-sm text-[length:var(--fs-base)] ${cfg.cycles.kind === "infinite" ? "border-accent-text bg-accent-soft text-fg" : "btn-secondary"}`}
              >
                ∞
              </button>
              {cfg.cycles.kind === "finite" && <NumField label="Number of cycles" lo={1} hi={24} def={4} value={cfg.cycles.count} onCommit={(n) => update({ pomodoro: { ...cfg, cycles: { kind: "finite", count: n } } })} />}
            </span>
          </div>
        )}
        {t.status === "done" && (
          <p className="text-[length:var(--fs-sm)] text-fg-2">
            {t.cycles} cycle{t.cycles === 1 ? "" : "s"} completed · {Math.round(t.focusMs / 60_000)} min focused
          </p>
        )}
      </div>

      <aside className="flex shrink-0 flex-col gap-6 border-t border-border bg-surface px-4 py-5 lg:w-[280px] lg:border-l lg:border-t-0" aria-label="Today's focus">
        <div>
          <h2 className="t-label mb-1 text-muted">Today</h2>
          <div className="text-[length:var(--fs-xl)] font-semibold leading-[var(--lh-xl)] tabular-nums">
            {Math.floor(todayMin / 60)}
            <span className="text-[length:var(--fs-sm)] font-normal text-muted">h </span>
            {todayMin % 60}
            <span className="text-[length:var(--fs-sm)] font-normal text-muted">m</span>
          </div>
          <div className="text-[length:var(--fs-xs)] text-muted">
            {todays.length} session{todays.length === 1 ? "" : "s"}
          </div>
        </div>
        <ul className="-mx-1 min-h-0 flex-1 space-y-0.5 overflow-y-auto">
          {todays.map((s) => (
            <li key={s.id} className="group flex min-h-10 items-center gap-2.5 rounded-control px-1 text-[length:var(--fs-sm)] hover:bg-surface-2">
              <span className="size-2 shrink-0 rounded-full bg-accent" aria-hidden />
              <span className="flex min-w-0 flex-1 flex-col">
                <b className="truncate font-medium">{(s.taskId && tasks[s.taskId]?.title) || "Focus"}</b>
                <span className="text-[length:var(--fs-xs)] tabular-nums text-muted">{format(new Date(s.startAt), "HH:mm")}</span>
              </span>
              <span className="font-medium tabular-nums">{Math.round(s.seconds / 60)}m</span>
              <button type="button" aria-label="Delete session" onClick={() => deleteSession(s.id)} className="btn btn-ghost btn-sm icon-btn text-muted opacity-0 hover:text-danger focus-visible:opacity-100 group-hover:opacity-100">
                <Trash2 size={14} strokeWidth={1.75} />
              </button>
            </li>
          ))}
          {!todays.length && <li className="px-1 py-6 text-center text-[length:var(--fs-sm)] text-muted">Finished focus sessions show up here.</li>}
        </ul>
      </aside>
    </div>
  );
}

/** The focused task's subtasks, checked off without leaving the timer (D58). */
function Steps({ parentId, only }: { parentId: string; only: string[] }) {
  const kids = useDerived().childrenOf(parentId).filter((k) => !only.length || only.includes(k.task.id));
  if (!kids.length) return null;
  return (
    <ul aria-label="Subtasks" className="-mt-2 w-80 max-w-full space-y-0.5">
      {kids.map(({ task: k, key }) => (
        <li key={k.id} className="flex h-[var(--row-compact)] items-center gap-2.5 rounded-control px-3 text-[length:var(--fs-sm)] hover:bg-surface-2">
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
  if (t.status === "idle" || t.status === "done") return null;
  const ms = remainingMs(t, now, cfg) ?? elapsedMs(t, now);
  return <span className={`tabular-nums text-[length:var(--fs-xs)] ${t.status === "paused" ? "text-muted" : "text-accent"}`}>{formatClock(ms)}</span>;
}
