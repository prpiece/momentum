import { undoable } from "./data";
import { toast } from "./toast";

const stack: (() => void)[] = [];

/** Run a task mutation, show a toast with Undo, and make it Ctrl+Z-able. */
export function withUndo(message: string, fn: () => void) {
  pushUndo(message, undoable(fn));
}

/** Offer Undo (and Ctrl+Z) for a change that brings its own revert, such as one that also creates lists. */
export function pushUndo(message: string, revert: () => void) {
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
