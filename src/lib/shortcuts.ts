import { useEffect } from "react";
import { deleteTasks } from "../features/tasks/actions";
import { focusQuickAdd } from "../features/tasks/QuickAdd";
import { closeDrawer, setPalette, setSelection, setShortcuts, useUi } from "../stores/ui";
import { undoLast } from "./undo";

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

/** App-wide keys. The "?" sheet (features/shell/Dialogs.tsx SHORTCUTS) documents them. */
export function useGlobalShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        return setPalette(!useUi.getState().paletteOpen);
      }
      if (typing(e)) return;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        return void undoLast();
      }
      if (mod || e.altKey) return;
      const ui = useUi.getState();
      if (ui.paletteOpen || ui.scopeAsk || ui.confirmAsk) return;
      if (e.key === "Escape") {
        if (ui.drawer) return closeDrawer();
        if (ui.selection.length) return setSelection([]);
        return;
      }
      if (e.key === "?") return setShortcuts(true);
      if (e.key === "n" || e.key === "N") {
        e.preventDefault();
        return focusQuickAdd();
      }
      if (e.key === "Delete" && ui.selection.length) return void deleteTasks(ui.selection);
      for (const fn of scoped) if (fn(e)) return e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
