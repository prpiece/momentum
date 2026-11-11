import { useEffect } from "react";
import { addDaysLocal, moveToDate, todayLocal } from "../domain/dates";
import { GO } from "../domain/features";
import { clampScale } from "../domain/settings";
import type { Priority } from "../domain/types";
import { focusFilter } from "../features/tasks/FilterBar";
import { bulkEdit, deleteTasks, toggleDone } from "../features/tasks/actions";
import { focusQuickAdd } from "../features/tasks/QuickAdd";
import { showInCurrentView } from "../features/tasks/viewOptions";
import { setStatus, useData } from "../stores/data";
import { useSettings } from "../stores/settings";
import { closeDrawer, go, setPalette, setSelection, setShortcuts, toast, useUi } from "../stores/ui";
import { undoLast, withUndo } from "../stores/undo";

type KeyHandler = (e: KeyboardEvent) => boolean;
const scoped = new Set<KeyHandler>();
/** Views (calendar) add single-key bindings while mounted; return true when handled. */
export function useViewKeys(fn: KeyHandler) {
  useEffect(() => {
    scoped.add(fn);
    return () => void scoped.delete(fn);
  }, [fn]);
}

const typing = (e: KeyboardEvent) => {
  const t = e.target;
  return t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement || (t instanceof HTMLElement && t.isContentEditable);
};

const G_WINDOW_MS = 1200;
let gPressedAt = 0;

const rows = () => [...document.querySelectorAll<HTMLElement>("main [role=option][data-task-id]")];
const focusedTask = () => (document.activeElement instanceof HTMLElement ? document.activeElement.dataset.taskId : undefined);

function moveFocus(delta: number) {
  const all = rows();
  if (!all.length) return;
  const i = all.findIndex((r) => r === document.activeElement);
  const next = all[i < 0 ? 0 : Math.min(all.length - 1, Math.max(0, i + delta))];
  next.focus();
  next.scrollIntoView({ block: "nearest" });
}

/** Keys that act on the selected tasks, or on the focused row when nothing is selected. */
function taskKey(e: KeyboardEvent, ids: string[]): boolean {
  const tasks = useData.getState().tasks;
  const n = ids.length;
  const what = n === 1 ? `“${tasks[ids[0]]?.title ?? "task"}”` : `${n} tasks`;
  if (/^[0-3]$/.test(e.key)) {
    const p = Number(e.key) as Priority;
    bulkEdit(ids, `Set priority on ${what}`, () => ({ priority: p }));
    return true;
  }
  if (e.key === "t" || e.key === "T") {
    // Recurring tasks are rescheduled from the drawer, where the scope prompt lives.
    const date = e.shiftKey ? addDaysLocal(todayLocal(), 1) : todayLocal();
    const movable = ids.filter((id) => tasks[id] && !tasks[id].recurrence);
    if (movable.length) bulkEdit(movable, `Scheduled ${what} for ${e.shiftKey ? "tomorrow" : "today"}`, (t) => ({ schedule: moveToDate(t.schedule, date) }));
    else toast("Repeating tasks are rescheduled from the task itself (Enter to open it).");
    return true;
  }
  if (e.key === "c") {
    if (n === 1) toggleDone(ids[0]);
    else withUndo(`Completed ${n} tasks`, () => ids.forEach((id) => setStatus(id, "done")));
    return true;
  }
  if (e.key === "Delete") {
    void deleteTasks(ids);
    return true;
  }
  return false;
}

/** App-wide keys. The "?" sheet (features/shell/Dialogs.tsx SHORTCUTS) documents them. */
export function useGlobalShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        return setPalette(!useUi.getState().paletteOpen);
      }
      if (mod && e.key === ",") {
        e.preventDefault();
        return go("settings");
      }
      // Scale (Settings → Appearance): Ctrl + / Ctrl − step by 10%, Ctrl 0 resets.
      if (mod && ["=", "+", "-", "0"].includes(e.key)) {
        e.preventDefault();
        const { settings, update } = useSettings.getState();
        return update({ scale: e.key === "0" ? 1 : clampScale(settings.scale + (e.key === "-" ? -0.1 : 0.1)) });
      }
      if (typing(e)) return;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        return void undoLast();
      }
      if (mod || e.altKey) return;
      const ui = useUi.getState();
      if (ui.paletteOpen || (ui.drawer && useSettings.getState().settings.taskOpen === "center") || ui.scopeAsk || ui.confirmAsk || ui.shortcutsOpen || ui.tourOpen || !useSettings.getState().settings.onboarded) return;

      const key = e.key.toLowerCase();
      if (Date.now() - gPressedAt < G_WINDOW_MS) {
        gPressedAt = 0;
        if (GO[key]) {
          e.preventDefault();
          return go(GO[key]);
        }
        // Matrix is a view mode, not a page (D164).
        if (key === "m") {
          e.preventDefault();
          return showInCurrentView({ mode: "matrix" });
        }
      }
      if (e.key === "Escape") {
        if (ui.drawer) return closeDrawer();
        if (ui.selection.length) return setSelection([]);
        return;
      }
      if (key === "g") {
        gPressedAt = Date.now();
        return;
      }
      if (e.key === "?") return setShortcuts(true);
      if (key === "n") {
        e.preventDefault();
        return focusQuickAdd();
      }
      if (e.key === "/") {
        e.preventDefault();
        return focusFilter();
      }
      if (e.key === "[") {
        const s = useSettings.getState();
        return s.update({ sidebarCollapsed: !s.settings.sidebarCollapsed });
      }
      if (e.key === "ArrowDown" || key === "j" || e.key === "ArrowUp" || key === "k") {
        if (!rows().length) return;
        e.preventDefault();
        return moveFocus(e.key === "ArrowDown" || key === "j" ? 1 : -1);
      }
      const focused = focusedTask();
      const ids = ui.selection.length ? ui.selection : focused ? [focused] : [];
      if (ids.length && taskKey(e, ids)) return e.preventDefault();
      for (const fn of scoped) if (fn(e)) return e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
