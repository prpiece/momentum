import type { CalendarEvent, Task, TaskList } from "./types";

/** Every live task and list as JSON for other tools (FEAT-05). Not a restore format: the .zip backup is that. */
export function tasksToJson(tasks: Task[], lists: TaskList[], tagName: (id: string) => string, events: CalendarEvent[] = [], now = new Date()): string {
  const live = <T extends { deletedAt: string | null }>(xs: T[]) => xs.filter((x) => !x.deletedAt);
  return JSON.stringify(
    {
      app: "Momentum",
      format: "momentum-tasks-export",
      exportedAt: now.toISOString(),
      lists: lists.map((l) => ({ id: l.id, name: l.name })),
      tasks: live(tasks).map((t) => ({ ...t, tags: t.tags.map(tagName) })),
      events: live(events).filter((e) => e.source === "local"),
    },
    null,
    1,
  );
}
