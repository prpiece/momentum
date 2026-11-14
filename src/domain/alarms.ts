import type { Fire } from "./reminders";
import type { Priority } from "./types";

/** A task reminder (not a "starting now" alert, habit or digest) for a high-priority task rings as a full-screen alarm. */
export function isAlarm(f: Pick<Fire, "key" | "target">, priorityOf: (taskId: string) => Priority | undefined): boolean {
  return f.key.startsWith("task:") && f.target.kind === "task" && priorityOf(f.target.id) === 3;
}
