import { todayLocal } from "./dates";
import type { LocalDate, Task } from "./types";

export type LogDay = { day: LocalDate; tasks: Task[] };

/**
 * The Logbook (FEAT-17): finished tasks (done or won't do) grouped by the day they were finished, newest first.
 * A view over live tasks; nothing is archived or stored. `query` matches title and notes; `limit` caps the tasks shown.
 */
export function logbook(tasks: Iterable<Task>, query = "", limit = 500): { days: LogDay[]; total: number } {
  const q = query.trim().toLowerCase();
  const hits = [...tasks]
    .filter((t) => t.status !== "open" && !t.deletedAt && t.completedAt && (!q || `${t.title} ${t.description}`.toLowerCase().includes(q)))
    .sort((a, b) => b.completedAt!.localeCompare(a.completedAt!));
  const days: LogDay[] = [];
  for (const t of hits.slice(0, limit)) {
    const day = todayLocal(new Date(t.completedAt!));
    const last = days[days.length - 1];
    if (last?.day === day) last.tasks.push(t);
    else days.push({ day, tasks: [t] });
  }
  return { days, total: hits.length };
}
