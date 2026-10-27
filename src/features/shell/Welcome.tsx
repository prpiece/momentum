import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  CalendarRange,
  Check,
  ChevronRight,
  Grid2x2,
  Inbox,
  Keyboard,
  ListFilter,
  type LucideIcon,
  Map as MapIcon,
  Pin,
  Plus,
  Sun,
  Target,
  Timer,
} from "lucide-react";
import { type CSSProperties, type ReactNode, useState } from "react";
import { Logo } from "../../components/Logo";
import { Dialog } from "../../components/ui/Dialog";
import { Segmented } from "../../components/ui/Segmented";
import { ACCENT_PRESETS } from "../../domain/color";
import { useSettings } from "../../stores/settings";
import { useUi } from "../../stores/ui";
import { QuickAdd } from "../tasks/QuickAdd";

const Kbd = ({ children }: { children: ReactNode }) => <kbd className="rounded border border-border bg-bg px-1.5 py-0.5 font-mono text-[0.7rem] text-fg">{children}</kbd>;
const Token = ({ children }: { children: ReactNode }) => <code className="rounded-full bg-accent-soft px-2 py-0.5 font-mono text-[0.72rem] text-fg">{children}</code>;

/** Children appear one after another. */
const stagger = (k: number): CSSProperties => ({ animationDelay: `${60 + k * 50}ms`, animationFillMode: "backwards" });

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <span className="text-sm font-medium">{label}</span>
      {children}
    </div>
  );
}

function MakeItYours() {
  const s = useSettings((x) => x.settings);
  const update = useSettings((x) => x.update);
  return (
    <div className="space-y-4">
      <p className="text-sm leading-relaxed text-fg-2">Tasks, calendar, habits and focus in one calm place. Everything stays on this computer. Pick a look; it changes as you click.</p>
      <Row label="Theme">
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
      </Row>
      <Row label="Accent">
        <div className="flex gap-1.5">
          {ACCENT_PRESETS.map((p) => (
            <button
              key={p.hex}
              type="button"
              aria-label={p.name}
              aria-pressed={s.accent === p.hex}
              onClick={() => update({ accent: p.hex })}
              className="grid size-7 place-items-center rounded-full transition-transform duration-[var(--dur)] hover:scale-110 focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-2"
              style={{ background: p.hex }}
            >
              {s.accent === p.hex && <Check size={14} strokeWidth={3} className="anim-pop text-accent-fg" />}
            </button>
          ))}
        </div>
      </Row>
      <Row label="Animations">
        <Segmented
          name="welcome-motion"
          label="Animations"
          value={s.motion}
          onChange={(motion) => update({ motion })}
          options={[
            { value: "system", label: "System" },
            { value: "on", label: "On" },
            { value: "off", label: "Off" },
          ]}
        />
      </Row>
      <Row label="Week starts on">
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
      </Row>
      <Row label="Time format">
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
      </Row>
    </div>
  );
}

const SYNTAX: [string, string][] = [
  ["tomorrow 5pm", "date & time"],
  ["!high", "priority"],
  ["#school", "tag"],
  ["~Work", "list"],
  ["every mon", "repeat"],
];

