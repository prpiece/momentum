import { type ReactNode, useEffect, useRef } from "react";
import { createPortal } from "react-dom";

/** Modal with backdrop. Escape and backdrop click close; focus moves inside and returns on close. */
export function Dialog(props: { onClose: () => void; children: ReactNode; label: string; width?: string; top?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const { onClose } = props;

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>("[autofocus], input, textarea, select, button");
    first?.focus();
    const onKey = (e: KeyboardEvent) => {
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
      className={`anim-fade fixed inset-0 z-50 flex justify-center bg-black/30 p-4 backdrop-blur-[2px] ${props.top ? "items-start pt-[12vh]" : "items-center"}`}
      onPointerDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={props.label}
        className={`anim-rise max-h-full w-full overflow-auto rounded-lg border border-border bg-surface-2 shadow-lg ${props.width ?? "max-w-md"}`}
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
  variant?: "primary" | "ghost" | "danger";
  type?: "button" | "submit";
  disabled?: boolean;
  className?: string;
  title?: string;
}) {
  const v = props.variant ?? "ghost";
  const cls = {
    primary: "bg-accent text-accent-fg hover:bg-accent-hover active:bg-accent-press shadow-sm",
    ghost: "text-fg-2 hover:bg-hover hover:text-fg",
    danger: "bg-danger text-white hover:opacity-90",
  }[v];
  return (
    <button
      type={props.type ?? "button"}
      onClick={props.onClick}
      disabled={props.disabled}
      title={props.title}
      className={`inline-flex h-9 items-center justify-center gap-2 rounded-sm px-3.5 text-sm font-medium transition-colors duration-[var(--dur)] disabled:opacity-50 ${cls} ${props.className ?? ""}`}
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
    <button
      ref={props.buttonRef}
      type="button"
      aria-label={props.label}
      title={props.label}
      onClick={props.onClick}
      className={`grid size-8 shrink-0 place-items-center rounded-sm transition-colors duration-[var(--dur)] hover:bg-hover hover:text-fg ${
        props.active ? "bg-accent-soft text-accent" : "text-muted"
      } ${props.className ?? ""}`}
    >
      {props.children}
    </button>
  );
}
