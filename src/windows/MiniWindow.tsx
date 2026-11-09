import { Check, Minus, Pause, Play, Plus, SkipForward, X } from "lucide-react";
import { useEffect, useState } from "react";
import { formatClock } from "../domain/focus";
import { QUADRANT_INFO, QUADRANT_VAR, QUADRANTS } from "../domain/matrix";
import { miniClockMs, parseMiniSnapshot, stepMinutes, type MiniAction, type MiniSnapshot, type MiniTask } from "../domain/mini";
import { apply, readAppearance } from "../lib/applySettings";

const TABS = ["task", "focus", "matrix"] as const;
type Tab = (typeof TABS)[number];
const LABEL: Record<Tab, string> = { task: "Task", focus: "Focus", matrix: "Matrix" };
const TAB_KEY = "momentum:miniTab";
const PHASE: Record<"focus" | "short" | "long", string> = { focus: "Focus", short: "Short break", long: "Long break" };

function savedTab(): Tab {
  try {
    const v = localStorage.getItem(TAB_KEY);
    return TABS.find((t) => t === v) ?? "task";
  } catch {
    return "task";
  }
}

const send = async (action: MiniAction) => (await import("@tauri-apps/api/event")).emit("mini:action", action);
const btn = "btn btn-secondary h-9";

/**
 * The small always-on-top window (D80). No database access: it renders the snapshot the main
 * window pushes and sends every change back as an action (D33).
 */
export function MiniWindow() {
  const [snap, setSnap] = useState<MiniSnapshot | null>(null);
  const [tab, setTab] = useState(savedTab);
  const [now, setNow] = useState(Date.now);

  useEffect(() => {
    const sync = () => {
      const a = readAppearance();
      if (a) apply(a);
    };
    sync();
    window.addEventListener("storage", sync);
    let off: (() => void)[] = [];
    void (async () => {
      const { listen, emit } = await import("@tauri-apps/api/event");
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      const hello = () => void emit("mini:hello");
      off = [
        await listen<unknown>("mini:state", (e) => {
          const s = parseMiniSnapshot(e.payload);
          if (s) setSnap(s);
        }),
        await getCurrentWindow().onFocusChanged(({ payload }) => {
          if (payload) {
            sync();
            hello();
          }
        }),
      ];
      hello();
    })();
    return () => {
      window.removeEventListener("storage", sync);
      off.forEach((f) => f());
    };
  }, []);

  const running = snap?.timer.status === "running";
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [running]);

  const pick = (t: Tab) => {
    setTab(t);
    try {
      localStorage.setItem(TAB_KEY, t);
    } catch {
      // Storage unavailable: the tab just isn't remembered.
    }
  };
  const close = async () => (await import("@tauri-apps/api/window")).getCurrentWindow().hide();

  return (
    <div className="layer layer-raised flex h-full flex-col overflow-hidden rounded-panel">
      <div className="flex h-10 shrink-0 items-center border-b border-border">
        <div data-tauri-drag-region className="h-full flex-1 select-none px-3 text-[length:var(--fs-sm)] font-medium leading-10">
          Momentum
        </div>
        <button type="button" aria-label="Close mini window" title="Close" onClick={() => void close()} className="btn btn-ghost btn-sm icon-btn mr-1 text-muted">
          <X size={16} strokeWidth={1.75} />
        </button>
      </div>
      <div
        role="tablist"
        aria-label="Mini window"
        className="seg mx-2 my-2 flex"
        onKeyDown={(e) => {
          const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
          if (!step) return;
          const next = (TABS.indexOf(tab) + step + TABS.length) % TABS.length;
          pick(TABS[next]);
          e.currentTarget.querySelectorAll("button")[next]?.focus();
          e.preventDefault();
        }}
      >
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            tabIndex={tab === t ? 0 : -1}
            onClick={() => pick(t)}
            className={`seg-item flex-1 justify-center ${tab === t ? "is-on" : ""}`}
          >
            {LABEL[t]}
          </button>
        ))}
      </div>
      <div role="tabpanel" className="min-h-0 flex-1 overflow-auto px-2 pb-2">
        {!snap ? <p className="px-2 py-6 text-center text-[length:var(--fs-sm)] text-muted">Waiting for Momentum…</p> : tab === "task" ? <TaskTab snap={snap} /> : tab === "focus" ? <FocusTab snap={snap} now={now} /> : <MatrixTab snap={snap} />}
      </div>
    </div>
  );
}

/** Completes the task in the main window (D80, D87). */
function DoneBox({ t, small }: { t: MiniTask; small?: boolean }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={false}
      aria-label={`Complete ${t.title}`}
      onClick={() => void send({ type: "toggle", id: t.id, key: t.key })}
      className={`check ${small ? "sm" : ""}`}
    >
      <Check strokeWidth={2.75} />
    </button>
  );
}

