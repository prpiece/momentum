import { create } from "zustand";
import type { ViewId } from "../domain/types";
import type { Scope } from "./data";

export type Toast = { id: number; message: string; action?: { label: string; run: () => void } };
type ScopeAsk = { verb: "edit" | "delete"; resolve: (s: Scope | null) => void };
type ConfirmAsk = { title: string; body: string; confirm: string; resolve: (ok: boolean) => void };

type UiStore = {
  view: ViewId;
  /** Task open in the detail drawer, with the occurrence it was opened from (recurring tasks). */
  drawer: { id: string; key: string | null } | null;
  selection: string[];
  paletteOpen: boolean;
  shortcutsOpen: boolean;
  toasts: Toast[];
  scopeAsk: ScopeAsk | null;
  confirmAsk: ConfirmAsk | null;
  collapsed: Record<string, true>;
};

export const useUi = create<UiStore>(() => ({
  view: "today",
  drawer: null,
  selection: [],
  paletteOpen: false,
  shortcutsOpen: false,
  toasts: [],
  scopeAsk: null,
  confirmAsk: null,
  collapsed: {},
}));
const set = useUi.setState;

export const go = (view: ViewId) => set({ view, selection: [] });
export const openTask = (id: string, key: string | null = null) => set({ drawer: { id, key } });
export const closeDrawer = () => set({ drawer: null });
export const setSelection = (selection: string[]) => set({ selection });
export const setPalette = (paletteOpen: boolean) => set({ paletteOpen });
export const setShortcuts = (shortcutsOpen: boolean) => set({ shortcutsOpen });
export const toggleCollapsed = (id: string) =>
  set((s) => {
    const { [id]: was, ...rest } = s.collapsed;
    return { collapsed: was ? rest : { ...rest, [id]: true } };
  });

let toastId = 0;
export function toast(message: string, action?: Toast["action"]) {
  const id = ++toastId;
  set((s) => ({ toasts: [...s.toasts.slice(-2), { id, message, action }] }));
  setTimeout(() => dismissToast(id), action ? 6000 : 3500);
}
export const dismissToast = (id: number) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));

/** Ask which occurrences a change to a recurring task applies to. Resolves null on cancel. */
export const askScope = (verb: ScopeAsk["verb"]) =>
  new Promise<Scope | null>((resolve) =>
    set({
      scopeAsk: {
        verb,
        resolve: (s) => {
          set({ scopeAsk: null });
          resolve(s);
        },
      },
    }),
  );

export const confirm = (title: string, body: string, confirmLabel = "Delete") =>
  new Promise<boolean>((resolve) =>
    set({
      confirmAsk: {
        title,
        body,
        confirm: confirmLabel,
        resolve: (ok) => {
          set({ confirmAsk: null });
          resolve(ok);
        },
      },
    }),
  );
