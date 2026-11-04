import { relativeDayLabel } from "./dates";
import type { LocalDate, Task, TaskList, ViewId } from "./types";

/**
 * Where the quick-add popup was opened from (D70). Sent main -> popup with `quickadd:focus` and
 * back with `quickadd:create`, so the main window, the only writer, can apply it.
 */
export type QuickAddContext = { kind: "list"; listId: string; name: string } | { kind: "day"; date: LocalDate };

/** The context a view implies, or null for views with nothing to pre-fill (Inbox/defaults apply). */
export function contextForView(view: ViewId, lists: Record<string, TaskList>, calAnchor: LocalDate): QuickAddContext | null {
  if (view === "calendar") return { kind: "day", date: calAnchor };
  const listId = view === "inbox" ? "inbox" : view.startsWith("list:") ? view.slice(5) : null;
  const list = listId ? lists[listId] : undefined;
  return list ? { kind: "list", listId: list.id, name: list.name } : null;
}

/** The task fields a context pre-fills; `exists` guards against a list deleted since the popup opened. */
export function patchForContext(ctx: QuickAddContext | null, exists: (listId: string) => boolean): Partial<Pick<Task, "listId" | "schedule">> {
  if (ctx?.kind === "day") return { schedule: { kind: "day", date: ctx.date } };
  if (ctx?.kind === "list" && exists(ctx.listId)) return { listId: ctx.listId };
  return {};
}

export const contextLabel = (ctx: QuickAddContext, today: LocalDate) => (ctx.kind === "list" ? ctx.name : relativeDayLabel(ctx.date, today));
