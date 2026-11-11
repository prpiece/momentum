/*
 * What plays when you finish something (D63, D64): a sound for every task and check-in, and a
 * celebration for the big moments (perfect day/week/month/year, habit streak milestones, the
 * long break, trophies). Each big moment plays once: its key goes into the celebrations table.
 */
import { create } from "zustand";
import { addDaysLocal, todayLocal } from "../domain/dates";
import { bestStreak, currentStreak, isBuild, isDone, type Habit } from "../domain/habits";
import { bestDayRun, countsForProgress, dayOf, dayRun, levelOf, perfectDays, prepare, STREAK_MILESTONES, tierOfRun, TROPHIES, trophyCounts, weekQualifies, weekRun, weekStartOf, type Tier, type TrophyCounts } from "../domain/perfect";
import { LEVEL_LOOKS } from "../features/celebrate/trophyLooks";
import type { LocalDate, SoundEvent } from "../domain/types";
import { derive } from "../domain/taskViews";
import { useData } from "../stores/data";
import { useFocus } from "../stores/focus";
import { useHabits, valuesOf } from "../stores/habits";
import { markCelebrated, useProgress } from "../stores/progress";
import { useSettings } from "../stores/settings";
import { toast } from "../stores/ui";
import { playEvent } from "./sounds";

export type Celebration = { id: number; tier: Tier; title: string; detail: string };
export const useCelebration = create<{ current: Celebration | null }>(() => ({ current: null }));
export const dismissCelebration = () => useCelebration.setState({ current: null });

/** Settings → Animations, or the OS setting while it's on "System". */
export function motionOn(): boolean {
  const m = useSettings.getState().settings.motion;
  return m === "on" || (m === "system" && !window.matchMedia("(prefers-reduced-motion: reduce)").matches);
}

let nextId = 1;
function celebrate(tier: Tier, title: string, detail: string, sound: SoundEvent) {
  playEvent(sound, tier === "day" ? 1 : 2);
  // Hidden in the tray or minimized: the sound is enough (the OS notification says what happened).
  if (document.hidden) return;
  if (!motionOn()) return toast(detail ? `${title} · ${detail}` : title);
  useCelebration.setState({ current: { id: nextId++, tier, title, detail } });
}

/** Everything perfect days need, from the stores. Covers a little over a year of weeks. */
const HISTORY_DAYS = 430;
function prepared(today = todayLocal()) {
  const { tasks, lists } = useData.getState();
  const { habits, checkins } = useHabits.getState();
  const { restDays, pushes } = useProgress.getState();
  const input = {
    tasks: derive(tasks, lists).roots.map((v) => v.task),
    habits: Object.values(habits),
    checkins: (id: string) => valuesOf(checkins[id]),
    restDays,
    pushes,
    weekStart: useSettings.getState().settings.weekStart,
    today,
  };
  const from = addDaysLocal(today, -HISTORY_DAYS);
  return { p: prepare(input, from), from };
}

const TIER_TITLE: Record<Tier, string> = { day: "Perfect day!", week: "Perfect week!", month: "Perfect month!", year: "Perfect year!" };

/** Today just became perfect: a day, or on the week's last day a week, month or year. */
function checkToday() {
  const today = todayLocal();
  const { p } = prepared(today);
  if (dayOf(p, today).kind !== "perfect") return;
  const ws = weekStartOf(today, p.input.weekStart);
  const lastDay = addDaysLocal(ws, 6) === today;
  if (lastDay && weekQualifies(p, ws)) {
    if (!markCelebrated([`day:${today}`, `week:${ws}`]).includes(`week:${ws}`)) return;
    const run = weekRun(p, ws);
    const tier = tierOfRun(run);
    return celebrate(tier, TIER_TITLE[tier], run > 1 ? `${run} perfect weeks in a row` : "Every day, done and dusted", "dayDone");
  }
  if (!markCelebrated([`day:${today}`]).length) return;
  const run = dayRun(p);
  celebrate("day", TIER_TITLE.day, run > 1 ? `${run} perfect days in a row` : "Everything due today is done", "dayDone");
}

/** A week that ended without a perfect last day still counts: celebrate it on the next visit. */
export function checkLastWeek() {
  const today = todayLocal();
  const { p } = prepared(today);
  const last = addDaysLocal(weekStartOf(today, p.input.weekStart), -7);
  if (useProgress.getState().celebrated.has(`week:${last}`) || !weekQualifies(p, last)) return;
  markCelebrated([`week:${last}`]);
  const run = weekRun(p, last);
  const tier = tierOfRun(run);
  celebrate(tier, `Last week: ${TIER_TITLE[tier].toLowerCase()}`, run > 1 ? `${run} perfect weeks in a row` : "You had a very good week", "dayDone");
}

