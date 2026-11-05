import { addDaysLocal, toLocalDate } from "./dates";
import type { FocusSession } from "./focus";
import { levelOf, TROPHIES, weekStartOf, type TrophyCounts } from "./perfect";
import { completedPerDay, dayStreaks, type Bucket } from "./stats";
import type { LocalDate, Task, WeekStart } from "./types";

export type SharePeriod = "week" | "month";

export type ShareSummary = {
  period: SharePeriod;
  from: LocalDate;
  /** One bar per day of the period (days after today are 0). */
  bars: Bucket[];
  tasks: number;
  focusHours: number;
  /** Days in a row with a completion, ending today (or yesterday). */
  streak: number;
  perfectDays: number;
  /** The highest trophy level reached on any ladder (0 = none yet). */
  top: { id: (typeof TROPHIES)[number]["id"]; level: number } | null;
};

/** Everything on the share card: aggregates only, never task or list names (D93). */
export function shareSummary(
  tasks: readonly Task[],
  sessions: readonly FocusSession[],
  today: LocalDate,
  period: SharePeriod,
  ws: WeekStart,
  isPerfect: (d: LocalDate) => boolean,
  counts: TrophyCounts,
): ShareSummary {
  const n = period === "week" ? 7 : 30;
  const from = period === "week" ? weekStartOf(today, ws) : addDaysLocal(today, 1 - n);
  const perDay = completedPerDay(tasks, today, 400);
  const done = new Map(perDay.map((b) => [b.start, b.value]));
  const bars = Array.from({ length: n }, (_, i): Bucket => {
    const d = addDaysLocal(from, i);
    return { start: d, label: d, value: d > today ? 0 : (done.get(d) ?? 0) };
  });
  let seconds = 0;
  for (const s of sessions) {
    const d = toLocalDate(new Date(s.startAt));
    if (d >= from && d <= today) seconds += s.seconds;
  }
  let perfectDays = 0;
  for (const b of bars) if (b.start <= today && isPerfect(b.start)) perfectDays++;
  let top: ShareSummary["top"] = null;
  for (const t of TROPHIES) {
    const level = levelOf(t, counts[t.id]);
    if (level > (top?.level ?? 0)) top = { id: t.id, level };
  }
  return {
    period,
    from,
    bars,
    tasks: bars.reduce((a, b) => a + b.value, 0),
    focusHours: seconds / 3600,
    streak: dayStreaks(perDay).current,
    perfectDays,
    top,
  };
}
