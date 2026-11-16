import { useEffect } from "react";
import { setSelection, useUi } from "../../stores/ui";

const HOLD_MS = 450;
const MOVE_PX = 6;
const ROW = "[data-task-id]";

/**
 * Multi-select without a modifier key (UI-07): holding a task row (touch, or any pointer below 720px)
 * selects it; while that selection lasts, tapping rows adds or removes them instead of opening them.
 * Clears when the selection empties (Esc, the bulk bar's X).
 */
export function useTouchSelect() {
  useEffect(() => {
    let mode = false;
    let timer = 0;
    let heldAt = 0;
    let start = { x: 0, y: 0 };
    const toggle = (id: string) => {
      const sel = useUi.getState().selection;
      setSelection(sel.includes(id) ? sel.filter((s) => s !== id) : [...sel, id]);
    };
    const cancel = () => window.clearTimeout(timer);
    const rowOf = (t: EventTarget | null) => (t instanceof Element ? t.closest<HTMLElement>(ROW) : null);

    const down = (e: PointerEvent) => {
      const row = rowOf(e.target);
      if (!row || (e.pointerType !== "touch" && window.innerWidth >= 720) || (e.target instanceof Element && e.target.closest("button, a, input"))) return;
      start = { x: e.clientX, y: e.clientY };
      cancel();
      timer = window.setTimeout(() => {
        heldAt = Date.now();
        mode = true;
        toggle(row.dataset.taskId ?? "");
      }, HOLD_MS);
    };
    const move = (e: PointerEvent) => {
      if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > MOVE_PX) cancel();
    };
    // Capture on window, so the row's own click (select + open) and the context menu never see the gesture.
    const click = (e: MouseEvent) => {
      const row = rowOf(e.target);
      const swallow = Date.now() - heldAt < 600;
      if (swallow || (mode && row && !(e.target instanceof Element && e.target.closest("button, a, input")))) {
        e.stopPropagation();
        e.preventDefault();
        if (!swallow && row) toggle(row.dataset.taskId ?? "");
      }
    };
    const menu = (e: Event) => {
      if (Date.now() - heldAt < 600) (e.preventDefault(), e.stopPropagation());
    };
    const unsub = useUi.subscribe((s) => {
      if (!s.selection.length) mode = false;
    });
    window.addEventListener("pointerdown", down, true);
    window.addEventListener("pointermove", move, true);
    window.addEventListener("pointerup", cancel, true);
    window.addEventListener("pointercancel", cancel, true);
    window.addEventListener("click", click, true);
    window.addEventListener("contextmenu", menu, true);
    return () => {
      cancel();
      unsub();
      window.removeEventListener("pointerdown", down, true);
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", cancel, true);
      window.removeEventListener("pointercancel", cancel, true);
      window.removeEventListener("click", click, true);
      window.removeEventListener("contextmenu", menu, true);
    };
  }, []);
}
