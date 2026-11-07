import type { LucideIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export type PickerOption = { value: string; label: string };
const NONE = "__none__";

type Props = {
  icon: LucideIcon;
  ariaLabel: string;
  /** The empty picker's prompt, e.g. "+ Priority". */
  empty: string;
  options: PickerOption[];
  /** The chosen value's label once a token is set (picked, typed or spoken); null while empty. */
  filled: string | null;
  onPick: (value: string) => void;
  onClear: () => void;
  /** Gives focus back to the input after the picker closes. */
  onDone: () => void;
};

const BASE = "h-6 rounded-full text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-accent";

/** D91: a dashed picker while empty, a filled chip once set; the chip reopens the picker and "None" clears it. */
export function TokenPicker({ icon: Icon, ariaLabel, empty, options, filled, onPick, onClear, onDone }: Props) {
  const [open, setOpen] = useState(false);
  const select = useRef<HTMLSelectElement>(null);
  useEffect(() => {
    if (!open) return;
    select.current?.focus();
    try {
      select.current?.showPicker();
    } catch {
      // Not allowed without a recent click; the focused select still works from the keyboard.
    }
  }, [open]);

  if (filled !== null && !open)
    return (
      <button type="button" onClick={() => setOpen(true)} aria-label={`${ariaLabel}: ${filled}. Change`} className={`${BASE} inline-flex items-center gap-1 bg-accent-soft px-2 hover:bg-surface-2`}>
        <Icon size={12} className="text-accent" />
        {filled}
      </button>
    );
  return (
    <select
      ref={select}
      aria-label={ariaLabel}
      value=""
      onChange={(e) => {
        const v = e.target.value;
        if (!v) return;
        setOpen(false);
        if (v === NONE) onClear();
        else onPick(v);
        onDone();
      }}
      onBlur={() => setOpen(false)}
      onKeyDown={(e) => {
        if (e.key === "Escape" && open) {
          e.stopPropagation();
          setOpen(false);
          onDone();
        }
      }}
      className={`${BASE} max-w-32 border border-dashed border-border bg-transparent px-2 text-fg-2 hover:bg-surface-2`}
    >
      <option value="">{filled === null ? empty : `${ariaLabel}…`}</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
      {filled !== null && <option value={NONE}>None</option>}
    </select>
  );
}