/** Each new trophy level gets a celebration; levels already reached when the ladders first load are recorded silently (D86). */
export function checkTrophies() {
  const counts = currentTrophyCounts();
  const keys = TROPHIES.flatMap((t) => t.levels.slice(0, levelOf(t, counts[t.id])).map((_, i) => `trophy:${t.id}:${i + 1}`));
  const first = !useProgress.getState().celebrated.has("init:ladders");
  const fresh = markCelebrated(first ? [...keys, "init:ladders"] : keys).filter((k) => k.startsWith("trophy:"));
  if (first || !fresh.length) return;
  const names = fresh
    .map((k) => {
      const [, id, lvl] = k.split(":");
      const t = TROPHIES.find((x) => x.id === id);
      return t ? `${LEVEL_LOOKS[Number(lvl) - 1].name} · ${t.levels[Number(lvl) - 1]} ${t.name.toLowerCase()}` : "";
    })
    .join(" · ");
  // Usually a trophy arrives with its own perfect-day celebration: add it to that one.
  const cur = useCelebration.getState().current;
  if (cur) useCelebration.setState({ current: { ...cur, detail: `${cur.detail}\nTrophy: ${names}` } });
  else celebrate("day", "Trophy unlocked!", names, "streak");
}

export function allTime(today: LocalDate) {
  const tasks = Object.values(useData.getState().tasks);
  const { habits, checkins } = useHabits.getState();
  const ws = useSettings.getState().settings.weekStart;
  return {
    doneTasks: tasks.filter((t) => !t.deletedAt && t.status === "done" && countsForProgress(t)).length,
    focusMinutes: Object.values(useFocus.getState().sessions).reduce((n, s) => n + s.seconds / 60, 0),
    bestHabitDays: Math.max(0, ...Object.values(habits).map((h) => ((s) => (s.unit === "day" ? s.count : 0))(bestStreak(h, valuesOf(checkins[h.id]), today, ws)))),
  };
}

/** Perfect days in a row, for the Today flame. */
export const perfectRun = () => dayRun(prepared().p);

/** Progress → This week and Streaks: the current and best perfect-day runs, and this week's perfect days. */
export function perfectSummary() {
  const { p, from } = prepared();
  const ws = weekStartOf(p.input.today, p.input.weekStart);
  return { run: dayRun(p), best: bestDayRun(p, from), thisWeek: perfectDays(p, ws, p.input.today) };
}

/** What each trophy ladder measures right now, for the shelf and level checks. */
export function currentTrophyCounts(): TrophyCounts {
  const today = todayLocal();
  const { p, from } = prepared(today);
  return trophyCounts(p, from, allTime(today));
}

/** Perfect-day lookup and trophy counts for the share card. */
export function shareInputs() {
  const today = todayLocal();
  const { p, from } = prepared(today);
  return { isPerfect: (d: LocalDate) => dayOf(p, d).kind === "perfect", counts: trophyCounts(p, from, allTime(today)) };
}

let lastTaskSound = 0;
/** A task was completed (from anywhere: row, keyboard, reminder popup). */
export function onTaskDone() {
  // Completing several at once plays one sound, not a chord.
  if (Date.now() - lastTaskSound > 150) playEvent("task");
  lastTaskSound = Date.now();
  queueCheck();
}

/** A habit check-in went up. */
export function onCheckin(h: Habit, date: LocalDate, before: number, after: number) {
  if (!isBuild(h)) return; // logging a slip or time against a limit isn't a win
  playEvent("habit");
  const today = todayLocal();
  if (date === today && !isDone(h, before) && isDone(h, after)) {
    const { checkins } = useHabits.getState();
    const s = currentStreak(h, valuesOf(checkins[h.id]), today, useSettings.getState().settings.weekStart);
    const hit = STREAK_MILESTONES.find((m) => m === s.count);
    if (s.unit === "day" && hit && markCelebrated([`streak:${h.id}:${hit}:${today}`]).length) celebrate("day", `${hit}-day streak!`, h.name, "streak");
  }
  queueCheck();
}

/** Reaching the long break in the focus timer. */
export const onLongBreak = () => celebrate("day", "Long break earned!", "A full set of focus rounds. Stretch, breathe, hydrate.", "longBreak");

/** Big moments wait this long and are re-checked, so ticking a task and undoing it right away earns nothing. */
export const CELEBRATE_GRACE_MS = 5000;

// Runs once, CELEBRATE_GRACE_MS after the last completion in a burst. Every check recomputes from the
// stores and only then persists (markCelebrated), so an undo in the window cancels the moment.
let pending: ReturnType<typeof setTimeout> | undefined;
function queueCheck() {
  clearTimeout(pending);
  pending = setTimeout(() => {
    if (!useProgress.getState().ready) return;
    checkToday();
    checkLastWeek();
    checkTrophies();
  }, CELEBRATE_GRACE_MS);
}
