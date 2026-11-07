import { CalendarCheck, CheckCheck, Flame, Lock, Sun, Timer, type LucideIcon } from "lucide-react";
import { useId, useMemo } from "react";
import { levelOf, TROPHIES, type TrophyId } from "../../domain/perfect";
import { currentTrophyCounts } from "../../lib/celebrate";
import { useData } from "../../stores/data";
import { useFocus } from "../../stores/focus";
import { useHabits } from "../../stores/habits";
import { useProgress } from "../../stores/progress";
import { LEVEL_LOOKS } from "./trophyLooks";

const ICON: Record<TrophyId, LucideIcon> = { tasks: CheckCheck, focus: Timer, habit: Flame, days: Sun, weeks: CalendarCheck };

/** A level's badge: its shape in its material, with the trophy's icon on top. `level` 0 is the locked placeholder. */
function Badge({ level, icon: Icon, size }: { level: number; icon: LucideIcon; size: number }) {
  const id = useId();
  const look = level > 0 ? LEVEL_LOOKS[level - 1] : null;
  return (
    <span className="relative inline-grid shrink-0 place-items-center" style={{ width: size, height: size }}>
      <svg viewBox="0 0 48 48" width={size} height={size} aria-hidden className={look ? "drop-shadow-sm" : undefined}>
        {look && (
          <defs>
            <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor={look.from} />
              {look.mid && <stop offset="0.5" stopColor={look.mid} />}
              <stop offset="1" stopColor={look.to} />
            </linearGradient>
          </defs>
        )}
        <path d={look?.path ?? LEVEL_LOOKS[0].path} fill={look ? `url(#${id})` : "var(--surface-2)"} stroke={look ? "rgb(255 255 255 / 0.55)" : "var(--border)"} strokeWidth="1.5" strokeLinejoin="round" />
      </svg>
      {size >= 28 && (look ? <Icon size={size * 0.38} className="absolute" style={{ color: look.ink }} strokeWidth={2.5} /> : <Lock size={size * 0.34} className="absolute text-muted" />)}
    </span>
  );
}

/** Statistics → Trophies: one card per ladder with the current level, progress to the next and every level's badge (D86). */
export function TrophyShelf() {
  const tasks = useData((s) => s.tasks);
  const checkins = useHabits((s) => s.checkins);
  const sessions = useFocus((s) => s.sessions);
  const restDays = useProgress((s) => s.restDays);
  // The inputs are read from the stores inside; these references say when to recompute.
  const counts = useMemo(() => currentTrophyCounts(), [tasks, checkins, sessions, restDays]);
  return (
    <ul className="grid grid-cols-[repeat(auto-fill,minmax(13rem,1fr))] gap-3">
      {TROPHIES.map((t) => {
        const count = counts[t.id];
        const level = levelOf(t, count);
        const top = level === t.levels.length;
        const prev = level > 0 ? t.levels[level - 1] : 0;
        const next = top ? prev : t.levels[level];
        const pct = top ? 100 : Math.min(100, ((count - prev) / (next - prev)) * 100);
        const shown = Math.floor(count);
        return (
          <li key={t.id} className="flex flex-col gap-2.5 rounded-card border border-border p-3">
            <div className="flex items-center gap-3">
              <Badge level={level} icon={ICON[t.id]} size={44} />
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{t.name}</p>
                <p className="text-xs text-muted">{level ? `${LEVEL_LOOKS[level - 1].name} · level ${level}` : "Not started"}</p>
              </div>
            </div>
            <div>
              <div className="h-1.5 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-label={`${t.name} progress`} aria-valuenow={shown} aria-valuemin={prev} aria-valuemax={next}>
                <div className="h-full rounded-full bg-accent transition-[width] duration-[var(--dur)]" style={{ width: `${pct}%` }} />
              </div>
              <p className="mt-1 tabular-nums text-[0.7rem] text-muted">{top ? `${shown} ${t.unit} · top level` : `${shown} / ${next} ${t.unit}`}</p>
            </div>
            <div className="flex flex-wrap gap-1" aria-label="Levels">
              {t.levels.map((l, i) => (
                <span key={l} title={`${LEVEL_LOOKS[i].name}: ${l} ${t.unit}`} className={i < level ? undefined : "opacity-35 grayscale"}>
                  <Badge level={i + 1} icon={ICON[t.id]} size={16} />
                </span>
              ))}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
