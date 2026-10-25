/* Countdown and focus-session row mapping (pure; shared by the stores and backup import). */
import { COUNTDOWN_REPEATS, type Countdown } from "../domain/countdown";
import { isInstant, isLocalDate } from "../domain/dates";
import type { FocusSession } from "../domain/focus";
import { oneOf } from "../domain/settings";
import type { Row } from "./rows";

export const parseCountdown = (r: Row): Countdown | null =>
  typeof r.id === "string" && typeof r.title === "string" && isLocalDate(r.date)
    ? {
        id: r.id,
        title: r.title,
        date: r.date,
        direction: r.direction === "since" ? "since" : "until",
        repeat: oneOf(COUNTDOWN_REPEATS, r.repeat) ? r.repeat : "none",
        emoji: typeof r.emoji === "string" && r.emoji ? r.emoji : "⏳",
        color: typeof r.color === "string" && /^#[0-9a-f]{6}$/i.test(r.color) ? r.color : "#5b5bd6",
        pinned: r.pinned === 1,
        createdAt: isInstant(r.created_at) ? r.created_at : new Date().toISOString(),
      }
    : null;

export const countdownRow = (c: Countdown): Row => ({ id: c.id, title: c.title, date: c.date, direction: c.direction, repeat: c.repeat, emoji: c.emoji, color: c.color, pinned: c.pinned ? 1 : 0, created_at: c.createdAt });

export const parseSession = (r: Row): FocusSession | null =>
  typeof r.id === "string" && (r.mode === "pomodoro" || r.mode === "stopwatch") && isInstant(r.start_at) && isInstant(r.end_at) && typeof r.seconds === "number"
    ? { id: r.id, taskId: typeof r.task_id === "string" ? r.task_id : null, mode: r.mode, startAt: r.start_at, endAt: r.end_at, seconds: r.seconds }
    : null;
export const sessionRow = (s: FocusSession): Row => ({ id: s.id, task_id: s.taskId, mode: s.mode, start_at: s.startAt, end_at: s.endAt, seconds: s.seconds });
