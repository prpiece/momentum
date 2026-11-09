import { type ReactNode, type RefObject, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { exitGhost } from "../../lib/motion";

/**
 * Floating panel anchored to an element (or a point). Portaled so it escapes scroll clipping;
 * flips/clamps to stay on screen; closes on outside click and Escape.
 */
export function Popover(props: {
  anchor: RefObject<HTMLElement | null> | { x: number; y: number };
  onClose: () => void;
  children: ReactNode;
  align?: "start" | "end";
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; origin: string } | null>(null);
  const { anchor, onClose, align = "start" } = props;

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r =
      "current" in anchor
        ? (anchor.current?.getBoundingClientRect() ?? new DOMRect())
        : new DOMRect(anchor.x, anchor.y, 0, 0);
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    let left = align === "end" ? r.right - w : r.left;
    const point = !("current" in anchor);
    // Anchored to an element: flip above it. At a point (right-click): just slide up to fit.
    let top = point ? r.top + 2 : r.bottom + 6;
    if (top + h > window.innerHeight - 8) top = Math.max(8, point ? window.innerHeight - h - 8 : r.top - h - 6);
    left = Math.min(Math.max(8, left), window.innerWidth - w - 8);
    // Grows from the corner nearest its anchor (transitions.dev menu dropdown, D208).
    setPos({ top, left, origin: `${top < r.top ? "bottom" : "top"} ${align === "end" ? "right" : "left"}` });
  }, [anchor, align]);

  useLayoutEffect(() => {
    const el = ref.current;
    return () => exitGhost(el);
  }, []);

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node;
      const anchorEl = "current" in anchor ? anchor.current : null;
      if (!ref.current?.contains(target) && !anchorEl?.contains(target)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [anchor, onClose]);

  return createPortal(
    <div
      ref={ref}
      role="dialog"
      className={`layer layer-raised anim-pop-in fixed z-50 min-w-[200px] rounded-card p-1 ${props.className ?? ""}`}
      style={pos ? { top: pos.top, left: pos.left, transformOrigin: pos.origin } : { top: -9999, left: -9999 }}
    >
      {props.children}
    </div>,
    document.body,
  );
}

export function MenuItem(props: {
  icon?: ReactNode;
  children: ReactNode;
  onSelect: () => void;
  danger?: boolean;
  active?: boolean;
  hint?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={props.disabled}
      onClick={props.onSelect}
      className={`menu-item ${props.danger ? "danger" : ""} ${props.active ? "is-on" : ""}`}
    >
      {props.icon && <span className="mi-icon">{props.icon}</span>}
      <span className="min-w-0 flex-1 truncate">{props.children}</span>
      {props.hint && <span className="text-xs text-muted">{props.hint}</span>}
    </button>
  );
}

export const MenuSeparator = () => <div role="separator" className="menu-sep" />;
export const MenuLabel = ({ children }: { children: ReactNode }) => (
  <div className="t-label px-2 pb-1 pt-1.5 text-muted">{children}</div>
);

/** Anchor-button + popover pair. */
export function useMenu() {
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  return { anchor, open, setOpen, toggle: () => setOpen((o) => !o), close: () => setOpen(false) };
}
