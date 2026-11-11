import type { ReactNode } from "react";
import { toast as sonner } from "sonner";
import { create } from "zustand";
import { withTransition } from "../lib/motion";
import { setToast, type ToastAction } from "./toast";
import { todayLocal } from "../domain/dates";
import type { ViewId } from "../domain/types";
import type { Scope } from "./data";

type ScopeAsk = { verb: "edit" | "delete"; resolve: (s: Scope | null) => void };
/** A right-click menu entry: an item, a labelled row of icon choices (dates, priority), or "sep" for a divider. */
export type MenuEntry =
  | { label: string; icon?: ReactNode; run: () => void; danger?: boolean; hint?: string }
  | { label: string; choices: { title: string; icon: ReactNode; run: () => void; active?: boolean }[] }
  | "sep";
type ConfirmAsk = { title: string; body: string; confirm: string; resolve: (ok: boolean) => void };

type UiStore = {
  view: ViewId;
  /** Task open in the detail drawer, with the occurrence it was opened from (recurring tasks). */
  drawer: { id: string; key: string | null } | null;
  selection: string[];
  paletteOpen: boolean;
  shortcutsOpen: boolean;
  /** Bulk-import dialog (D92). */
  importOpen: boolean;
  scopeAsk: ScopeAsk | null;
  confirmAsk: ConfirmAsk | null;
  collapsed: Record<string, true>;
  /** Calendar position (session-only; the view type persists in settings). */
  calAnchor: string;
  /** Calendar event open in the event dialog. */
  eventDialog: { id: string; key: string | null } | null;
  /** Calendar showing a day range dragged out on the mini month (days from calAnchor); null = the view's own range. */
  calSpan: number | null;
  /** `from` is the button that opened it, if any: clicks on it toggle the menu rather than count as outside. */
  contextMenu: { x: number; y: number; items: MenuEntry[]; from?: HTMLElement } | null;
  /** Guided tour reopened from Settings (first run is driven by settings.onboarded). */
  tourOpen: boolean;
  /** Filter-bar query per task view (session-only). */
  filters: Partial<Record<ViewId, string>>;
};

export const useUi = create<UiStore>(() => ({
  view: "today",
  drawer: null,
  selection: [],
  paletteOpen: false,
  shortcutsOpen: false,
  importOpen: false,
  scopeAsk: null,
  confirmAsk: null,
  collapsed: {},
  calAnchor: todayLocal(),
  eventDialog: null,
  calSpan: null,
  contextMenu: null,
  tourOpen: false,
  filters: {},
}));
const set = useUi.setState;

// Leaving a view closes what was opened from it (the task drawer would otherwise float over Settings).
export const setFilter = (view: ViewId, query: string) => set((s) => ({ filters: { ...s.filters, [view]: query } }));
export const go = (view: ViewId) => set({ view, selection: [], drawer: null, contextMenu: null });
// Opening and closing the drawer animate (D207); switching tasks inside an open drawer is instant.
export const openTask = (id: string, key: string | null = null) => {
  const change = () => set({ drawer: { id, key } });
  return useUi.getState().drawer ? change() : withTransition(change);
};
export const closeDrawer = () => useUi.getState().drawer && withTransition(() => set({ drawer: null }));
export const setSelection = (selection: string[]) => set({ selection });
export const setPalette = (paletteOpen: boolean) => set({ paletteOpen });
export const setShortcuts = (shortcutsOpen: boolean) => set({ shortcutsOpen });
export const setImport = (importOpen: boolean) => set({ importOpen });
export const setCalAnchor = (calAnchor: string) => set({ calAnchor });
export const setCalSpan = (calSpan: number | null) => set({ calSpan });
export function openContextMenu(e: { clientX: number; clientY: number; preventDefault: () => void; stopPropagation: () => void }, items: MenuEntry[]) {
  e.preventDefault();
  e.stopPropagation();
  set({ contextMenu: { x: e.clientX, y: e.clientY, items } });
}
/** The same menu, opened under a "…" button. */
export function openMenuAt(el: HTMLElement, items: MenuEntry[]) {
  if (useUi.getState().contextMenu?.from === el) return closeContextMenu();
  const r = el.getBoundingClientRect();
  set({ contextMenu: { x: r.left, y: r.bottom, items, from: el } });
}
export const closeContextMenu = () => set({ contextMenu: null });
export const openEvent = (id: string, key: string | null = null) => set({ eventDialog: { id, key } });
export const closeEvent = () => set({ eventDialog: null });
export const toggleCollapsed = (id: string) =>
  set((s) => {
    const { [id]: was, ...rest } = s.collapsed;
    return { collapsed: was ? rest : { ...rest, [id]: true } };
  });

/** A transient toast through Sonner (D207): stacked, swipe or Esc to dismiss, paused on hover. Undo-style actions stay 6 s. */
export function toast(message: string, action?: ToastAction, ms = action ? 6000 : 3500) {
  sonner(message, { duration: ms, action: action && { label: action.label, onClick: action.run } });
}
// The shared stores and sync toast through stores/toast.ts; on desktop that's this one.
setToast(toast);

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
