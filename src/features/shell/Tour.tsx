import { ArrowLeft, ArrowRight, Check, X } from "lucide-react";
import { type CSSProperties, type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Logo } from "../../components/Logo";
import { Segmented } from "../../components/ui/Segmented";
import { ACCENT_PRESETS } from "../../domain/color";
import type { ViewId } from "../../domain/types";
import { useSettings } from "../../stores/settings";
import { go, useUi } from "../../stores/ui";
import { LayoutPicker } from "../settings/LayoutPicker";

const Kbd = ({ children }: { children: ReactNode }) => <kbd className="rounded border border-border bg-bg px-1.5 py-0.5 font-mono text-[0.7rem] text-fg">{children}</kbd>;
const Token = ({ children }: { children: ReactNode }) => <code className="rounded-full bg-accent-soft px-2 py-0.5 font-mono text-[0.72rem] text-fg">{children}</code>;
const Tip = ({ children }: { children: ReactNode }) => <p className="rounded-sm bg-accent-soft/60 px-2.5 py-1.5 text-xs leading-relaxed text-fg-2">💡 {children}</p>;

function MakeItYours() {
  const s = useSettings((x) => x.settings);
  const update = useSettings((x) => x.update);
  return (
    <div className="space-y-3.5">
      <p>Tasks, calendar, habits and focus in one calm place, all on this computer. Make it yours first; everything changes as you click.</p>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-semibold text-fg">Theme</span>
        <Segmented
          name="tour-theme"
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
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-semibold text-fg">Accent</span>
        <div className="flex gap-1.5">
          {ACCENT_PRESETS.map((p) => (
            <button
              key={p.hex}
              type="button"
              aria-label={p.name}
              aria-pressed={s.accent === p.hex}
              onClick={() => update({ accent: p.hex })}
              className="grid size-6 place-items-center rounded-full transition-transform duration-[var(--dur)] hover:scale-110 focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-2"
              style={{ background: p.hex }}
            >
              {s.accent === p.hex && <Check size={12} strokeWidth={3} className="anim-pop text-accent-fg" />}
            </button>
          ))}
        </div>
      </div>
      <div className="space-y-1.5">
        <span className="text-xs font-semibold text-fg">Layout</span>
        <LayoutPicker />
      </div>
    </div>
  );
}

type Step = {
  title: string;
  body: ReactNode;
  /** `[data-tour=…]` to spotlight, or "main" for the whole content area. None: a centered card. */
  target?: string;
  /** Opened before the step shows. */
  view?: ViewId;
  /** Clicks reach the spotlighted part, so you can try it. */
  interactive?: boolean;
};

