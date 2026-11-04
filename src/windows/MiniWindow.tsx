import { Check, Pause, Play, SkipForward, X } from "lucide-react";
import { useEffect, useState } from "react";
import { formatClock } from "../domain/focus";
import { QUADRANT_INFO, QUADRANTS } from "../domain/matrix";
import { miniClockMs, parseMiniSnapshot, type MiniAction, type MiniSnapshot, type MiniTask } from "../domain/mini";
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
const btn = "inline-flex h-9 items-center justify-center gap-1.5 rounded-sm border border-border px-3 text-sm font-medium transition-colors duration-[var(--dur)] hover:bg-hover disabled:opacity-40";

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
    <div className="flex h-full flex-col overflow-hidden rounded-lg border border-border bg-surface text-fg">
      <div className="flex h-8 shrink-0 items-center">
        <div data-tauri-drag-region className="h-full flex-1 select-none px-3 text-xs font-medium leading-8 text-muted">
          Momentum
        </div>
        <button type="button" aria-label="Close mini window" title="Close" onClick={() => void close()} className="mr-1 grid size-6 place-items-center rounded-sm text-muted hover:bg-hover hover:text-fg">
          <X size={14} />
        </button>
      </div>
      <div
        role="tablist"
        aria-label="Mini window"
        className="flex shrink-0 gap-1 px-2 pb-2"
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
            className={`h-8 flex-1 rounded-sm text-sm font-medium transition-colors duration-[var(--dur)] ${tab === t ? "bg-accent-soft text-fg" : "text-muted hover:bg-hover"}`}
          >
            {LABEL[t]}
          </button>
        ))}
      </div>
      <div role="tabpanel" className="min-h-0 flex-1 overflow-auto px-2 pb-2">
        {!snap ? <p className="px-2 py-6 text-center text-sm text-muted">Waiting for Momentum…</p> : tab === "task" ? <TaskTab snap={snap} /> : tab === "focus" ? <FocusTab snap={snap} now={now} /> : <MatrixTab snap={snap} />}
      </div>
    </div>
  );
}

function TaskTab({ snap }: { snap: MiniSnapshot }) {
  if (!snap.tasks.length) return <p className="px-2 py-6 text-center text-sm text-muted">Nothing due today.</p>;
  return (
    <>
      <p className="px-2 pb-1 text-xs font-medium uppercase tracking-wide text-muted">{snap.focusing ? "Focusing on" : "Today"}</p>
      <ul className="space-y-0.5">
        {snap.tasks.map((t) => (
          <li key={t.id} className="flex items-center gap-2 rounded-sm px-2 py-1.5 hover:bg-hover">
            <button
              type="button"
              role="checkbox"
              aria-checked={false}
              aria-label={`Complete ${t.title}`}
              onClick={() => void send({ type: "toggle", id: t.id, key: t.key })}
              className="group grid size-[18px] shrink-0 place-items-center rounded-full border-[1.75px] border-muted hover:border-accent"
            >
              <Check size={11} strokeWidth={3.5} className="text-accent opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100" />
            </button>
            <button type="button" onClick={() => void send({ type: "open", id: t.id, key: t.key })} title="Open in Momentum" className="min-w-0 flex-1 truncate text-left text-sm">
              {t.title}
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}

function FocusTab({ snap, now }: { snap: MiniSnapshot; now: number }) {
  const t = snap.timer;
  const active = t.status === "running" || t.status === "paused";
  const startTask = snap.tasks[0] ?? null;
  return (
    <div className="flex flex-col items-center gap-3 px-2 py-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted">{active ? (t.mode === "stopwatch" ? "Stopwatch" : PHASE[t.phase]) : t.status === "done" ? "Session done" : "Ready"}</p>
      <p className="font-mono text-5xl tabular-nums" aria-live="off">
        {formatClock(active ? miniClockMs(t, snap.at, now) : 0)}
      </p>
      <p className="max-w-full truncate text-sm text-fg-2">{snap.focusing ? snap.tasks[0].title : !active && startTask ? `On: ${startTask.title}` : " "}</p>
      <div className="flex gap-2">
        {active ? (
          <>
            <button type="button" className={btn} onClick={() => void send({ type: "focus", op: t.status === "running" ? "pause" : "resume" })}>
              {t.status === "running" ? <Pause size={15} /> : <Play size={15} />}
              {t.status === "running" ? "Pause" : "Resume"}
            </button>
            <button type="button" className={btn} disabled={t.mode === "stopwatch"} onClick={() => void send({ type: "focus", op: "skip" })}>
              <SkipForward size={15} />
              Skip
            </button>
          </>
        ) : (
          <button type="button" className={`${btn} border-transparent bg-accent text-accent-fg hover:bg-accent-hover`} onClick={() => void send({ type: "focus", op: "start", taskId: startTask?.id ?? null })}>
            <Play size={15} />
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
          <section key={q} aria-label={QUADRANT_INFO[q].title} className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-md border border-border p-1.5" style={{ borderTopColor: `var(--q${q})`, borderTopWidth: 3 }}>
            <h3 className="flex items-baseline justify-between gap-1 px-0.5 text-xs font-semibold">
              <span className="truncate">{QUADRANT_INFO[q].title}</span>
              <span className="font-mono tabular-nums text-muted">{count}</span>
            </h3>
            <ul className="mt-0.5 min-h-0 space-y-0.5">
              {top.map((t: MiniTask) => (
                <li key={t.id}>
                  <button type="button" onClick={() => void send({ type: "open", id: t.id, key: t.key })} title={t.title} className="block w-full truncate rounded-sm px-0.5 text-left text-xs text-fg-2 hover:bg-hover hover:text-fg">
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
