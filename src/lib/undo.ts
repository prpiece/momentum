import { undoable } from "../stores/data";
import { toast } from "../stores/ui";

const stack: (() => void)[] = [];

/** Run a task mutation, show a toast with Undo, and make it Ctrl+Z-able. */
export function withUndo(message: string, fn: () => void) {
  const revert = undoable(fn);
  stack.push(revert);
  if (stack.length > 20) stack.shift();
  toast(message, {
    label: "Undo",
    run: () => {
      const i = stack.lastIndexOf(revert);
      if (i >= 0) stack.splice(i, 1);
      revert();
    },
  });
}

export function undoLast(): boolean {
  const revert = stack.pop();
  if (!revert) return false;
  revert();
  toast("Undone");
  return true;
}