/** The guided tour (D69): every area of the app, what it's for and the tricks that make it fast. */
const STEPS: Step[] = [
  { title: "Welcome to Momentum", body: <MakeItYours /> },
  {
    title: "Your smart lists",
    target: "nav",
    view: "today",
    body: (
      <>
        <p><b>Inbox</b> catches new tasks. <b>Today</b> shows what's due, plus anything overdue. <b>Upcoming</b> lays out the days ahead. The numbers are what's still open.</p>
        <Tip>Drag a task onto Today to do it today, or onto Upcoming to push it to tomorrow.</Tip>
      </>
    ),
  },
  {
    title: "Add tasks the way you'd say them",
    target: "quickadd",
    view: "today",
    interactive: true,
    body: (
      <>
        <p>Type a task and press Enter. Momentum picks out the details as you type. Try one now.</p>
        <div className="flex flex-wrap gap-1.5">
          <Token>tomorrow 5pm</Token> <Token>!high</Token> <Token>#school</Token> <Token>~Work</Token> <Token>every mon</Token>
        </div>
        <Tip>
          Press <Kbd>N</Kbd> anywhere in the app, or <Kbd>Ctrl Shift A</Kbd> from any other app for a quick-add popup.
        </Tip>
        <Tip>
          Hold <Kbd>Ctrl Alt Space</Kbd> and just say it: "study chem tomorrow 5pm priority high". Voice runs on this computer; turn it on in Settings → Voice. You can also say "open calendar" or "start focus".
        </Tip>
      </>
    ),
  },
  {
    title: "Filter, sort and your streak",
    target: "toolbar",
    view: "today",
    body: (
      <>
        <p>Filter any list with the same words you add tasks with: <Token>#school !high</Token> <Token>overdue</Token>. Pin a filter to give it its own place in the navigation.</p>
        <p>On Today, the 🔥 flame counts your perfect days in a row: everything due done and every daily habit kept. One rest day a week won't break it.</p>
        <Tip>Group and sort from the button on the right; each list remembers its own choice.</Tip>
      </>
    ),
  },
  {
    title: "Working with tasks",
    target: "main",
    view: "today",
    body: (
      <>
        <p>Click a task to open its details: notes, subtasks, a checklist, reminders and repeats. Right-click anything for its actions, and drag to reorder or reschedule.</p>
        <p>Notes take Markdown and images: paste, drop or pick one, and hover it to copy it back out. Reminders pop up in the corner with Done and Snooze.</p>
        <Tip>
          <Kbd>J</Kbd> <Kbd>K</Kbd> move, <Kbd>C</Kbd> completes, <Kbd>1</Kbd>–<Kbd>3</Kbd> set priority, <Kbd>T</Kbd> does it today, and <Kbd>Ctrl Z</Kbd> undoes anything.
        </Tip>
      </>
    ),
  },
  {
    title: "Lists and folders",
    target: "lists",
    body: (
      <>
        <p>Make a list for each part of your life (school, work, home) and group them into folders. Each list can show as a list, a board or a timeline, with its own color and icon.</p>
        <Tip>Drop tasks onto a list to move them. Right-click a list to pin, archive, edit it or import many tasks at once from pasted text.</Tip>
      </>
    ),
  },
  {
    title: "Calendar",
    target: "main",
    view: "calendar",
    body: (
      <>
        <p>Your tasks and events by day, week or month. Drag a task from the side panel onto a time slot to block out time for it, and drag edges to resize.</p>
        <Tip>Habits and focus sessions can show here too: turn them on from the calendar's options.</Tip>
      </>
    ),
  },
  {
    title: "Eisenhower matrix",
    target: "main",
    view: "today",
    body: (
      <>
        <p>Sorts your tasks by urgent and important, so you see what to do now, what to schedule, what to hand off and what to drop.</p>
        <Tip>Drag a task between quadrants to change its priority or due date. You decide what counts as urgent in Settings.</Tip>
      </>
    ),
  },
  {
    title: "Habits",
    target: "main",
    view: "habits",
    body: (
      <>
        <p>Build routines with daily or weekly goals, counts like "8 glasses" and reminders. Check in with one click and watch the streak grow.</p>
        <Tip>Hover a habit for its note and mood: pick a face and jot how it went, and change it any time. Today's habits also show at the top of Today.</Tip>
      </>
    ),
  },
  {
    title: "Focus timer",
    target: "main",
    view: "focus",
    body: (
      <>
        <p>A Pomodoro timer: focus rounds, short breaks and a long break after a set. Pick a task to log the time against it.</p>
        <Tip>
          The timer keeps running while you work elsewhere. <Kbd>Ctrl Alt M</Kbd> opens the mini window: your next tasks, the timer and the matrix, always on top.
        </Tip>
      </>
    ),
  },
  {
    title: "Statistics and trophies",
    target: "main",
    view: "stats",
    body: (
      <>
        <p>See what you've finished, your focus time, a heatmap of your year and the trophies you've earned for perfect days, weeks and streaks.</p>
        <Tip>Share turns your week or month into a card to save or copy: numbers only, never task names. Trophies climb in levels, so there's always a next one.</Tip>
      </>
    ),
  },
  {
    title: "Search everything",
    target: "search",
    body: (
      <>
        <p>Find any task, list or habit, or jump anywhere in the app, with one search box.</p>
        <Tip>
          <Kbd>Ctrl K</Kbd> opens it from anywhere. <Kbd>G</Kbd> then <Kbd>T</Kbd> goes straight to Today.
        </Tip>
      </>
    ),
  },
  {
    title: "Settings",
    target: "settings",
    body: (
      <>
        <p>Change the layout, theme, background image, text size and zoom, the sounds, reminders, voice and the focus timer, and back up your data (images included).</p>
        <Tip>Take this tour again any time from Settings → System or search for "tour". After each update, What's new walks you through everything you missed.</Tip>
      </>
    ),
  },
  {
    title: "You're all set",
    body: (
      <>
        <p>A few keys worth remembering:</p>
        <div className="grid grid-cols-2 gap-x-5 gap-y-1.5">
          {(
            [
              ["N", "New task"],
              ["/", "Filter"],
              ["Ctrl K", "Search"],
              ["?", "All shortcuts"],
            ] as const
          ).map(([k, what]) => (
            <div key={k} className="flex items-center justify-between gap-2">
              <span>{what}</span>
              <Kbd>{k}</Kbd>
            </div>
          ))}
        </div>
        <Tip>Everything stays on this computer. Back it up from Settings → Data now and then.</Tip>
      </>
    ),
  },
];

