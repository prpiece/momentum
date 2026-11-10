import { useState } from "react";
import { ColorPicker } from "../../components/ui/ColorPicker";
import { Segmented } from "../../components/ui/Segmented";
import { isTauri } from "../../db/client";
import { DIM_DEFAULT, DIM_MAX, type Background } from "../../domain/types";
import { deleteImage, IMAGE_EXTS, importImage, newImageName } from "../../lib/appFiles";
import { useSettings } from "../../stores/settings";
import { toast } from "../../stores/ui";

type Mode = Background["kind"];
const DEFAULT_HEX = "#2f6fed";

/** Settings → Appearance → Background (D222): none, a colour, or an image copied into the app's data folder. */
export function BackgroundSection() {
  const bg = useSettings((s) => s.settings.background);
  const update = useSettings((s) => s.update);
  // Choosing "Image" before a file is picked has no setting to show yet, so the tab is local state.
  const [mode, setMode] = useState<Mode>(bg.kind);
  const [lastHex, setLastHex] = useState(bg.kind === "color" ? bg.hex : DEFAULT_HEX);

  const dropFile = () => {
    if (bg.kind === "image") void deleteImage("backgrounds", bg.file).catch(console.error);
  };
  const choose = (m: Mode) => {
    setMode(m);
    if (m === "none") {
      dropFile();
      update({ background: { kind: "none" } });
    } else if (m === "color") {
      dropFile();
      update({ background: { kind: "color", hex: lastHex } });
    }
  };
  const pick = async () => {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const path = await open({ multiple: false, directory: false, filters: [{ name: "Images", extensions: [...IMAGE_EXTS] }] });
      if (typeof path !== "string") return;
      const file = newImageName(path);
      if (!file) return toast("That isn't a PNG, JPG, GIF or WebP image.");
      await importImage("backgrounds", file, path);
      dropFile();
      update({ background: { kind: "image", file, dim: bg.kind === "image" ? bg.dim : DIM_DEFAULT } });
    } catch (err) {
      toast(typeof err === "string" ? err : "Couldn't use that image.");
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <span className="font-medium">Background</span>
        <Segmented
          name="background"
          label="Background"
          value={mode}
          onChange={choose}
          options={[
            { value: "none", label: "None" },
            { value: "color", label: "Colour" },
            { value: "image", label: "Image", disabled: !isTauri },
          ]}
        />
      </div>
      {mode === "color" && bg.kind === "color" && (
        <ColorPicker
          value={bg.hex}
          onChange={(hex) => {
            setLastHex(hex);
            update({ background: { kind: "color", hex } });
          }}
        />
      )}
      {mode === "image" && (
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className="btn btn-secondary" onClick={() => void pick()}>
            {bg.kind === "image" ? "Replace image…" : "Choose image…"}
          </button>
          {bg.kind === "image" && (
            <>
              <button type="button" className="btn btn-secondary" onClick={() => choose("none")}>
                Remove
              </button>
              <label className="flex items-center gap-3 text-[length:var(--fs-sm)] text-muted">
                Dim
                <input
                  type="range"
                  min={0}
                  max={DIM_MAX}
                  step={5}
                  value={bg.dim}
                  aria-label="Dim"
                  aria-valuetext={`${bg.dim}%`}
                  onChange={(e) => update({ background: { ...bg, dim: Number(e.target.value) } })}
                  className="w-40 accent-[var(--accent)]"
                />
                <span className="w-10 tabular-nums">{bg.dim}%</span>
              </label>
            </>
          )}
        </div>
      )}
    </div>
  );
}
