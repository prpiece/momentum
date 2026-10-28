import { AlarmClock, CalendarClock, Check, ExternalLink, Sun, Target, X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { atLocalTime, addDaysLocal, todayLocal } from "../domain/dates";
import { apply, readAppearance } from "../lib/applySettings";
import type { ReminderAction, ReminderShow } from "../lib/os";
import type { ReminderDTO } from "../lib/reminderScheduler";

const snoozeOptions = () => {
  const tomorrow9 = atLocalTime(addDaysLocal(todayLocal(), 1), "09:00").getTime();
  return [
    { label: "10 min", minutes: 10 },
    { label: "1 hour", minutes: 60 },
    { label: "Tomorrow 9:00", minutes: Math.round((tomorrow9 - Date.now()) / 60_000) },
  ];
};

const ICON = { task: AlarmClock, habit: Target, event: CalendarClock, digest: Sun };
const WIDTH = 380;
const MAX_HEIGHT = 560;

/** Shrinks the window to its cards and pins it to the chosen corner of the screen. */
async function fit(height: number, corner: ReminderShow["corner"]) {
  const { getCurrentWindow, currentMonitor } = await import("@tauri-apps/api/window");
  const { LogicalSize, PhysicalPosition } = await import("@tauri-apps/api/dpi");
  const w = getCurrentWindow();
  await w.setSize(new LogicalSize(WIDTH, Math.min(height, MAX_HEIGHT)));
  const m = await currentMonitor();
  if (m) {
    const size = await w.outerSize();
    const margin = Math.round(16 * m.scaleFactor);
    const { x, y } = m.workArea.position;
    const top = corner === "top-right" ? y + margin : y + m.workArea.size.height - size.height - margin;
    await w.setPosition(new PhysicalPosition(x + m.workArea.size.width - size.width - margin, top));
  }
  await w.show();
}

/** Always-on-top popup with Done / Snooze / Open for each fired reminder. */
export function ReminderWindow() {
  const [items, setItems] = useState<ReminderDTO[]>([]);
  const corner = useRef<ReminderShow["corner"]>("bottom-right");
  const stack = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const a = readAppearance();
    if (a) apply(a);
    let off: (() => void) | undefined;
    void (async () => {
      const { listen } = await import("@tauri-apps/api/event");
      off = await listen<ReminderShow>("reminder:show", (e) => {
        const a2 = readAppearance();
        if (a2) apply(a2);
        const { dto } = e.payload;
        corner.current = e.payload.corner;
        setItems((xs) => (xs.some((x) => x.key === dto.key) ? xs : [...xs, dto]));
      });
    })();
    return () => off?.();
  }, []);

  useLayoutEffect(() => {
    if (items.length && stack.current) void fit(stack.current.offsetHeight, corner.current);
  }, [items]);

  const act = async (a: ReminderAction) => {
    const { emit } = await import("@tauri-apps/api/event");
    await emit("reminder:action", a);
    const rest = items.filter((x) => x.key !== a.dto.key);
    setItems(rest);
    if (!rest.length) {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      await getCurrentWindow().hide();
    }
  };

  return (
    <div className="h-full overflow-y-auto bg-bg">
      <div ref={stack} className="flex flex-col gap-2 p-2">
      {items.map((r) => {
        const Icon = ICON[r.target.kind];
        const doable = r.target.kind === "task" || r.target.kind === "habit";
        return (
        <article key={r.key} className="anim-rise rounded-md border border-border bg-surface-2 p-3 shadow-lg" aria-live="assertive">
          <div className="flex items-start gap-2.5">
            <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-accent-soft text-accent">
              <Icon size={15} />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-sm font-semibold">{r.title}</h2>
              <p className="text-xs text-muted">
                {r.body}
              </p>
            </div>
            <button type="button" aria-label="Dismiss" onClick={() => void act({ dto: r, action: "dismiss" })} className="grid size-6 place-items-center rounded-sm text-muted hover:bg-hover">
              <X size={14} />
            </button>
          </div>
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {doable && (
              <button type="button" onClick={() => void act({ dto: r, action: "done" })} className="flex h-7 items-center gap-1 rounded-sm bg-accent px-2.5 text-xs font-medium text-accent-fg hover:bg-accent-hover">
                <Check size={13} /> Done
              </button>
            )}
            {r.target.kind !== "digest" && snoozeOptions().map((o) => (
              <button key={o.label} type="button" onClick={() => void act({ dto: r, action: "snooze", minutes: o.minutes })} className="h-7 rounded-sm bg-hover px-2.5 text-xs text-fg-2 hover:text-fg">
                {o.label}
              </button>
            ))}
            <button type="button" onClick={() => void act({ dto: r, action: "open" })} className="ml-auto flex h-7 items-center gap-1 rounded-sm px-2 text-xs text-fg-2 hover:bg-hover">
              <ExternalLink size={13} /> Open
            </button>
          </div>
        </article>
        );
      })}
      </div>
    </div>
  );
}
