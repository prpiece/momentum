/*
 * Pure logic for the tray quick view (FEAT-18), pop-out windows (FEAT-27) and the undo history
 * (FEAT-24). The pop-out window has no database: main pushes a PopState, the window sends
 * "mini:action" toggles back (D33).
 */
import { SMART_LISTS, type SmartListId } from "./types";
import { inSmartList, sortVMs, waitingNow, type TaskVM } from "./taskViews";
import type { LocalDate } from "./types";

/** Tray tooltip: how many are left today and what is next. */
export function trayTooltip(left: number, next: string | null): string {
  if (left === 0) return "Momentum: nothing left today";
  return `Momentum: ${left} left${next ? `, next ${next}` : ""}`;
}

export type PopTask = { id: string; key: string | null; title: string };
export type PopState = { view: string; title: string; tasks: PopTask[] };

/** A view a window can pop out: a smart list or a user list. Anything else is refused. */
export function parsePopView(v: unknown): string | null {
  if (typeof v !== "string") return null;
  if ((SMART_LISTS as readonly string[]).includes(v)) return v;
  return /^list:[\w-]+$/.test(v) ? v : null;
}

export function buildPopState(view: string, title: string, vms: readonly TaskVM[], today: LocalDate, limit = 200): PopState {
  const open = vms.filter((v) => v.task.status === "open" && !v.task.parentId && !waitingNow(v, today));
  const inView = view.startsWith("list:") ? open.filter((v) => v.task.listId === view.slice(5)) : open.filter((v) => inSmartList(view as SmartListId, v, today));
  const tasks = sortVMs(inView, "date").slice(0, limit).map((v) => ({ id: v.task.id, key: v.key, title: v.task.title }));
  return { view, title, tasks };
}

export function parsePopState(raw: unknown): PopState | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.view !== "string" || typeof r.title !== "string" || !Array.isArray(r.tasks)) return null;
  const tasks: PopTask[] = [];
  for (const t of r.tasks) {
    if (typeof t !== "object" || t === null) return null;
    const { id, key, title } = t as Record<string, unknown>;
    if (typeof id !== "string" || typeof title !== "string" || (key !== null && key !== undefined && typeof key !== "string")) return null;
    tasks.push({ id, key: key ?? null, title });
  }
  return { view: r.view, title: r.title, tasks };
}


export type UndoSource = "you" | "sync" | "agent";
export type UndoEntry = { id: number; message: string; source: UndoSource; at: number };

/** Newest last, capped. */
export function pushEntry<T extends UndoEntry>(list: readonly T[], e: T, max = 20): T[] {
  return [...list, e].slice(-max);
}

/** Undo up to and including `id`: the entries to revert (newest first) and what stays. */
export function undoThrough<T extends UndoEntry>(list: readonly T[], id: number): { revert: T[]; keep: T[] } {
  const i = list.findIndex((e) => e.id === id);
  if (i < 0) return { revert: [], keep: [...list] };
  return { revert: list.slice(i).reverse(), keep: list.slice(0, i) };
}
