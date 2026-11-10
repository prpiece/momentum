import {
  CalendarCheck,
  CheckCheck,
  Flame,
  Lock,
  Sun,
  Timer,
  type LucideIcon,
} from "lucide-react";
import { type CSSProperties, useMemo } from "react";
import { levelOf, TROPHIES, type TrophyId } from "../../domain/perfect";
import { currentTrophyCounts } from "../../lib/celebrate";
import { useData } from "../../stores/data";
import { useFocus } from "../../stores/focus";
import { useHabits } from "../../stores/habits";
import { useProgress } from "../../stores/progress";
import { LEVEL_LOOKS } from "./trophyLooks";

const ICON: Record<TrophyId, LucideIcon> = {
  tasks: CheckCheck,
  focus: Timer,
  habit: Flame,
  days: Sun,
  weeks: CalendarCheck,
};

/** A level's medal (D198): a flat circle ringed in its metal, the trophy's icon, and the level number. `level` 0 is the locked placeholder. */
function Medal({
  level,
  icon: Icon,
  size,
}: {
  level: number;
  icon: LucideIcon;
  size: number;
}) {
  const look = level > 0 ? LEVEL_LOOKS[level - 1] : null;
  const m = look?.metal ?? "var(--border-strong)";
  return (
    <span
      className={`relative grid shrink-0 place-items-center rounded-full border-[2.5px] ${look ? "" : "border-dashed text-muted"}`}
      style={{
        width: size,
        height: size,
        borderColor: m,
        background: look
          ? `color-mix(in srgb, ${m} 16%, var(--surface))`
          : "var(--surface)",
        color: look ? m : undefined,
      }}
    >
      {look ? (
        <Icon size={size * 0.4} strokeWidth={1.75} />
      ) : (
        <Lock size={size * 0.34} strokeWidth={1.75} />
      )}
      {look && (
        <span
          className="absolute -bottom-1 -right-1 grid size-[22px] place-items-center rounded-full border-2 border-surface text-[11px] font-bold tabular-nums"
          style={{ background: m, color: "var(--on-strong)" }}
        >
          {level}
        </span>
      )}
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
  const counts = useMemo(
    () => currentTrophyCounts(),
    [tasks, checkins, sessions, restDays],
  );
  return (
    // Wrapping row whose last line stretches to fill: five trophies never leave an empty slot (D218).
    <ul className="flex flex-wrap gap-3">
      {TROPHIES.map((t) => {
        const count = counts[t.id];
        const level = levelOf(t, count);
        const top = level === t.levels.length;
        const prev = level > 0 ? t.levels[level - 1] : 0;
        const next = top ? prev : t.levels[level];
        const pct = top
          ? 100
          : Math.min(100, ((count - prev) / (next - prev)) * 100);
        const shown = Math.floor(count);
        return (
          <li
            key={t.id}
            className="flex flex-[1_1_10.5rem] flex-col gap-2.5 rounded-card border border-border bg-surface p-3"
          >
            <div className="flex items-center gap-3">
              <Medal level={level} icon={ICON[t.id]} size={48} />
              <div className="min-w-0">
                <p className="truncate text-[length:var(--fs-sm)] font-semibold">
                  {t.name}
                </p>
                <p className="text-[length:var(--fs-xs)] text-muted">
                  {level
                    ? `${LEVEL_LOOKS[level - 1].name} · level ${level}`
                    : "Not started"}
                </p>
              </div>
            </div>
            <div>
              <div
                className="bar"
                role="progressbar"
                aria-label={`${t.name} progress`}
                aria-valuenow={shown}
                aria-valuemin={prev}
                aria-valuemax={next}
              >
                <span
                  style={
                    {
                      width: `${pct}%`,
                      ...(level ? { "--c": LEVEL_LOOKS[level - 1].metal } : {}),
                    } as CSSProperties
                  }
                />
              </div>
              <p className="mt-1 tabular-nums text-[length:var(--fs-xs)] text-muted">
                {top
                  ? `${shown} ${t.unit} · top level`
                  : `${shown} / ${next} ${t.unit}`}
              </p>
            </div>
            <div className="flex flex-wrap gap-1" aria-label="Levels">
              {t.levels.map((l, i) => (
                <span
                  key={l}
                  title={`${LEVEL_LOOKS[i].name}: ${l} ${t.unit}`}
                  className="h-1 w-3 rounded-[2px]"
                  style={
                    i < level
                      ? { background: LEVEL_LOOKS[i].metal }
                      : i === level
                        ? {
                            boxShadow: `inset 0 0 0 1px ${LEVEL_LOOKS[i].metal}`,
                          }
                        : { background: "var(--surface-2)" }
                  }
                />
              ))}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
