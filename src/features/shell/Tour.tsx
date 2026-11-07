import { ArrowLeft, ArrowRight, Check, Lightbulb, X } from "lucide-react";
import { type CSSProperties, type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Logo } from "../../components/Logo";
import type { ViewId } from "../../domain/types";
import { useSettings } from "../../stores/settings";
import { useAppVersion } from "../../lib/updater";
import { go, useUi } from "../../stores/ui";

const Kbd = ({ children }: { children: ReactNode }) => <kbd className="rounded border border-border bg-bg px-1.5 py-0.5 font-mono text-[0.7rem] text-fg">{children}</kbd>;
const Token = ({ children }: { children: ReactNode }) => <code className="rounded-full bg-accent-soft px-2 py-0.5 font-mono text-[0.72rem] text-fg">{children}</code>;
const Tip = ({ children }: { children: ReactNode }) => (
  <p className="flex gap-1.5 rounded-sm bg-accent-soft/60 px-2.5 py-1.5 text-xs leading-relaxed text-fg-2">
    <Lightbulb size={13} className="mt-0.5 shrink-0" aria-hidden />
    <span>{children}</span>
  </p>
);

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

/** The tour (D69, cut to four slides in v1.0, D178): the main ideas only. Help has the rest. */
const STEPS: Step[] = [
  {
    title: "Capture anything instantly",
    target: "quickadd",
    view: "today",
    interactive: true,
    body: (
      <>
        <p>Momentum is the planner you do with friends (friends are coming soon). It starts with getting things out of your head: type a task and press Enter. Try one now.</p>
        <div className="flex flex-wrap gap-1.5">
          <Token>tomorrow 5pm</Token> <Token>!high</Token> <Token>#school</Token> <Token>~Work</Token> <Token>every mon</Token>
        </div>
        <Tip>
          Press <Kbd>N</Kbd> in the app, or <Kbd>Ctrl Shift A</Kbd> from any other app. Everything works offline.
        </Tip>
      </>
    ),
  },
  {
    title: "One view, four ways to see it",
    target: "toolbar",
    view: "today",
    body: (
      <>
        <p>Inbox catches new tasks, Today shows what's due, Upcoming the days ahead. Each view can show as a list, a matrix of urgent and important, or a timeline; lists can also be a board.</p>
        <Tip>
          <Kbd>G M</Kbd> switches the view you're in to the matrix. Turn on Completed to see what's finished.
        </Tip>
      </>
    ),
  },
  {
    title: "Habits and focus",
    target: "main",
    view: "habits",
    body: (
      <>
        <p>Check in your habits each day, and run a focus timer on a task. A perfect day is everything due done and every daily habit kept.</p>
        <Tip>
          <Kbd>Ctrl Alt M</Kbd> keeps the timer and your next tasks on top while you work elsewhere.
        </Tip>
      </>
    ),
  },
  {
    title: "Progress, and finding anything",
    target: "search",
    view: "progress",
    body: (
      <>
        <p>Progress shows your week, your streaks and the trophies you've earned. When you're not sure how to do something, search for it.</p>
        <Tip>
          <Kbd>Ctrl K</Kbd> finds any task or command. Settings → Help lists every shortcut and token.
        </Tip>
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
  const version = useAppVersion();
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
    const { settings, update } = useSettings.getState();
    // A new install has seen everything up to now, so nothing shows as "New:" until the next update.
    const gs = settings.gettingStarted;
    update({ onboarded: true, gettingStarted: gs.seenVersion || !version ? gs : { ...gs, seenVersion: version } });
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
