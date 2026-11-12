import { type ReactNode, useEffect, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { exitGhost } from "../../lib/motion";
import { lockScroll } from "../../lib/scrollLock";
import { Tip } from "./Tip";

/** Modal with backdrop. Escape and backdrop click close (`modal` keeps it open on backdrop click); focus moves inside and returns on close. */
export function Dialog(props: { onClose: () => void; children: ReactNode; label: string; width?: string; top?: boolean; modal?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const { onClose } = props;

  // The scrim and panel animate out after unmount (D208).
  useLayoutEffect(() => {
    const scrim = ref.current?.parentElement;
    return () => exitGhost(scrim);
  }, []);

  useEffect(() => lockScroll(), []);

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>("[autofocus], input, textarea, select, button");
    first?.focus();
    const onKey = (e: KeyboardEvent) => {
      // Stacked dialogs (an image viewer over a task window): only the top one reacts.
      if (ref.current !== [...document.querySelectorAll("[role=dialog]")].pop()) return;
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
      if (e.key === "Tab" && ref.current) {
        // Minimal focus trap.
        const items = [...ref.current.querySelectorAll<HTMLElement>("button, input, textarea, select, [tabindex='0']")];
        const [a, b] = [items[0], items[items.length - 1]];
        if (e.shiftKey && document.activeElement === a) (e.preventDefault(), b?.focus());
        else if (!e.shiftKey && document.activeElement === b) (e.preventDefault(), a?.focus());
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      prev?.focus?.();
    };
  }, [onClose]);

  return createPortal(
    <div
      className={`dialog-scrim anim-fade fixed inset-0 z-50 flex justify-center bg-[var(--scrim)] p-4 backdrop-blur-[6px] ${props.top ? "items-start pt-[12vh]" : "items-center"}`}
      onPointerDown={(e) => !props.modal && e.target === e.currentTarget && onClose()}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={props.label}
        className={`layer layer-raised anim-dialog max-h-full w-full overflow-auto rounded-panel ${props.width ?? "max-w-[var(--dialog)]"}`}
      >
        {props.children}
      </div>
    </div>,
    document.body,
  );
}

export function Button(props: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  type?: "button" | "submit";
  disabled?: boolean;
  className?: string;
  title?: string;
}) {
  return (
    <button
      type={props.type ?? "button"}
      onClick={props.onClick}
      disabled={props.disabled}
      title={props.title}
      className={`btn btn-${props.variant ?? "ghost"} ${props.className ?? ""}`}
    >
      {props.children}
    </button>
  );
}

export function IconButton(props: {
  label: string;
  children: ReactNode;
  onClick?: (e: React.MouseEvent) => void;
  active?: boolean;
  className?: string;
  buttonRef?: React.Ref<HTMLButtonElement>;
}) {
  return (
    <Tip label={props.label}>
    <button
      ref={props.buttonRef}
      type="button"
      aria-label={props.label}
      onClick={props.onClick}
      className={`btn btn-ghost icon-btn ${props.active ? "is-on" : ""} ${props.className ?? ""}`}
    >
      {props.children}
    </button>
    </Tip>
  );
}
