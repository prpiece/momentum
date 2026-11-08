import confetti from "canvas-confetti";
import { useEffect } from "react";
import { Logo } from "../../components/Logo";
import type { Tier } from "../../domain/perfect";
import { dismissCelebration, useCelebration } from "../../lib/celebrate";

const GOLD = ["#f5c542", "#ffd970", "#e8a317", "#fff3c4"];
const MS: Record<Tier, number> = { day: 2600, week: 4000, month: 5200, year: 7000 };

function accentColors(): string[] {
  const a = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#2f6fed";
  return [a, "#ffffff", a, "#9ec5ff"];
}

/** Fires the confetti for a tier: a burst, side cannons, then fireworks for months and years. */
function launch(tier: Tier): () => void {
  const colors = tier === "month" || tier === "year" ? [...GOLD, ...accentColors()] : accentColors();
  // celebrate() already checked Settings → Animations, which can override the OS setting.
  const base = { colors, zIndex: 70 };
  const timers: number[] = [];
  if (tier === "day") void confetti({ ...base, particleCount: 90, spread: 80, startVelocity: 38, origin: { y: 0.55 } });
  else
    for (let i = 0; i < 3; i++)
      timers.push(
        window.setTimeout(() => {
          void confetti({ ...base, particleCount: 70, angle: 60, spread: 60, startVelocity: 55, origin: { x: 0, y: 0.7 } });
          void confetti({ ...base, particleCount: 70, angle: 120, spread: 60, startVelocity: 55, origin: { x: 1, y: 0.7 } });
        }, i * 250),
      );
  if (tier === "month" || tier === "year") {
    const until = Date.now() + (tier === "year" ? 4500 : 2200);
    const firework = () => {
      if (Date.now() > until) return;
      void confetti({ ...base, particleCount: 50, spread: 360, startVelocity: 26, ticks: 70, gravity: 0.6, origin: { x: 0.15 + Math.random() * 0.7, y: 0.15 + Math.random() * 0.35 } });
      timers.push(window.setTimeout(firework, 320));
    };
    timers.push(window.setTimeout(firework, 700));
  }
  return () => timers.forEach(clearTimeout);
}

/** Dots that pop out of the logo in a ring. */
const DOTS = Array.from({ length: 12 }, (_, i) => {
  const a = (i / 12) * Math.PI * 2;
  const r = 78 + (i % 3) * 14;
  return { dx: `${Math.round(Math.cos(a) * r)}px`, dy: `${Math.round(Math.sin(a) * r)}px`, delay: 120 + (i % 4) * 40 };
});

/** The big-moment celebration (D63): the logo jumps in with bursting rings and popping dots, plus confetti. */
export function CelebrationOverlay() {
  const c = useCelebration((s) => s.current);

  useEffect(() => {
    if (!c) return;
    const stop = launch(c.tier);
    const done = window.setTimeout(dismissCelebration, MS[c.tier]);
    // Any click or Escape dismisses; typing carries on underneath.
    const onPointer = () => dismissCelebration();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && dismissCelebration();
    window.addEventListener("pointerdown", onPointer);
    window.addEventListener("keydown", onKey);
    return () => {
      stop();
      clearTimeout(done);
      window.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("keydown", onKey);
    };
  }, [c]);

  if (!c) return null;
  const gold = c.tier === "month" || c.tier === "year";
  const big = c.tier !== "day";
  const ring = gold ? "#e8a317" : "var(--accent)";
  return (
    <div
      key={c.id}
      role="status"
      aria-live="polite"
      className={`anim-fade pointer-events-none fixed inset-0 z-50 grid place-items-center ${big ? "bg-[var(--scrim)]" : ""}`}
    >
      <div className="flex flex-col items-center gap-5">
        <div className="relative grid size-40 place-items-center">
          {[0, 140, 280].map((d) => (
            <span key={d} className="anim-ring-burst absolute inset-6 rounded-full border-[3px]" style={{ borderColor: ring, animationDelay: `${d}ms` }} />
          ))}
          {DOTS.map((p, i) => (
            <span
              key={i}
              className="anim-pop-out absolute left-1/2 top-1/2 -ml-1.5 -mt-1.5 size-3 rounded-full"
              style={{ background: i % 2 ? GOLD[i % 4] : "var(--accent)", ["--dx" as string]: p.dx, ["--dy" as string]: p.dy, animationDelay: `${p.delay}ms` }}
            />
          ))}
          <div className={big ? "anim-hero-spin" : "anim-hero-bob"}>
            <Logo size={c.tier === "year" ? 112 : 92} draw className="anim-hero" />
          </div>
        </div>
        <div className="layer layer-raised anim-card rounded-panel px-7 py-4 text-center">
          <div className={`font-[family-name:var(--font-head)] text-[length:var(--fs-xl)] font-semibold leading-[var(--lh-xl)] ${gold ? "text-streak" : ""}`}>{c.title}</div>
          {c.detail && <div className="mt-1 whitespace-pre-line text-[length:var(--fs-sm)] text-fg-2">{c.detail}</div>}
        </div>
      </div>
    </div>
  );
}
