import { Check, Plus } from "lucide-react";
import type { ReactNode } from "react";
import { ACCENT_PRESETS } from "../../domain/color";
import { ColorPicker } from "./ColorPicker";
import { Popover, useMenu } from "./Popover";

/** The picker body used everywhere a colour is chosen: SV square, hue, hex, then a swatch row (`children`). */
export function ColorPanel({ value, onChange, children }: { value: string; onChange: (hex: string) => void; children?: ReactNode }) {
  return (
    <div className="flex flex-col gap-3">
      <ColorPicker value={value} onChange={onChange} />
      {children}
    </div>
  );
}

/** Preset swatches plus a "Custom" swatch that opens the full picker (lists, habits, events; D85/D216 picker). */
export function ColorField({ value, onChange, disabled, label = "Color" }: { value: string; onChange: (hex: string) => void; disabled?: boolean; label?: string }) {
  const menu = useMenu();
  const custom = !ACCENT_PRESETS.some((p) => p.hex === value);
  const presets = (size: string) =>
    ACCENT_PRESETS.map((p) => (
      <button key={p.hex} type="button" disabled={disabled} aria-label={p.name} aria-pressed={value === p.hex} onClick={() => onChange(p.hex)} className={`${size} grid place-items-center rounded-full disabled:opacity-50`} style={{ background: p.hex }}>
        {value === p.hex && <Check size={14} strokeWidth={3} className="text-white" />}
      </button>
    ));
  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label={label}>
      {presets("size-7")}
      <button
        ref={menu.anchor}
        type="button"
        disabled={disabled}
        aria-label="Custom color"
        aria-expanded={menu.open}
        aria-pressed={custom}
        onClick={menu.toggle}
        className="grid size-7 place-items-center rounded-full border border-control-border text-fg-2 disabled:opacity-50"
        style={custom ? { background: value } : undefined}
      >
        {custom ? <Check size={14} strokeWidth={3} className="text-white mix-blend-difference" /> : <Plus size={14} />}
      </button>
      {menu.open && (
        <Popover anchor={menu.anchor} onClose={menu.close} className="w-64 p-3">
          <ColorPanel value={value} onChange={onChange}>
            <div className="flex flex-wrap gap-2 p-1">{presets("size-5")}</div>
          </ColorPanel>
        </Popover>
      )}
    </div>
  );
}
