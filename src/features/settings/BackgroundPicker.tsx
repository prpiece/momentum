import { open } from "@tauri-apps/plugin-dialog";
import { Check, ImagePlus } from "lucide-react";
import { BLUR_MAX, DIM_MAX, GRADIENTS } from "../../domain/backgrounds";
import type { Background } from "../../domain/types";
import { isTauri } from "../../db/client";
import { deleteImage, IMAGE_EXTS, importImage, newImageName } from "../../lib/appFiles";
import { useSettings } from "../../stores/settings";
import { toast } from "../../stores/ui";

const swatch = "grid size-9 place-items-center rounded-md border border-border transition-transform duration-[var(--dur)] hover:scale-105";

function Slider({ label, value, max, unit, onChange }: { label: string; value: number; max: number; unit: string; onChange: (v: number) => void }) {
  return (
    <label className="flex items-center gap-3 text-sm">
      <span className="w-12 font-medium">{label}</span>
      <input type="range" min={0} max={max} value={value} onChange={(e) => onChange(Number(e.target.value))} className="w-40 accent-[var(--accent)]" />
      <span className="w-12 font-mono text-xs tabular-nums text-muted">
        {value}
        {unit}
      </span>
    </label>
  );
}

/** Settings → Appearance: none, 8 gradients or a chosen image (D79). Changes apply live, so the window is the preview. */
export function BackgroundPicker() {
  const s = useSettings((st) => st.settings);
  const update = useSettings((st) => st.update);

  /** Switch background and remove the previous image file, if it was one. */
  const choose = (next: Background) => {
    if (s.background.kind === "image" && !(next.kind === "image" && next.name === s.background.name)) void deleteImage("backgrounds", s.background.name).catch(() => {});
    update({ background: next });
  };

  const pickImage = async () => {
    const path = await open({ multiple: false, filters: [{ name: "Images", extensions: [...IMAGE_EXTS] }] });
    if (typeof path !== "string") return;
    const name = newImageName(path);
    if (!name) return toast("Choose a PNG, JPG, GIF or WebP image.");
    try {
      await importImage("backgrounds", name, path);
    } catch {
      return toast("Couldn't use that image. It may be larger than 10 MB.");
    }
    choose({ kind: "image", name });
  };

  const on = (b: Background["kind"], id?: string) => s.background.kind === b && (s.background.kind !== "gradient" || s.background.id === id);
  const check = <Check size={15} strokeWidth={3} className="text-accent" />;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-end gap-2" role="group" aria-label="Background">
        <button type="button" title="None" aria-label="None" aria-pressed={on("none")} onClick={() => choose({ kind: "none" })} className={`${swatch} bg-surface text-xs text-muted`}>
          {on("none") ? check : "–"}
        </button>
        {GRADIENTS.map((g) => (
          <button key={g.id} type="button" title={g.name} aria-label={g.name} aria-pressed={on("gradient", g.id)} onClick={() => choose({ kind: "gradient", id: g.id })} className={swatch} style={{ background: g.css }}>
            {on("gradient", g.id) && <Check size={15} strokeWidth={3} className="text-white drop-shadow" />}
          </button>
        ))}
        {isTauri && (
          <button
            type="button"
            onClick={() => void pickImage()}
            aria-pressed={on("image")}
            className="flex h-9 items-center gap-2 rounded-md border border-border bg-surface px-3 text-sm text-fg-2 transition-colors hover:border-accent hover:text-fg"
          >
            {on("image") ? check : <ImagePlus size={15} />}
            Choose image…
          </button>
        )}
      </div>
      {s.background.kind !== "none" && (
        <div className="flex flex-wrap justify-end gap-x-6 gap-y-2">
          <Slider label="Dim" value={s.backgroundDim} max={DIM_MAX} unit="%" onChange={(v) => update({ backgroundDim: v })} />
          {s.background.kind === "image" && <Slider label="Blur" value={s.backgroundBlur} max={BLUR_MAX} unit="px" onChange={(v) => update({ backgroundBlur: v })} />}
        </div>
      )}
    </div>
  );
}
