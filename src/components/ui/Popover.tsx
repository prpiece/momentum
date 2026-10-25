import { type ReactNode, type RefObject, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

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
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
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
    let top = r.bottom + 6;
    if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 6);
    left = Math.min(Math.max(8, left), window.innerWidth - w - 8);
    setPos({ top, left });
  }, [anchor, align]);

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
      className={`anim-rise fixed z-50 min-w-44 rounded-md border border-border bg-surface-2 p-1 shadow-lg ${props.className ?? ""}`}
      style={pos ?? { top: -9999, left: -9999 }}
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
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={props.onSelect}
      className={`flex w-full items-center gap-2.5 rounded-sm px-2.5 py-1.5 text-left text-sm transition-colors hover:bg-hover ${
        props.danger ? "text-danger" : "text-fg"
      } ${props.active ? "bg-accent-soft" : ""}`}
    >
      {props.icon && <span className="shrink-0 text-muted">{props.icon}</span>}
      <span className="flex-1 truncate">{props.children}</span>
      {props.hint && <span className="text-xs text-muted">{props.hint}</span>}
    </button>
  );
}

export const MenuSeparator = () => <div className="mx-2 my-1 h-px bg-border" />;
export const MenuLabel = ({ children }: { children: ReactNode }) => (
  <div className="px-2.5 pb-1 pt-1.5 text-[0.7rem] font-semibold uppercase tracking-wider text-muted">{children}</div>
);

/** Anchor-button + popover pair. */
export function useMenu() {
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  return { anchor, open, setOpen, toggle: () => setOpen((o) => !o), close: () => setOpen(false) };
}
