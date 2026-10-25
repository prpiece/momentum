import { AlarmClock, Check, ExternalLink, X } from "lucide-react";
import { useEffect, useState } from "react";
import { atLocalTime, addDaysLocal, todayLocal } from "../domain/dates";
import { apply, readAppearance } from "../lib/applySettings";
import type { ReminderAction } from "../lib/os";
import type { ReminderDTO } from "../lib/reminderScheduler";

const snoozeOptions = () => {
  const tomorrow9 = atLocalTime(addDaysLocal(todayLocal(), 1), "09:00").getTime();
  return [
    { label: "10 min", minutes: 10 },
    { label: "1 hour", minutes: 60 },
    { label: "Tomorrow 9:00", minutes: Math.round((tomorrow9 - Date.now()) / 60_000) },
  ];
};

/** Always-on-top popup with Done / Snooze / Open for each fired reminder. */
export function ReminderWindow() {
  const [items, setItems] = useState<ReminderDTO[]>([]);

  useEffect(() => {
    const a = readAppearance();
    if (a) apply(a);
    let off: (() => void) | undefined;
    void (async () => {
      const { listen } = await import("@tauri-apps/api/event");
      off = await listen<ReminderDTO>("reminder:show", (e) => {
        const a2 = readAppearance();
        if (a2) apply(a2);
        setItems((xs) => (xs.some((x) => x.key === e.payload.key) ? xs : [...xs, e.payload]));
      });
    })();
    return () => off?.();
  }, []);

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
    <div className="flex h-full flex-col justify-end gap-2 bg-bg p-2">
      {items.map((r) => (
        <article key={r.key} className="anim-rise rounded-md border border-border bg-surface-2 p-3 shadow-lg" aria-live="assertive">
          <div className="flex items-start gap-2.5">
            <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-accent-soft text-accent">
              <AlarmClock size={15} />
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
            <button type="button" onClick={() => void act({ dto: r, action: "done" })} className="flex h-7 items-center gap-1 rounded-sm bg-accent px-2.5 text-xs font-medium text-accent-fg hover:bg-accent-hover">
              <Check size={13} /> Done
            </button>
            {snoozeOptions().map((o) => (
              <button key={o.label} type="button" onClick={() => void act({ dto: r, action: "snooze", minutes: o.minutes })} className="h-7 rounded-sm bg-hover px-2.5 text-xs text-fg-2 hover:text-fg">
                {o.label}
              </button>
            ))}
            <button type="button" onClick={() => void act({ dto: r, action: "open" })} className="ml-auto flex h-7 items-center gap-1 rounded-sm px-2 text-xs text-fg-2 hover:bg-hover">
              <ExternalLink size={13} /> Open
            </button>
          </div>
        </article>
      ))}
    </div>
  );
}
