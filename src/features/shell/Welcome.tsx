import {
  ArrowLeft,
  ArrowRight,
  Bell,
  CalendarDays,
  ChartColumn,
  Check,
  Grid2x2,
  Inbox,
  Keyboard,
  ListTodo,
  type LucideIcon,
  MousePointerClick,
  Search,
  Sparkles,
  Target,
  Timer,
  Undo2,
  WifiOff,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import { Logo } from "../../components/Logo";
import { Dialog } from "../../components/ui/Dialog";
import { Segmented } from "../../components/ui/Segmented";
import { ACCENT_PRESETS } from "../../domain/color";
import { useSettings } from "../../stores/settings";
import { useUi } from "../../stores/ui";

type Step = { icon: LucideIcon; title: string; body: ReactNode; tiles?: [LucideIcon, string][] };

const Kbd = ({ children }: { children: ReactNode }) => <kbd className="rounded border border-border bg-bg px-1.5 py-0.5 font-mono text-[0.7rem] text-fg">{children}</kbd>;

const STEPS: Step[] = [
  {
    icon: Sparkles,
    title: "Welcome to Momentum",
    body: "Tasks, calendar, habits and focus in one calm place. It runs fully offline: everything stays on this computer. This quick tour takes about a minute.",
    tiles: [
      [ListTodo, "Tasks"],
      [CalendarDays, "Calendar"],
      [Target, "Habits"],
      [WifiOff, "Offline"],
    ],
  },
  {
    icon: Inbox,
    title: "Capture anything, fast",
    body: (
      <>
        Type in the add bar at the top of a list. Momentum understands plain language: <em className="text-fg">“Study chem tomorrow 5pm !high #school ~Uni”</em> sets the date, priority, tag and list. Press <Kbd>N</Kbd> to add a task, or <Kbd>Ctrl Shift A</Kbd> from any app. The same words work in the filter box above each list, and you can pin a filter to the sidebar.
      </>
    ),
  },
  {
    icon: MousePointerClick,
    title: "Right-click and drag",
    body: "Right-click any task, list, habit or calendar block for its actions: reschedule, set priority, move, pin, duplicate or delete. Drag tasks onto lists in the sidebar, onto the calendar, or between Matrix quadrants. Ctrl or Shift-click to select several.",
  },
  {
    icon: CalendarDays,
    title: "Plan your time",
    body: "The Calendar shows day, 5-day, week, month and agenda views. Drag unscheduled tasks from the side panel onto a time slot, and drag across days in the mini calendar to see exactly those days. The Matrix sorts work by urgent and important.",
    tiles: [
      [CalendarDays, "Calendar"],
      [Grid2x2, "Matrix"],
    ],
  },
  {
    icon: Target,
    title: "Habits and focus",
    body: "Check in on habits daily, by count or by amount, and watch streaks grow. Mis-tapped? Use Undo in the toast or right-click the habit. The Focus timer runs Pomodoro sessions and logs your time against a task.",
    tiles: [
      [Target, "Habits"],
      [Timer, "Focus"],
    ],
  },
  {
    icon: Bell,
    title: "Stay on track",
    body: "Momentum reminds you when tasks start, when reminders are due, and with a daily summary, even from the tray. Choose what notifies you and how it looks in Settings → Notifications. Statistics shows your streaks and where your time went.",
    tiles: [
      [Bell, "Reminders"],
      [ChartColumn, "Statistics"],
    ],
  },
  {
    icon: Keyboard,
    title: "Shortcuts",
    body: (
      <ul className="space-y-1.5">
        <li className="flex items-center gap-2">
          <Search size={14} className="text-muted" /> <Kbd>Ctrl K</Kbd> search tasks, lists and commands
        </li>
        <li className="flex items-center gap-2">
          <Keyboard size={14} className="text-muted" /> <Kbd>?</Kbd> every keyboard shortcut
        </li>
        <li className="flex items-center gap-2">
          <Undo2 size={14} className="text-muted" /> <Kbd>Ctrl Z</Kbd> undo the last change
        </li>
      </ul>
    ),
  },
];

function Setup() {
  const s = useSettings((x) => x.settings);
  const update = useSettings((x) => x.update);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-sm font-medium">Theme</span>
        <Segmented
          name="welcome-theme"
          label="Theme"
          value={s.theme}
          onChange={(theme) => update({ theme })}
          options={[
            { value: "light", label: "Light" },
            { value: "dark", label: "Dark" },
            { value: "system", label: "System" },
          ]}
        />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-sm font-medium">Accent</span>
        <div className="flex gap-1.5">
          {ACCENT_PRESETS.map((p) => (
            <button key={p.hex} type="button" aria-label={p.name} aria-pressed={s.accent === p.hex} onClick={() => update({ accent: p.hex })} className="grid size-7 place-items-center rounded-full transition-transform hover:scale-110" style={{ background: p.hex }}>
              {s.accent === p.hex && <Check size={14} strokeWidth={3} className="text-accent-fg" />}
            </button>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-sm font-medium">Week starts on</span>
        <Segmented
          name="welcome-week"
          label="Week starts on"
          value={s.weekStart}
          onChange={(weekStart) => update({ weekStart })}
          options={[
            { value: 1, label: "Monday" },
            { value: 0, label: "Sunday" },
            { value: 6, label: "Saturday" },
          ]}
        />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-sm font-medium">Time format</span>
        <Segmented
          name="welcome-time"
          label="Time format"
          value={s.timeFormat}
          onChange={(timeFormat) => update({ timeFormat })}
          options={[
            { value: "12h", label: "1:30 PM" },
            { value: "24h", label: "13:30" },
          ]}
        />
      </div>
      <label className="flex items-center justify-between gap-3 text-sm font-medium">
        Notifications
        <input type="checkbox" className="size-4 accent-[var(--accent)]" checked={s.notify.enabled} onChange={(e) => update({ notify: { ...s.notify, enabled: e.target.checked } })} />
      </label>
      <p className="text-xs text-muted">Everything here, and more, lives in Settings.</p>
    </div>
  );
}

export const openWelcome = () => useUi.setState({ welcomeOpen: true });

/** First-run tour (and Settings → "Show welcome tour"). Finishing or skipping marks it seen. */
export function Welcome() {
  const onboarded = useSettings((s) => s.settings.onboarded);
  const reopened = useUi((s) => s.welcomeOpen);
  const update = useSettings((s) => s.update);
  const [i, setI] = useState(0);
  if (onboarded && !reopened) return null;

  const last = STEPS.length;
  const close = () => {
    update({ onboarded: true });
    useUi.setState({ welcomeOpen: false });
    setI(0);
  };
  const step = STEPS[i];
  const Icon = step?.icon ?? Check;

  return (
    <Dialog label="Welcome to Momentum" onClose={close} width="max-w-lg">
      <div
        className="p-7"
        onKeyDown={(e) => {
          if (e.target instanceof HTMLInputElement) return;
          if (e.key === "ArrowRight" && i < last) setI(i + 1);
          if (e.key === "ArrowLeft" && i > 0) setI(i - 1);
        }}
      >
        <div key={i} className="anim-rise min-h-[19rem]">
          <div className="mb-5 flex items-center gap-3">
            {i === 0 ? (
              <Logo size={44} />
            ) : (
              <span className="grid size-11 place-items-center rounded-md bg-accent-soft text-accent">
                <Icon size={22} />
              </span>
            )}
            <div>
              <div className="text-xs font-semibold uppercase tracking-wider text-muted">{i < last ? `Step ${i + 1} of ${last + 1}` : "Last step"}</div>
              <h2 className="text-xl font-semibold tracking-tight">{step?.title ?? "Make it yours"}</h2>
            </div>
          </div>
          {step ? (
            <>
              <div className="text-sm leading-relaxed text-fg-2">{step.body}</div>
              {step.tiles && (
                <div className="mt-6 grid grid-cols-[repeat(auto-fit,minmax(6rem,1fr))] gap-2">
                  {step.tiles.map(([T, label], k) => (
                    <div key={label} className="anim-rise flex flex-col items-center gap-2 rounded-md border border-border bg-bg py-4 text-xs font-medium text-fg-2" style={{ animationDelay: `${80 + k * 60}ms`, animationFillMode: "backwards" }}>
                      <T size={22} className="text-accent" />
                      {label}
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : (
            <Setup />
          )}
        </div>

        <div className="mt-6 flex items-center gap-3">
          <div className="flex flex-1 gap-1.5" aria-hidden="true">
            {Array.from({ length: last + 1 }, (_, k) => (
              <span key={k} className={`h-1.5 rounded-full transition-all duration-[var(--dur)] ${k === i ? "w-5 bg-accent" : "w-1.5 bg-border"}`} />
            ))}
          </div>
          {i === 0 ? (
            <button type="button" onClick={close} className="h-9 rounded-sm px-3 text-sm text-muted hover:bg-hover hover:text-fg">
              Skip
            </button>
          ) : (
            <button type="button" onClick={() => setI(i - 1)} className="flex h-9 items-center gap-1.5 rounded-sm px-3 text-sm text-fg-2 hover:bg-hover">
              <ArrowLeft size={15} /> Back
            </button>
          )}
          {i < last ? (
            <button type="button" autoFocus onClick={() => setI(i + 1)} className="flex h-9 items-center gap-1.5 rounded-sm bg-accent px-4 text-sm font-medium text-accent-fg hover:bg-accent-hover">
              {i === 0 ? "Take the tour" : "Next"} <ArrowRight size={15} />
            </button>
          ) : (
            <button type="button" onClick={close} className="flex h-9 items-center gap-1.5 rounded-sm bg-accent px-4 text-sm font-medium text-accent-fg hover:bg-accent-hover">
              <Check size={15} /> Start planning
            </button>
          )}
        </div>
      </div>
    </Dialog>
  );
}
