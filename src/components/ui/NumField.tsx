import { useState } from "react";

/** Integer input with a text draft: empty while typing is fine; blur clamps, or restores `def` when empty/invalid (D75). */
export function NumField({ value, def, lo, hi, onCommit, label }: { value: number; def: number; lo: number; hi: number; onCommit: (n: number) => void; label: string }) {
  const [draft, setDraft] = useState<string | null>(null);
  const parse = (v: string) => (v.trim() === "" ? NaN : Math.round(Number(v)));
  return (
    <input
      type="number"
      min={lo}
      max={hi}
      aria-label={label}
      value={draft ?? String(value)}
      onChange={(e) => {
        setDraft(e.target.value);
        const n = parse(e.target.value);
        if (n >= lo && n <= hi) onCommit(n);
      }}
      onBlur={() => {
        const n = parse(draft ?? String(value));
        onCommit(Number.isNaN(n) ? def : Math.min(hi, Math.max(lo, n)));
        setDraft(null);
      }}
      className="input h-[var(--control-sm)] w-14 px-1.5 tabular-nums"
    />
  );
}
