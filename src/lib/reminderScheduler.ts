import { select, write } from "../db/client";
import type { Row } from "../db/rows";
import { remindersBetween, type Fire, type ReminderTarget } from "../domain/reminders";
import { derive } from "../features/tasks/selectors";
import { useData } from "../stores/data";
import { useHabits, valuesOf } from "../stores/habits";
import { useSettings } from "../stores/settings";

/** A fired reminder as it travels between windows (JSON-safe). */
export type ReminderDTO = { key: string; at: string; title: string; body: string; target: ReminderTarget };

const toDTO = (f: Fire): ReminderDTO => ({ key: f.key, at: f.at.toISOString(), title: f.title, body: f.body, target: f.target });

const CHECK_MS = 30_000;
/** Reminders missed while the app was closed still fire on launch if they're this recent. */
const CATCH_UP_MS = 12 * 3_600_000;

const fired = new Set<string>();
const snoozed = new Map<string, { until: number; dto: ReminderDTO }>();

function isDTO(v: unknown): v is ReminderDTO {
  return typeof v === "object" && v !== null && "key" in v && "title" in v && "target" in v;
}

/**
 * Checks every 30s for reminders that came due since the last check (wall-clock window, so a
 * sleeping laptop catches up on wake). Each reminder fires once: fired keys live in
 * `reminder_log`, which also holds snoozes so they survive a restart.
 */
export async function startReminders(notify: (r: ReminderDTO) => void) {
  const since = new Date(Date.now() - CATCH_UP_MS).toISOString();
  await write(["DELETE FROM reminder_log WHERE fired_at < $1 AND snooze_until IS NULL", [new Date(Date.now() - 7 * 86_400_000).toISOString()]]);
  for (const r of await select<Row>("SELECT * FROM reminder_log WHERE fired_at >= $1 OR snooze_until IS NOT NULL", [since])) {
    if (typeof r.key !== "string") continue;
    fired.add(r.key);
    if (typeof r.snooze_until === "string" && typeof r.payload === "string") {
      try {
        const dto: unknown = JSON.parse(r.payload);
        if (isDTO(dto)) snoozed.set(r.key, { until: Date.parse(r.snooze_until), dto });
      } catch {
        // Corrupt row: the snooze is dropped, the reminder stays "fired".
      }
    }
  }

  let last = Date.now() - CATCH_UP_MS;
  const check = () => {
    const now = Date.now();
    const { tasks, lists } = useData.getState();
    const { habits, checkins } = useHabits.getState();
    const { timeFormat, weekStart } = useSettings.getState().settings;
    const due = remindersBetween(derive(tasks, lists).active, Object.values(habits), (id) => valuesOf(checkins[id]), new Date(last), new Date(now), timeFormat, weekStart);
    last = now;
    for (const f of due) {
      if (fired.has(f.key)) continue;
      fired.add(f.key);
      const dto = toDTO(f);
      void write(["INSERT INTO reminder_log (key, fired_at, payload) VALUES ($1, $2, $3) ON CONFLICT(key) DO NOTHING", [f.key, new Date(now).toISOString(), JSON.stringify(dto)]]);
      notify(dto);
    }
    for (const [key, s] of snoozed) {
      if (s.until > now) continue;
      snoozed.delete(key);
      void write(["UPDATE reminder_log SET snooze_until = NULL WHERE key = $1", [key]]);
      notify(s.dto);
    }
  };
  check();
  setInterval(check, CHECK_MS);
}

export function snoozeReminder(dto: ReminderDTO, minutes: number) {
  const until = Date.now() + minutes * 60_000;
  snoozed.set(dto.key, { until, dto });
  void write([
    "INSERT INTO reminder_log (key, fired_at, snooze_until, payload) VALUES ($1, $2, $3, $4) ON CONFLICT(key) DO UPDATE SET snooze_until = excluded.snooze_until",
    [dto.key, new Date().toISOString(), new Date(until).toISOString(), JSON.stringify(dto)],
  ]);
}
