import { type KeyboardEvent, type PointerEvent, useEffect, useRef, useState } from "react";
import { type Hsv, hexToHsv, hsvToHex, isHex } from "../../domain/color";

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** Drag (pointer) a 2D or 1D track; `onMove` gets fractions 0-1 of the track. */
function useSlide(onMove: (x: number, y: number) => void) {
  const ref = useRef<HTMLDivElement>(null);
  const at = (e: PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    onMove(clamp((e.clientX - r.left) / r.width, 0, 1), clamp((e.clientY - r.top) / r.height, 0, 1));
  };
  return {
    ref,
    onPointerDown: (e: PointerEvent) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      at(e);
    },
    onPointerMove: (e: PointerEvent) => {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) at(e);
    },
  };
}

const handle = "pointer-events-none absolute size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgb(0_0_0/0.45)]";
const track = "relative touch-none rounded-control outline-none focus-visible:ring-2 focus-visible:ring-accent-text focus-visible:ring-offset-2 focus-visible:ring-offset-raised";

/**
 * Saturation/value area, hue slider and hex field; emits #rrggbb. Arrow keys move the handles (Shift = 10x).
 * The two gradients are the picker's content (the colour space itself), not chrome decoration.
 */
export function ColorPicker({ value, onChange }: { value: string; onChange: (hex: string) => void }) {
  const [hsv, setHsv] = useState<Hsv>(() => hexToHsv(value));
  const [text, setText] = useState(value);
  // Hex alone can't carry hue at grey, so only resync from outside when our own colour differs.
  useEffect(() => {
    setHsv((cur) => (hsvToHex(cur) === value ? cur : hexToHsv(value)));
    setText(value);
  }, [value]);

  const set = (next: Hsv) => {
    setHsv(next);
    onChange(hsvToHex(next));
  };
  const area = useSlide((x, y) => set({ ...hsv, s: x, v: 1 - y }));
  const hue = useSlide((x) => set({ ...hsv, h: x * 360 }));
  const areaKey = (e: KeyboardEvent) => {
    const d = e.shiftKey ? 0.1 : 0.01;
    const next = { ...hsv };
    if (e.key === "ArrowLeft") next.s = clamp(hsv.s - d, 0, 1);
    else if (e.key === "ArrowRight") next.s = clamp(hsv.s + d, 0, 1);
    else if (e.key === "ArrowUp") next.v = clamp(hsv.v + d, 0, 1);
    else if (e.key === "ArrowDown") next.v = clamp(hsv.v - d, 0, 1);
    else return;
    e.preventDefault();
    set(next);
  };
  const hueKey = (e: KeyboardEvent) => {
    const dir = e.key === "ArrowRight" || e.key === "ArrowUp" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowDown" ? -1 : 0;
    if (!dir) return;
    e.preventDefault();
    set({ ...hsv, h: clamp(hsv.h + dir * (e.shiftKey ? 10 : 1), 0, 360) });
  };
  const commit = (raw: string) => {
    const t = "#" + raw.trim().replace(/^#/, "").toLowerCase();
    const full = t.length === 4 ? "#" + [...t.slice(1)].map((c) => c + c).join("") : t;
    if (isHex(full)) onChange(full);
    else setText(value);
  };

  return (
    <div className="flex flex-col gap-3">
      <div
        {...area}
        role="slider"
        tabIndex={0}
        aria-label="Saturation and brightness"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(hsv.s * 100)}
        aria-valuetext={`Saturation ${Math.round(hsv.s * 100)}%, brightness ${Math.round(hsv.v * 100)}%`}
        onKeyDown={areaKey}
        className={`${track} h-32 cursor-crosshair border border-border`}
        style={{ backgroundColor: `hsl(${hsv.h} 100% 50%)`, backgroundImage: "linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, transparent)" }}
      >
        <span className={handle} style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, background: value }} />
      </div>
      <div
        {...hue}
        role="slider"
        tabIndex={0}
        aria-label="Hue"
        aria-valuemin={0}
        aria-valuemax={360}
        aria-valuenow={Math.round(hsv.h)}
        onKeyDown={hueKey}
        className={`${track} h-3 cursor-pointer`}
        style={{ backgroundImage: "linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)" }}
      >
        <span className={`${handle} top-1/2`} style={{ left: `${(hsv.h / 360) * 100}%`, background: `hsl(${hsv.h} 100% 50%)` }} />
      </div>
      <label className="flex items-center gap-2 text-xs text-fg-2">
        Hex
        <input
          className="input h-8 flex-1 tabular-nums"
          value={text}
          maxLength={7}
          spellCheck={false}
          onChange={(e) => {
            setText(e.target.value);
            if (isHex(e.target.value)) onChange(e.target.value.toLowerCase());
          }}
          onBlur={(e) => commit(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && commit(e.currentTarget.value)}
        />
      </label>
    </div>
  );
}
