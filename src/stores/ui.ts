import { create } from "zustand";
import type { ViewId } from "../domain/types";

type UiStore = {
  view: ViewId;
  go: (view: ViewId) => void;
};

/** Set from settings.defaultView once settings hydrate (main.tsx). */
export const useUi = create<UiStore>((set) => ({
  view: "today",
  go: (view) => set({ view }),
}));
