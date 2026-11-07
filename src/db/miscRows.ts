/* Legacy countdown and focus-session row mapping (pure; shared by the stores and backup import). */
import { isInstant, isLocalDate } from "../domain/dates";
import type { FocusSession } from "../domain/focus";
import type { CalendarEvent } from "../domain/types";
import type { Row } from "./rows";

const EMOJI_DEFAULT = "⏳";

/**
 * A row of the pre-v1.0 `countdowns` table (still found in old backups) as the all-day event it
 * became (D163). Same rules as migration 0008: a picked emoji prefixes the title, icon keys are dropped.
 */
export function parseLegacyCountdown(r: Row): CalendarEvent | null {
  if (typeof r.id !== "string" || typeof r.title !== "string" || !isLocalDate(r.date)) return null;
  const icon = typeof r.emoji === "string" ? r.emoji : "";
  const emoji = icon && icon !== EMOJI_DEFAULT && /[^a-z0-9-]/.test(icon);
  const at = isInstant(r.created_at) ? r.created_at : new Date().toISOString();
  const rule = r.repeat === "monthly" ? "FREQ=MONTHLY" : r.repeat === "yearly" ? "FREQ=YEARLY" : null;
  return {
    id: r.id,
    title: emoji ? `${icon} ${r.title}` : r.title,
    notes: "",
    schedule: { kind: "day", date: r.date },
    spanDays: 1,
    color: typeof r.color === "string" && /^#[0-9a-f]{6}$/i.test(r.color) ? r.color : null,
    recurrence: rule ? { rule, exdates: [] } : null,
    recurrenceParentId: null,
    source: "local",
    countdown: r.direction === "since" ? "since" : "until",
    pinned: r.pinned === 1,
    createdAt: at,
    updatedAt: at,
    deletedAt: null,
  };
}

export const parseSession = (r: Row): FocusSession | null =>
  typeof r.id === "string" && (r.mode === "pomodoro" || r.mode === "stopwatch") && isInstant(r.start_at) && isInstant(r.end_at) && typeof r.seconds === "number"
    ? { id: r.id, taskId: typeof r.task_id === "string" ? r.task_id : null, mode: r.mode, startAt: r.start_at, endAt: r.end_at, seconds: r.seconds }
    : null;
export const sessionRow = (s: FocusSession): Row => ({ id: s.id, task_id: s.taskId, mode: s.mode, start_at: s.startAt, end_at: s.endAt, seconds: s.seconds });
