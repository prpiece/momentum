import type { LocalDate, Task, TaskList } from "./types";
import { derive, inSmartList, sortVMs } from "./taskViews";

/** What the home/lock-screen widgets show: the next open tasks for today (overdue first) and how many more there are. */
export type TodayWidgetProps = { items: { title: string; url: string }[]; more: number };

export const WIDGET_ITEMS = 3;

/** `url` is the phone app's deep link to the task (expo-router `task/[id]`, `key` picks a recurring occurrence). */
export function todayWidgetProps(tasks: Record<string, Task>, lists: Record<string, TaskList>, today: LocalDate): TodayWidgetProps {
  const open = sortVMs(derive(tasks, lists).active.filter((vm) => inSmartList("today", vm, today)), "date");
  return {
    items: open.slice(0, WIDGET_ITEMS).map(({ task, key }) => ({ title: task.title, url: `momentum://task/${task.id}${key ? `?key=${encodeURIComponent(key)}` : ""}` })),
    more: Math.max(0, open.length - WIDGET_ITEMS),
  };
}