export const openTour = () => useUi.setState({ tourOpen: true });

type Box = { top: number; left: number; width: number; height: number };
const PAD = 6;
const CARD_W = 352;
const GAP = 14;

/** Where the step's target is on screen, padded. A `display: contents` wrapper measures its first child. */
function measure(target: string | undefined): Box | null {
  if (!target) return null;
  const el = document.querySelector(target === "main" ? "main" : `[data-tour="${target}"]`);
  const box = el && (el.getBoundingClientRect().width ? el : el.firstElementChild);
  if (!box) return null;
  const r = box.getBoundingClientRect();
  if (!r.width || !r.height) return null;
  // Padded, but kept inside the window so the outline never runs off an edge.
  const top = Math.max(4, r.top - PAD);
  const left = Math.max(4, r.left - PAD);
  return { top, left, width: Math.min(window.innerWidth - 4, r.right + PAD) - left, height: Math.min(window.innerHeight - 4, r.bottom + PAD) - top };
}

/** Beside the spotlight where there's room, else below or above it, else over its bottom edge. */
function place(b: Box | null, cardH: number): CSSProperties {
  const W = window.innerWidth;
  const H = window.innerHeight;
  const clampTop = (t: number) => Math.max(12, Math.min(t, H - cardH - 12));
  const clampLeft = (l: number) => Math.max(12, Math.min(l, W - CARD_W - 12));
  if (!b) return { top: clampTop((H - cardH) / 2), left: clampLeft((W - CARD_W) / 2) };
  if (b.left + b.width + GAP + CARD_W < W - 12) return { top: clampTop(b.top), left: b.left + b.width + GAP };
  if (b.left - GAP - CARD_W > 12) return { top: clampTop(b.top), left: b.left - GAP - CARD_W };
  if (b.top + b.height + GAP + cardH < H - 12) return { top: b.top + b.height + GAP, left: clampLeft(b.left) };
  if (b.top - GAP - cardH > 12) return { top: b.top - GAP - cardH, left: clampLeft(b.left) };
  return { top: clampTop(b.top + b.height - cardH - 24), left: clampLeft(b.left + b.width - CARD_W - 24) };
}

/** The hole in the click-blocker: everything but the spotlight (evenodd), so interactive steps can be used. */
const holePath = (b: Box) =>
  `path(evenodd, "M0 0H${window.innerWidth}V${window.innerHeight}H0Z M${b.left} ${b.top}h${b.width}v${b.height}h${-b.width}Z")`;

/**
 * The first-run guided tour, and Settings → "Take the tour". Dims the app, spotlights one part at a
 * time and explains it in a card beside it. Skipping or finishing marks it seen (settings.onboarded).
 */
