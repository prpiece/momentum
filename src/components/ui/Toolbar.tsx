import { type ReactNode, useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";

/** The element in the app toolbar (App's Header) that a view's own controls render into (D198). */
export const TOOLBAR_SLOT_ID = "toolbar-slot";

/** Renders a view's controls on the right of the toolbar, beside the breadcrumb, as in the mocks. */
export function ToolbarActions({ children }: { children: ReactNode }) {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => setSlot(document.getElementById(TOOLBAR_SLOT_ID)), []);
  return slot ? createPortal(children, slot) : null;
}
