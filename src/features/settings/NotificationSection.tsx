import { AlarmClock, BellRing, Check, Monitor, PanelBottom, PanelTop } from "lucide-react";
import type { ReactNode } from "react";
import { Segmented } from "../../components/ui/Segmented";
import type { NotifySettings } from "../../domain/types";
import { testNotification } from "../../lib/os";
import { useSettings } from "../../stores/settings";

type Flag = { [K in keyof NotifySettings]: NotifySettings[K] extends boolean ? K : never }[keyof NotifySettings];

const KINDS: [Flag, string, string][] = [
  ["taskReminders", "Task reminders", "The reminders you set on a task"],
  ["starts", "When things start", "Timed tasks and events, at their start time"],
  ["habitReminders", "Habit reminders", "At each habit's reminder times, while it's still due"],
  ["digest", "Daily summary", "What's due today and overdue, once a day"],
  ["focus", "Focus timer", "When a focus session or break ends"],
  ["quickAdd", "Global quick add", "Confirms tasks added from anywhere"],
];

function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative h-5 w-9 shrink-0 rounded-full transition-colors duration-[var(--dur)] ${checked ? "bg-accent" : "bg-border"}`}
    >
      <span className={`absolute left-0 top-0.5 size-4 rounded-full bg-white shadow-sm transition-transform duration-[var(--dur)] ease-[var(--ease)] ${checked ? "translate-x-[1.125rem]" : "translate-x-0.5"}`} />
    </button>
  );
}

function Line({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-4">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">{title}</div>
        {hint && <div className="text-xs text-muted">{hint}</div>}
      </div>
      {children}
    </div>
  );
}

/** A still of the popup card, so the style choice is visible before anything fires. */
function Preview({ style }: { style: NotifySettings["style"] }) {
  return (
    <div className="flex flex-wrap items-end gap-3 rounded-md bg-bg p-3" aria-hidden="true">
      {style !== "system" && (
        <div className="w-64 rounded-md border border-border bg-surface-2 p-3 shadow-lg">
          <div className="flex items-start gap-2.5">
            <span className="grid size-7 shrink-0 place-items-center rounded-full bg-accent-soft text-accent">
              <AlarmClock size={15} />
            </span>
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold">Dentist appointment</div>
              <div className="text-xs text-muted">Today at 14:30</div>
            </div>
          </div>
          <div className="mt-2.5 flex gap-1.5">
            <span className="flex h-6 items-center gap-1 rounded-sm bg-accent px-2 text-[0.7rem] font-medium text-accent-fg">
              <Check size={12} /> Done
            </span>
            <span className="flex h-6 items-center rounded-sm bg-hover px-2 text-[0.7rem] text-fg-2">10 min</span>
            <span className="flex h-6 items-center rounded-sm bg-hover px-2 text-[0.7rem] text-fg-2">1 hour</span>
          </div>
        </div>
      )}
      {style !== "popup" && (
        <div className="flex w-56 items-start gap-2 rounded-sm border border-border bg-surface p-2.5 shadow-sm">
          <Monitor size={14} className="mt-0.5 shrink-0 text-muted" />
          <div className="min-w-0">
            <div className="truncate text-xs font-semibold">Dentist appointment</div>
            <div className="text-[0.7rem] text-muted">Windows notification</div>
          </div>
        </div>
      )}
    </div>
  );
}

export function NotificationSection() {
  const n = useSettings((s) => s.settings.notify);
  const update = useSettings((s) => s.update);
  const set = (patch: Partial<NotifySettings>) => update({ notify: { ...useSettings.getState().settings.notify, ...patch } });

  return (
    <div className="space-y-4">
      <Line title="Notifications" hint="Reminders keep firing while Momentum sits in the tray.">
        <Switch checked={n.enabled} onChange={(enabled) => set({ enabled })} label="Notifications" />
      </Line>
      <div className={`space-y-4 transition-opacity duration-[var(--dur)] ${n.enabled ? "" : "pointer-events-none opacity-45"}`} aria-disabled={!n.enabled}>
        <div className="space-y-3 border-t border-border pt-4">
          <div className="text-xs font-semibold uppercase tracking-wider text-muted">What notifies</div>
          {KINDS.map(([k, title, hint]) => (
            <Line key={k} title={title} hint={hint}>
              {k === "digest" && n.digest && (
                <input type="time" aria-label="Daily summary time" value={n.digestTime} onChange={(e) => e.target.value && set({ digestTime: e.target.value })} className="h-8 rounded-sm border border-border bg-surface px-2 font-mono text-sm outline-none focus:border-accent" />
              )}
              <Switch checked={n[k]} onChange={(v) => set({ [k]: v })} label={title} />
            </Line>
          ))}
        </div>
        <div className="space-y-3 border-t border-border pt-4">
          <div className="text-xs font-semibold uppercase tracking-wider text-muted">How they look</div>
          <Line title="Style" hint="The popup has Done, Snooze and Open buttons.">
            <Segmented
              name="notify-style"
              label="Notification style"
              value={n.style}
              onChange={(style) => set({ style })}
              options={[
                { value: "popup", label: "Popup" },
                { value: "system", label: "Windows" },
                { value: "both", label: "Both" },
              ]}
            />
          </Line>
          {n.style !== "system" && (
            <>
              <Line title="Popup position">
                <div className="flex gap-1">
                  {(
                    [
                      ["bottom-right", "Bottom right", PanelBottom],
                      ["top-right", "Top right", PanelTop],
                    ] as const
                  ).map(([v, label, Icon]) => (
                    <button key={v} type="button" aria-pressed={n.corner === v} onClick={() => set({ corner: v })} className={`flex h-8 items-center gap-1.5 rounded-sm border px-2.5 text-xs ${n.corner === v ? "border-accent bg-accent-soft text-fg" : "border-border text-fg-2 hover:bg-hover"}`}>
                      <Icon size={14} /> {label}
                    </button>
                  ))}
                </div>
              </Line>
              <Line title="Chime" hint="A soft two-note sound with each popup.">
                <Switch checked={n.sound} onChange={(sound) => set({ sound })} label="Chime" />
              </Line>
            </>
          )}
          <Preview style={n.style} />
          <button type="button" onClick={testNotification} className="flex h-9 items-center gap-2 rounded-sm border border-border px-3 text-sm hover:bg-hover">
            <BellRing size={15} /> Send a test notification
          </button>
        </div>
      </div>
    </div>
  );
}