export function Tour() {
  const onboarded = useSettings((s) => s.settings.onboarded);
  const reopened = useUi((s) => s.tourOpen);
  const open = !onboarded || reopened;
  const [i, setI] = useState(0);
  const [box, setBox] = useState<Box | null>(null);
  const [cardH, setCardH] = useState(260);
  const card = useRef<HTMLDivElement>(null);
  const startView = useRef<ViewId | null>(null);
  const step = STEPS[i];
  const last = STEPS.length - 1;

  // Remember where you were, to come back to it at the end.
  useEffect(() => {
    if (open) startView.current = useUi.getState().view;
  }, [open]);

  // Open the step's view, then follow its target as the page settles, scrolls or resizes.
  useEffect(() => {
    if (!open) return;
    if (step.view) go(step.view);
    let frame = 0;
    let prev = "";
    const tick = () => {
      const b = measure(step.target);
      const key = JSON.stringify(b);
      if (key !== prev) {
        prev = key;
        setBox(b);
      }
      frame = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(frame);
  }, [open, step]);

  useLayoutEffect(() => {
    if (card.current) setCardH(card.current.offsetHeight);
  }, [i, open, box]);

  // Focus the card so the keys work, except where the step invites typing in the app.
  useEffect(() => {
    if (open && !step.interactive) card.current?.querySelector<HTMLElement>("[data-primary]")?.focus();
  }, [open, step]);

  if (!open) return null;

  const close = () => {
    useSettings.getState().update({ onboarded: true });
    useUi.setState({ tourOpen: false });
    if (startView.current) go(startView.current);
    setI(0);
  };
  const to = (n: number) => n >= 0 && n <= last && setI(n);
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") return close();
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    if (e.key === "ArrowRight") to(i + 1);
    if (e.key === "ArrowLeft") to(i - 1);
  };
  const ring: CSSProperties = box
    ? { top: box.top, left: box.left, width: box.width, height: box.height }
    : { top: window.innerHeight / 2, left: window.innerWidth / 2, width: 0, height: 0 };

  return (
    <div className="pointer-events-none fixed inset-0 z-[60]" onKeyDown={onKey}>
      {/* Blocks clicks outside the spotlight (and inside it unless the step is interactive). */}
      <div className="pointer-events-auto absolute inset-0" style={step.interactive && box ? { clipPath: holePath(box) } : undefined} onPointerDown={(e) => e.preventDefault()} />
      {/* The dim with a soft-edged hole, which glides from target to target. */}
      <div
        className="tour-ring pointer-events-none absolute rounded-md"
        style={{ ...ring, boxShadow: `0 0 0 9999px rgb(0 0 0 / ${box ? 0.55 : 0.6})`, outline: box ? "2px solid var(--accent)" : "none", outlineOffset: 2 }}
      />
      <div
        ref={card}
        key={i}
        role="dialog"
        aria-modal="true"
        aria-label={step.title}
        className="tour-card anim-rise pointer-events-auto absolute flex flex-col gap-3 rounded-lg border border-border bg-surface-2 p-5 shadow-xl"
        style={{ width: CARD_W, ...place(box, cardH) }}
      >
        <div className="flex items-start gap-3">
          {i === 0 && <Logo size={36} />}
          <div className="min-w-0 flex-1">
            <div className="text-[0.68rem] font-semibold uppercase tracking-wider text-muted">{i === 0 ? "Quick tour" : `${i} of ${last}`}</div>
            <h2 className="text-base font-bold tracking-tight">{step.title}</h2>
          </div>
          <button type="button" onClick={close} aria-label="Skip the tour" title="Skip the tour" className="-mr-1.5 -mt-1 grid size-7 place-items-center rounded-sm text-muted hover:bg-hover hover:text-fg">
            <X size={15} />
          </button>
        </div>
        <div className="space-y-2.5 text-sm leading-relaxed text-fg-2">{step.body}</div>
        <div className="mt-1 h-1 overflow-hidden rounded-full bg-hover" aria-hidden>
          <div className="h-full rounded-full bg-accent transition-[width] duration-[var(--dur)]" style={{ width: `${(i / last) * 100}%` }} />
        </div>
        <div className="flex items-center gap-2">
          {i === 0 ? (
            <button type="button" onClick={close} className="h-9 rounded-sm px-3 text-sm text-muted hover:bg-hover hover:text-fg">
              Skip tour
            </button>
          ) : (
            <button type="button" onClick={() => to(i - 1)} className="flex h-9 items-center gap-1.5 rounded-sm px-3 text-sm text-fg-2 hover:bg-hover">
              <ArrowLeft size={15} /> Back
            </button>
          )}
          <div className="flex-1" />
          <button
            type="button"
            data-primary
            onClick={() => (i < last ? to(i + 1) : close())}
            className="flex h-9 items-center gap-1.5 rounded-sm bg-accent px-4 text-sm font-medium text-accent-fg hover:bg-accent-hover focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-2"
          >
            {i === 0 ? (
              <>
                Show me around <ArrowRight size={15} />
              </>
            ) : i < last ? (
              <>
                Next <ArrowRight size={15} />
              </>
            ) : (
              <>
                <Check size={15} /> Start planning
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
