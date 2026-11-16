import { create } from "zustand";
import { pushEntry, undoThrough, type UndoEntry, type UndoSource } from "../domain/popout";
import { undoable, undoableStructure } from "./data";
import { toast } from "./toast";

type Entry = UndoEntry & { revert: () => void };

/** Recent undoable changes, newest last (in memory only), and whether the history panel is open (FEAT-24). */
export const useUndo = create<{ entries: Entry[]; open: boolean }>(() => ({ entries: [], open: false }));
export const setUndoHistory = (open: boolean) => useUndo.setState({ open });

let nextId = 1;
let source: UndoSource = "you";

/** Label the changes made inside `fn` as coming from sync or an agent instead of the user. */
export function withUndoSource<T>(s: UndoSource, fn: () => T): T {
  const prev = source;
  source = s;
  try {
    return fn();
  } finally {
    source = prev;
  }
}

/** Run a task mutation, show a toast with Undo, and make it Ctrl+Z-able. */
export function withUndo(message: string, fn: () => void) {
  pushUndo(message, undoable(fn));
}

/** Like `withUndo`, for deleting a list, folder, section or tag. */
export function withStructureUndo(message: string, fn: () => void) {
  pushUndo(message, undoableStructure(fn));
}

const drop = (id: number) => useUndo.setState((s) => ({ entries: s.entries.filter((e) => e.id !== id) }));

/** Offer Undo (and Ctrl+Z) for a change that brings its own revert, such as one that also creates lists. */
export function pushUndo(message: string, revert: () => void) {
  const entry: Entry = { id: nextId++, message, source, at: Date.now(), revert };
  useUndo.setState((s) => ({ entries: pushEntry(s.entries, entry) }));
  toast(message, {
    label: "Undo",
    run: () => {
      drop(entry.id);
      revert();
    },
  });
}

export function undoLast(): boolean {
  const last = useUndo.getState().entries.slice(-1)[0];
  if (!last) return false;
  drop(last.id);
  last.revert();
  toast("Undone");
  return true;
}

/** Undo this change and every newer one. */
export function undoTo(id: number) {
  const { revert, keep } = undoThrough(useUndo.getState().entries, id);
  useUndo.setState({ entries: keep });
  revert.forEach((e) => e.revert());
  if (revert.length) toast(revert.length === 1 ? "Undone" : `Undone ${revert.length} changes`);
}
