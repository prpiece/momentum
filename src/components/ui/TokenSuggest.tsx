import { Hash, List } from "lucide-react";
import { type KeyboardEvent, type ReactNode, type RefObject, useId, useState } from "react";
import { complete, suggest, tokenAt } from "../../domain/autocomplete";

/**
 * Autocomplete for `#tag` and `~List` while typing in a quick-add input. Suggestions are a row of
 * pills under the input (the quick-add popup is too short for a dropdown). ↑/↓ pick, Tab or Enter
 * accepts, Esc dismisses until the token changes.
 */
export function useTokenSuggest(o: { text: string; setText: (t: string) => void; input: RefObject<HTMLInputElement | null>; lists: readonly string[]; tags: readonly string[] }) {
  const [caret, setCaret] = useState(0);
  const [active, setActive] = useState(0);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const id = useId();
  const token = tokenAt(o.text, Math.min(caret, o.text.length));
  const tokenKey = token && `${token.start}:${token.sigil}${token.query}`;
  const options = token && tokenKey !== dismissed ? suggest(token.query, token.sigil === "#" ? o.tags : o.lists) : [];
  const open = options.length > 0;
  const current = Math.min(active, options.length - 1);

  const accept = (name: string) => {
    if (!token) return;
    const next = complete(o.text, token, name);
    o.setText(next.text);
    setCaret(next.caret);
    setActive(0);
    requestAnimationFrame(() => o.input.current?.setSelectionRange(next.caret, next.caret));
  };

  /** Call first in the input's onKeyDown; true means the key was handled. */
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>): boolean => {
    if (!open) return false;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      setActive((current + (e.key === "ArrowDown" ? 1 : options.length - 1)) % options.length);
    } else if (e.key === "Tab" || e.key === "Enter") {
      accept(options[current]);
    } else if (e.key === "Escape") {
      setDismissed(tokenKey);
    } else return false;
    e.preventDefault();
    e.stopPropagation();
    return true;
  };

  // onSelect alone misses some insertions (IME, paste, insertText), so typing also reports the caret.
  const track = (e: { currentTarget: HTMLInputElement }) => {
    setCaret(e.currentTarget.selectionStart ?? 0);
    setActive(0);
  };
  const inputProps = {
    onSelect: track,
    onInput: track,
    role: "combobox" as const,
    "aria-autocomplete": "list" as const,
    "aria-expanded": open,
    "aria-controls": id,
    "aria-activedescendant": open ? `${id}-${current}` : undefined,
  };

  const Icon = token?.sigil === "#" ? Hash : List;
  const row: ReactNode = open ? (
    <div id={id} role="listbox" aria-label={token?.sigil === "#" ? "Tags" : "Lists"} className="anim-fade flex flex-wrap items-center gap-1.5">
      {options.map((n, i) => (
        <button
          key={n}
          id={`${id}-${i}`}
          type="button"
          role="option"
          aria-selected={i === current}
          tabIndex={-1}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => accept(n)}
          className={`pchip ${i === current ? "is-on" : "hover:bg-surface-2"}`}
        >
          <Icon size={14} strokeWidth={1.75} />
          {n}
        </button>
      ))}
      <span className="ml-auto text-xs text-muted">
        <kbd className="kbd">Tab</kbd> to complete
      </span>
    </div>
  ) : null;

  return { onKeyDown, inputProps, row, open };
}
