import { useEffect, useState } from "react";
import { ColorPicker } from "../../components/ui/ColorPicker";
import { Segmented } from "../../components/ui/Segmented";
import { Switch } from "../../components/ui/Switch";
import { isTauri } from "../../db/client";
import { DIM_DEFAULT, DIM_MAX, type Background } from "../../domain/types";
import { deleteImage, IMAGE_EXTS, imageUrl, importImage, listImages, newImageName } from "../../lib/appFiles";
import { useSettings } from "../../stores/settings";
import { useSettingsDraft } from "../../stores/settingsDraft";
import { toast } from "../../stores/ui";

type Mode = Background["kind"];
const DEFAULT_HEX = "#2f6fed";

/**
 * Deletes every stored background image except the saved one. Picking copies the file at once but the choice
 * waits for Save (D232), so the orphan (a replaced image, or one picked and then discarded) goes after Save or Discard.
 */
export async function pruneBackgrounds() {
  if (!isTauri) return;
  const bg = useSettings.getState().settings.background;
  const keep = bg.kind === "image" ? bg.file : null;
  try {
    for (const { name } of await listImages("backgrounds")) if (name !== keep) await deleteImage("backgrounds", name);
  } catch (err) {
    console.error("Background cleanup failed", err);
  }
}

/** The chosen image, so a file that won't load is seen here and not only on a task list. */
function Preview({ file }: { file: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setFailed(false);
    void imageUrl("backgrounds", file).then(setSrc);
  }, [file]);
  if (failed) return <span className="text-[length:var(--fs-sm)] text-danger">This image couldn't be loaded. Choose another.</span>;
  return src ? <img src={src} alt="Background preview" className="h-10 w-16 rounded-control border border-border object-cover" onError={() => setFailed(true)} /> : null;
}

/** Settings → Appearance → Background (D222): none, a colour, or an image copied into the app's data folder. Shown on task lists only. */
export function BackgroundSection() {
  const { draft, update } = useSettingsDraft();
  const bg = draft.background;
  // "Image" with no file picked yet has no setting to show, so only that one step is local state.
  const [choosingImage, setChoosingImage] = useState(false);
  const mode: Mode = bg.kind === "image" || choosingImage ? "image" : bg.kind;
  const [lastHex, setLastHex] = useState(bg.kind === "color" ? bg.hex : DEFAULT_HEX);

  const choose = (m: Mode) => {
    setChoosingImage(m === "image");
    if (m === "none") update({ background: { kind: "none" } });
    else if (m === "color") update({ background: { kind: "color", hex: lastHex } });
  };
  const pick = async () => {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const path = await open({ multiple: false, directory: false, filters: [{ name: "Images", extensions: [...IMAGE_EXTS] }] });
      if (typeof path !== "string") return;
      const file = newImageName(path);
      if (!file) return toast("That isn't a PNG, JPG, GIF or WebP image.");
      await importImage("backgrounds", file, path);
      update({ background: { kind: "image", file, dim: bg.kind === "image" ? bg.dim : DIM_DEFAULT, blur: bg.kind === "image" ? bg.blur : true } });
    } catch (err) {
      toast(typeof err === "string" ? err : "Couldn't use that image.");
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <span className="font-medium">Task list background</span>
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
          {bg.kind === "image" && <Preview file={bg.file} />}
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
              <span className="flex items-center gap-2.5 text-[length:var(--fs-sm)] text-muted">
                Blur
                <Switch checked={bg.blur} onChange={(blur) => update({ background: { ...bg, blur } })} label="Blur" />
              </span>
            </>
          )}
        </div>
      )}
      <p className="text-[length:var(--fs-sm)] text-muted">Shown behind your task lists. The sidebar and other pages stay plain.</p>
    </div>
  );
}