function FirstTask() {
  const [added, setAdded] = useState<string[]>([]);
  return (
    <div className="space-y-4">
      <p className="text-sm leading-relaxed text-fg-2">Type a task the way you'd say it. Momentum picks out the details as you type. Try one, then press Enter.</p>
      <QuickAdd defaults={{}} autoFocus placeholder="e.g. Study chem tomorrow 5pm !high #school" isVisible={() => true} onAdded={(t) => setAdded((a) => [...a, t.title])} />
      <div className="flex flex-wrap gap-x-3 gap-y-1.5 text-xs text-muted">
        {SYNTAX.map(([tok, what], k) => (
          <span key={tok} className="anim-rise inline-flex items-center gap-1.5" style={stagger(k)}>
            <Token>{tok}</Token> {what}
          </span>
        ))}
      </div>
      {added.length > 0 ? (
        <ul className="space-y-1">
          {added.map((title, k) => (
            <li key={k} className="anim-rise flex items-center gap-2 text-sm">
              <span className="grid size-5 shrink-0 place-items-center rounded-full bg-accent text-accent-fg">
                <Check size={12} strokeWidth={3} className="anim-pop" />
              </span>
              <span className="truncate">{title}</span>
              <span className="shrink-0 text-xs text-muted">added to Inbox</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted">
          Later: press <Kbd>N</Kbd> in the app, or <Kbd>Ctrl Shift A</Kbd> from any other app.
        </p>
      )}
    </div>
  );
}

const SIDEBAR_TOUR: [LucideIcon, string, string][] = [
  [Inbox, "Inbox", "Where new tasks land until you sort them"],
  [Sun, "Today", "Due today, plus anything overdue"],
  [CalendarRange, "Upcoming", "Everything later, grouped by day"],
  [ChevronRight, "More", "Matrix, Habits, Focus, Countdown, Statistics"],
];

function FindThings() {
  return (
    <div className="space-y-4">
      <ul className="space-y-1 rounded-md border border-border bg-bg p-2">
        {SIDEBAR_TOUR.map(([Icon, label, what], k) => (
          <li key={label} className="anim-rise flex items-center gap-3 rounded-sm px-2 py-1.5" style={stagger(k)}>
            <Icon size={16} className="shrink-0 text-accent" />
            <span className="w-20 shrink-0 text-sm font-medium">{label}</span>
            <span className="truncate text-xs text-muted">{what}</span>
          </li>
        ))}
      </ul>
      <div className="anim-rise space-y-2 text-sm leading-relaxed text-fg-2" style={stagger(4)}>
        <p className="flex flex-wrap items-center gap-1.5">
          <ListFilter size={15} className="text-accent" /> Filter any list with the same words: <Token>#school !high</Token> <Token>overdue</Token> <Token>~Work tomorrow</Token>
        </p>
        <p className="flex flex-wrap items-center gap-1.5">
          <Pin size={15} className="text-accent" /> Pin a filter and it gets its own row in the sidebar. Click a tag on any task to filter by it.
        </p>
      </div>
    </div>
  );
}

const PLAN_TILES: [LucideIcon, string, string][] = [
  [CalendarDays, "Calendar", "Drag tasks onto time slots"],
  [Grid2x2, "Matrix", "Urgent vs. important"],
  [Target, "Habits", "Daily check-ins and streaks"],
  [Timer, "Focus", "Pomodoro, logged to a task"],
];

function PlanTime() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2">
        {PLAN_TILES.map(([Icon, label, what], k) => (
          <div key={label} className="anim-rise flex items-start gap-3 rounded-md border border-border bg-bg p-3" style={stagger(k)}>
            <span className="grid size-8 shrink-0 place-items-center rounded-sm bg-accent-soft text-accent">
              <Icon size={17} />
            </span>
            <div>
              <div className="text-sm font-medium">{label}</div>
              <div className="text-xs text-muted">{what}</div>
            </div>
          </div>
        ))}
      </div>
      <p className="anim-rise text-sm leading-relaxed text-fg-2" style={stagger(4)}>
        Right-click anything for its actions, and drag tasks onto lists, days or quadrants. Reminders still fire when the window is closed to the tray.
      </p>
    </div>
  );
}

const KEYS: [string, string][] = [
  ["N", "New task"],
  ["/", "Filter the list"],
  ["J  K", "Move between tasks"],
  ["C", "Complete"],
  ["1 2 3", "Set priority"],
  ["T", "Do it today"],
  ["G  T", "Go to Today"],
  ["Ctrl K", "Search everything"],
];

function KeyboardFirst() {
  return (
    <div className="space-y-4">
      <p className="text-sm leading-relaxed text-fg-2">Your hands can stay on the keyboard. A few to start with:</p>
      <div className="grid grid-cols-2 gap-x-6 gap-y-2">
        {KEYS.map(([k, what], i) => (
          <div key={k} className="anim-rise flex items-center justify-between gap-3 text-sm" style={stagger(i)}>
            <span className="text-fg-2">{what}</span>
            <Kbd>{k}</Kbd>
          </div>
        ))}
      </div>
      <p className="anim-rise text-xs text-muted" style={stagger(KEYS.length)}>
        Press <Kbd>?</Kbd> any time for the full list, and <Kbd>Ctrl Z</Kbd> undoes anything.
      </p>
    </div>
  );
}

type Step = { icon: LucideIcon; title: string; body: () => ReactNode };
const STEPS: Step[] = [
  { icon: Check, title: "Welcome to Momentum", body: () => <MakeItYours /> },
  { icon: Plus, title: "Add your first task", body: () => <FirstTask /> },
  { icon: MapIcon, title: "Find things again", body: () => <FindThings /> },
  { icon: CalendarDays, title: "Plan your time", body: () => <PlanTime /> },
  { icon: Keyboard, title: "Keyboard first", body: () => <KeyboardFirst /> },
];

export const openWelcome = () => useUi.setState({ welcomeOpen: true });

/** First-run tour (and Settings → "Show welcome tour"). Finishing or skipping marks it seen. */
export function Welcome() {
  const onboarded = useSettings((s) => s.settings.onboarded);
  const reopened = useUi((s) => s.welcomeOpen);
  const update = useSettings((s) => s.update);
  const [i, setI] = useState(0);
  const [dir, setDir] = useState(1);
  if (onboarded && !reopened) return null;

  const last = STEPS.length - 1;
  const to = (n: number) => {
    if (n < 0 || n > last) return;
    setDir(n > i ? 1 : -1);
    setI(n);
  };
  const close = () => {
    update({ onboarded: true });
    useUi.setState({ welcomeOpen: false });
    setI(0);
  };
  const step = STEPS[i];

  return (
    <Dialog label="Welcome to Momentum" onClose={close} width="max-w-lg">
      <div
        className="p-7"
        onKeyDown={(e) => {
          if (e.target instanceof HTMLInputElement) return;
          if (e.key === "ArrowRight") to(i + 1);
          if (e.key === "ArrowLeft") to(i - 1);
        }}
      >
        <div key={i} className="anim-step min-h-[21rem]" style={{ "--dir": dir } as CSSProperties}>
          <div className="mb-5 flex items-center gap-3">
            {i === 0 ? (
              <Logo size={44} />
            ) : (
              <span className="grid size-11 place-items-center rounded-md bg-accent-soft text-accent">
                <step.icon size={22} />
              </span>
            )}
            <div>
              <div className="text-xs font-semibold uppercase tracking-wider text-muted">
                Step {i + 1} of {STEPS.length}
              </div>
              <h2 className="text-xl font-semibold tracking-tight">{step.title}</h2>
            </div>
          </div>
          {step.body()}
        </div>

        <div className="mt-6 flex items-center gap-3">
          <div className="flex flex-1 gap-1.5">
            {STEPS.map((s, k) => (
              <button
                key={s.title}
                type="button"
                aria-label={`Step ${k + 1}: ${s.title}`}
                aria-current={k === i ? "step" : undefined}
                onClick={() => to(k)}
                className={`h-1.5 rounded-full transition-all duration-[var(--dur)] focus-visible:ring-2 focus-visible:ring-accent ${k === i ? "w-5 bg-accent" : "w-1.5 bg-border hover:bg-muted"}`}
              />
            ))}
          </div>
          {i === 0 ? (
            <button type="button" onClick={close} className="h-9 rounded-sm px-3 text-sm text-muted hover:bg-hover hover:text-fg">
              Skip
            </button>
          ) : (
            <button type="button" onClick={() => to(i - 1)} className="flex h-9 items-center gap-1.5 rounded-sm px-3 text-sm text-fg-2 hover:bg-hover">
              <ArrowLeft size={15} /> Back
            </button>
          )}
          {i < last ? (
            <button type="button" autoFocus={i === 0} onClick={() => to(i + 1)} className="flex h-9 items-center gap-1.5 rounded-sm bg-accent px-4 text-sm font-medium text-accent-fg hover:bg-accent-hover">
              {i === 0 ? "Let's go" : "Next"} <ArrowRight size={15} />
            </button>
          ) : (
            <button type="button" autoFocus onClick={close} className="flex h-9 items-center gap-1.5 rounded-sm bg-accent px-4 text-sm font-medium text-accent-fg hover:bg-accent-hover">
              <Check size={15} /> Start planning
            </button>
          )}
        </div>
      </div>
    </Dialog>
  );
}
