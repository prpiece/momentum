import { ArrowLeft, ArrowRight, Check, Lightbulb, X } from "lucide-react";
import { type CSSProperties, type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Logo } from "../../components/Logo";
import { Keys } from "../../components/ui/Keys";
import { FEATURES } from "../../domain/features";
import type { ViewId } from "../../domain/types";
import { useSettings } from "../../stores/settings";
import { useAppVersion } from "../../lib/updater";
import { go, useUi } from "../../stores/ui";
import { lockScroll } from "../../lib/scrollLock";

const Kbd = ({ children }: { children: string }) => <Keys keys={children} />;
const Token = ({ children }: { children: ReactNode }) => <code className="token">{children}</code>;
const Tip = ({ children }: { children: ReactNode }) => (
  <p className="flex gap-2 rounded-control bg-surface-2 px-2.5 py-2 text-[length:var(--fs-sm)] text-fg-2">
    <Lightbulb size={16} strokeWidth={1.75} className="shrink-0 text-accent-text" aria-hidden />
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

/** A feature's one-line how-to from the registry, so the tour and Help say the same thing. */
const how = (id: string) => FEATURES.find((f) => f.id === id)?.howTo ?? "";

/** What a token does, for the quick-add step. */
const Tokens = ({ rows }: { rows: [token: string, what: string][] }) => (
  <dl className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1.5 text-[length:var(--fs-sm)]">
    {rows.map(([t, what]) => (
      <div key={t} className="contents">
        <dt>
          <Token>{t}</Token>
        </dt>
        <dd>{what}</dd>
      </div>
    ))}
  </dl>
);

/**
 * The tour (D69, D178, D269): ten short steps. Each says what the part does and why it helps; shortcuts
 * come last, as a hint, because not everyone uses them. The how-to lines come from the feature registry.
 */
const STEPS: Step[] = [
  {
    title: "Welcome to Momentum",
    target: "main",
    view: "home",
    body: (
      <>
        <p>This is Home. {how("home")}</p>
        <p>Start here each day for a quick look at what matters, then jump to any section from the tiles, or from the navigation on the side.</p>
        <Tip>
          <Kbd>G O</Kbd> comes back to Home from anywhere.
        </Tip>
      </>
    ),
  },
  {
    title: "Capture anything instantly",
    target: "quickadd",
    view: "today",
    interactive: true,
    body: (
      <>
        <p>Type what is on your mind and press Enter. Add details in plain words and Momentum picks them out, so you never have to click through forms. Try one now.</p>
        <Tokens
          rows={[
            ["tomorrow 5pm", "sets the date and time"],
            ["every mon", "repeats it"],
            ["!high", "sets the priority"],
            ["#school", "adds a tag"],
            ["~Work", "files it in a list"],
          ]}
        />
        <Tip>
          Press <Kbd>N</Kbd> in the app, or <Kbd>Ctrl Shift A</Kbd> from any other app (change it in Settings).
        </Tip>
      </>
    ),
  },
  {
    title: "Lists and folders",
    target: "lists",
    view: "today",
    body: (
      <>
        <p>
          {how("lists")} Drag a list to reorder it or drop it on a folder to file it. Right-click for Move up and Move down, rename, colour or archive.
        </p>
        <p>Keeping work, school and home apart means each list stays short and easy to scan.</p>
        <Tip>Use the + beside Lists to add one, and the folder button to group them.</Tip>
      </>
    ),
  },
  {
    title: "Today and Upcoming",
    target: "nav",
    view: "today",
    body: (
      <>
        <p>{how("smart-views")}</p>
        <p>You decide the day once, then open Today and just work down it. Anything you did not finish stays there, marked overdue, until you handle it.</p>
        <Tip>
          <Kbd>G I</Kbd>, <Kbd>G T</Kbd> and <Kbd>G U</Kbd> jump to Inbox, Today and Upcoming.
        </Tip>
      </>
    ),
  },
  {
    title: "Plan your time on the calendar",
    target: "main",
    view: "calendar",
    body: (
      <>
        <p>{how("calendar")} Dropping a task on a time slot blocks out time for it.</p>
        <p>Seeing tasks next to events shows how much really fits in a day, so your plan stays realistic.</p>
        <Tip>
          <Kbd>G C</Kbd> opens the calendar; <Kbd>D</Kbd>, <Kbd>W</Kbd> and <Kbd>M</Kbd> switch between day, week and month.
        </Tip>
      </>
    ),
  },
  {
    title: "Build habits",
    target: "main",
    view: "habits",
    body: (
      <>
        <p>{how("habits")}</p>
        <p>Small things done every day add up. Streaks make the chain visible, so it is easy to see what you want to keep going.</p>
        <Tip>
          <Kbd>G H</Kbd> opens Habits. Today lists the habits due, so you can check them off there too.
        </Tip>
      </>
    ),
  },
  {
    title: "Focus with a timer",
    target: "main",
    view: "focus",
    body: (
      <>
        <p>{how("focus")}</p>
        <p>Short, timed stretches with breaks in between keep your attention on one thing, and every session is logged in Progress.</p>
        <Tip>
          <Kbd>Ctrl Alt M</Kbd> keeps the timer and your next tasks on top while you work in other apps. You can change the key in Settings.
        </Tip>
      </>
    ),
  },
  {
    title: "Urgent or important?",
    target: "toolbar",
    view: "today",
    body: (
      <>
        <p>{how("matrix-mode")}</p>
        <p>When everything feels like a priority, the four quadrants show what to do now, what to schedule, what to hand off and what to drop. Board and Timeline are in the same menu.</p>
        <Tip>
          <Kbd>G M</Kbd> turns the view you are in into the matrix.
        </Tip>
      </>
    ),
  },
  {
    title: "Share and plan with friends",
    target: "main",
    view: "friends",
    body: (
      <>
        <p>{how("sharing")}</p>
        <p>Shared lists work well for a group project or a household. Friends see nothing of yours unless you share it, and you can also send a single task. Friends needs a free account, which also syncs your devices.</p>
      </>
    ),
  },
  {
    title: "Find anything, do anything",
    target: "search",
    view: "home",
    body: (
      <>
        <p>{how("palette")} You can also type a command such as “Dark theme” or “New list”.</p>
        <p>Settings → Help lists every feature, with its shortcut where it has one, and you can retake this tour from there.</p>
        <Tip>
          <Kbd>Ctrl K</Kbd> opens search from anywhere. <Kbd>?</Kbd> lists all shortcuts.
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

  // The page behind stays put while the tour is up.
  useEffect(() => (open ? lockScroll() : undefined), [open]);

  // Remember where you were, to come back to it at the end.
  useEffect(() => {
    if (open) startView.current = useUi.getState().view;
  }, [open]);

  // Open the step's view, then follow its target as the page settles, scrolls or resizes.
  useEffect(() => {
    if (!open) return;
    if (step.view) go(step.view);
    let prev = "";
    const run = () => {
      const b = measure(step.target);
      const key = JSON.stringify(b);
      if (key !== prev) {
        prev = key;
        setBox(b);
      }
    };
    // Re-measure on events, not every frame: window resize, any scroll, the target changing size,
    // layout animations ending, and a few times while the new view mounts.
    const ro = new ResizeObserver(run);
    const watch = step.target && document.querySelector(step.target === "main" ? "main" : `[data-tour="${step.target}"]`);
    if (watch) ro.observe(watch);
    document.body && ro.observe(document.body);
    const settle = [0, 60, 150, 300, 600, 1200].map((ms) => window.setTimeout(run, ms));
    window.addEventListener("resize", run);
    window.addEventListener("scroll", run, true);
    window.addEventListener("transitionend", run, true);
    window.addEventListener("animationend", run, true);
    run();
    return () => {
      ro.disconnect();
      settle.forEach(clearTimeout);
      window.removeEventListener("resize", run);
      window.removeEventListener("scroll", run, true);
      window.removeEventListener("transitionend", run, true);
      window.removeEventListener("animationend", run, true);
    };
  }, [open, step]);

  useLayoutEffect(() => {
    if (card.current) setCardH(card.current.offsetHeight);
  }, [i, open, box]);

  // Focus the card so the keys work, except where the step invites typing in the app.
  useEffect(() => {
    if (open && !step.interactive) card.current?.querySelector<HTMLElement>("[data-primary]")?.focus();
  }, [open, step]);

  // Keys drive the tour wherever focus is (step 1 leaves it in the app's quick-add) (UI-12).
  const keyRef = useRef<(e: KeyboardEvent) => void>(undefined);
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => keyRef.current?.(e);
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open]);

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
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") return close();
    // Tab stays in the card (aria-modal) except on steps that invite using the app behind the dim.
    if (e.key === "Tab" && !step.interactive && card.current) {
      const items = [...card.current.querySelectorAll<HTMLElement>("button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex='-1'])")];
      const at = items.indexOf(document.activeElement as HTMLElement);
      const next = items[(at + (e.shiftKey ? -1 : 1) + items.length) % items.length];
      if (items.length) {
        e.preventDefault();
        (at < 0 && e.shiftKey ? items[items.length - 1] : next).focus();
      }
      return;
    }
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    if (e.key === "ArrowRight") to(i + 1);
    if (e.key === "ArrowLeft") to(i - 1);
  };
  keyRef.current = onKey;
  const ring: CSSProperties = box
    ? { top: box.top, left: box.left, width: box.width, height: box.height }
    : { top: window.innerHeight / 2, left: window.innerWidth / 2, width: 0, height: 0 };

  return (
    <div className="pointer-events-none fixed inset-0 z-[60]">
      {/* Blocks clicks outside the spotlight (and inside it unless the step is interactive). */}
      <div className="pointer-events-auto absolute inset-0" style={step.interactive && box ? { clipPath: holePath(box) } : undefined} onPointerDown={(e) => e.preventDefault()} />
      {/* The dim with a soft-edged hole, which glides from target to target. */}
      <div
        className="tour-ring pointer-events-none absolute rounded-card"
        style={{ ...ring, boxShadow: box ? "0 0 0 8px var(--surface), 0 0 0 9999px var(--scrim)" : "0 0 0 9999px var(--scrim)" }}
      />
      <div
        ref={card}
        key={i}
        role="dialog"
        aria-modal="true"
        aria-label={step.title}
        className="layer layer-raised tour-card anim-rise pointer-events-auto absolute flex flex-col gap-3 rounded-panel p-5"
        style={{ width: CARD_W, ...place(box, cardH) }}
      >
        <div className="flex items-start gap-3">
          {i === 0 && <Logo size={36} />}
          <div className="min-w-0 flex-1">
            <div className="t-label text-muted">{i === 0 ? "Quick tour" : `${i} of ${last}`}</div>
            <h2 className="text-[length:var(--fs-lg)] font-semibold leading-[var(--lh-lg)]">{step.title}</h2>
          </div>
          <button type="button" onClick={close} aria-label="Skip the tour" title="Skip the tour" className="-mr-1.5 -mt-1 btn btn-ghost btn-sm icon-btn text-muted">
            <X size={16} strokeWidth={1.75} />
          </button>
        </div>
        <div className="space-y-2.5 text-fg-2">{step.body}</div>
        {/* Step dots, as in the mock. */}
        <div className="mt-1 flex gap-1.5" aria-hidden>
          {Array.from({ length: last + 1 }, (_, n) => (
            <span key={n} className={`size-1.5 rounded-full ${n <= i ? "bg-accent" : "bg-border-strong"}`} />
          ))}
        </div>
        <div className="flex items-center gap-2">
          {i === 0 ? (
            <button type="button" onClick={close} className="btn btn-ghost">
              Skip tour
            </button>
          ) : (
            <button type="button" onClick={() => to(i - 1)} className="btn btn-ghost">
              <ArrowLeft size={16} strokeWidth={1.75} /> Back
            </button>
          )}
          <div className="flex-1" />
          <button
            type="button"
            data-primary
            onClick={() => (i < last ? to(i + 1) : close())}
            className="btn btn-primary"
          >
            {i === 0 ? (
              <>
                Show me around <ArrowRight size={16} strokeWidth={1.75} />
              </>
            ) : i < last ? (
              <>
                Next <ArrowRight size={16} strokeWidth={1.75} />
              </>
            ) : (
              <>
                <Check size={16} strokeWidth={1.75} /> Start planning
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
