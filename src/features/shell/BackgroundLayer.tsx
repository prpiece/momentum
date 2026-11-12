import { useEffect, useState } from "react";
import { imageUrl } from "../../lib/appFiles";
import { useSettings } from "../../stores/settings";
import { toast } from "../../stores/ui";

/**
 * The user's background (D222), behind the task list only: the sidebar and other pages stay solid.
 * An image gets a `--bg` veil of `dim` percent so text keeps its contrast, and a small blur unless `blur` is off.
 */
export function BackgroundLayer() {
  const bg = useSettings((s) => s.settings.background);
  const file = bg.kind === "image" ? bg.file : null;
  const [url, setUrl] = useState<{ file: string; src: string } | null>(null);
  useEffect(() => {
    if (!file) return;
    let live = true;
    void imageUrl("backgrounds", file).then((src) => live && src && setUrl({ file, src }));
    return () => {
      live = false;
    };
  }, [file]);
  const src = url?.file === file ? url?.src : null;
  if (bg.kind === "none") return null;
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden" style={{ background: bg.kind === "color" ? bg.hex : "var(--bg)" }}>
      {bg.kind === "image" && src && (
        <>
          <img
            src={src}
            alt=""
            className={`size-full object-cover ${bg.blur ? "scale-105 blur-[6px]" : ""}`}
            draggable={false}
            onError={() => toast("The background image couldn't be loaded. Choose it again in Settings → Appearance.")}
          />
          <div className="absolute inset-0 bg-bg" style={{ opacity: bg.dim / 100 }} />
        </>
      )}
    </div>
  );
}