function TaskTab({ snap }: { snap: MiniSnapshot }) {
  if (!snap.tasks.length) return <p className="px-2 py-6 text-center text-[length:var(--fs-sm)] text-muted">Nothing due today.</p>;
  return (
    <>
      <p className="t-label px-2 pb-1 text-muted">{snap.focusing ? "Focusing on" : "Today"}</p>
      <ul className="space-y-0.5">
        {snap.tasks.map((t) => (
          <li key={t.id} className="flex h-[var(--row-compact)] items-center gap-2.5 rounded-control px-2 hover:bg-surface-2">
            <DoneBox t={t} />
            <button type="button" onClick={() => void send({ type: "open", id: t.id, key: t.key })} title="Open in Momentum" className="min-w-0 flex-1 truncate text-left text-[length:var(--fs-sm)]">
              {t.title}
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}

const PRESETS = [15, 25, 45, 60];

function FocusTab({ snap, now }: { snap: MiniSnapshot; now: number }) {
  const t = snap.timer;
  // The length chosen here; the main window stores it as the focus length when Start arrives (D33).
  const [chosen, setChosen] = useState<number | null>(null);
  const minutes = chosen ?? snap.focusMin;
  const active = t.status === "running" || t.status === "paused";
  const startTask = snap.tasks[0] ?? null;
  return (
    <div className="flex flex-col items-center gap-3 px-2 py-4">
      <p className="t-label text-muted">{active ? (t.mode === "stopwatch" ? "Stopwatch" : PHASE[t.phase]) : t.status === "done" ? "Session done" : "Ready"}</p>
      <p className="t-timer text-[length:var(--fs-timer-sm)] leading-[var(--lh-timer-sm)]" aria-live="off">
        {formatClock(active ? miniClockMs(t, snap.at, now) : minutes * 60_000)}
      </p>
      <p className="max-w-full truncate text-[length:var(--fs-sm)] text-fg-2">{snap.focusing ? (snap.tasks.length > 1 ? `${snap.tasks.length} subtasks` : snap.tasks[0].title) : !active && startTask ? `On: ${startTask.title}` : " "}</p>
      {!active && (
        <div className="flex flex-col items-center gap-2">
          <div className="flex items-center gap-1">
            <button type="button" aria-label="5 minutes shorter" onClick={() => setChosen(stepMinutes(minutes, -1))} className="btn btn-ghost btn-sm icon-btn">
              <Minus size={14} strokeWidth={1.75} />
            </button>
            <span className="w-14 text-center text-[length:var(--fs-sm)] tabular-nums" aria-live="polite">{minutes} min</span>
            <button type="button" aria-label="5 minutes longer" onClick={() => setChosen(stepMinutes(minutes, 1))} className="btn btn-ghost btn-sm icon-btn">
              <Plus size={14} strokeWidth={1.75} />
            </button>
          </div>
          <div role="radiogroup" aria-label="Focus length" className="seg">
            {PRESETS.map((p) => (
              <button key={p} type="button" role="radio" aria-checked={minutes === p} onClick={() => setChosen(p)} className={`seg-item tabular-nums ${minutes === p ? "is-on" : ""}`}>
                {p}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="flex gap-2">
        {active ? (
          <>
            <button type="button" className={btn} onClick={() => void send({ type: "focus", op: t.status === "running" ? "pause" : "resume" })}>
              {t.status === "running" ? <Pause size={16} strokeWidth={1.75} /> : <Play size={16} strokeWidth={1.75} />}
              {t.status === "running" ? "Pause" : "Resume"}
            </button>
            <button type="button" className={btn} disabled={t.mode === "stopwatch"} onClick={() => void send({ type: "focus", op: "skip" })}>
              <SkipForward size={16} strokeWidth={1.75} />
              Skip
            </button>
          </>
        ) : (
          <button type="button" className="btn btn-primary h-9 px-6" onClick={() => {
              void send({ type: "focus", op: "start", taskId: startTask?.id ?? null, minutes });
              setChosen(null);
            }}>
            <Play size={16} strokeWidth={1.75} />
            Start
          </button>
        )}
      </div>
    </div>
  );
}

function MatrixTab({ snap }: { snap: MiniSnapshot }) {
  return (
    <div className="grid h-full min-h-48 grid-cols-2 gap-1.5">
      {QUADRANTS.map((q) => {
        const { count, top } = snap.matrix[q - 1];
        return (
          <section key={q} aria-label={QUADRANT_INFO[q].title} className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-card border border-border bg-surface p-1.5">
            <h3 className="flex items-center gap-1.5 px-0.5 text-[length:var(--fs-xs)] font-semibold">
              <span className="h-3 w-[3px] shrink-0 rounded-[2px]" style={{ background: QUADRANT_VAR[q] }} aria-hidden />
              <span className="min-w-0 flex-1 truncate">{QUADRANT_INFO[q].title}</span>
              <span className="tabular-nums text-muted">{count}</span>
            </h3>
            <ul className="mt-0.5 min-h-0 space-y-0.5">
              {top.map((t: MiniTask) => (
                <li key={t.id} className="flex items-center gap-1 rounded-control px-0.5 hover:bg-surface-2">
                  <DoneBox t={t} small />
                  <button type="button" onClick={() => void send({ type: "open", id: t.id, key: t.key })} title={t.title} className="min-w-0 flex-1 truncate text-left text-[length:var(--fs-xs)] text-fg-2 hover:text-fg">
                    {t.title}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
