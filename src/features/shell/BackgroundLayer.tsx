import { useEffect, useState } from "react";
import { imageUrl } from "../../lib/appFiles";
import { useSettings } from "../../stores/settings";

/**
 * The user's background (D222), behind everything. The shell surfaces turn translucent while `html[data-bg]`
 * is set (tokens.css `.shell-bg`); an image gets a `--bg` veil of `dim` percent so text keeps its contrast.
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
  const on = bg.kind === "color" || (bg.kind === "image" && !!src);
  useEffect(() => {
    document.documentElement.toggleAttribute("data-bg", on);
  }, [on]);
  if (!on) return null;
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10" style={{ background: bg.kind === "color" ? bg.hex : "var(--bg)" }}>
      {bg.kind === "image" && src && (
        <>
          <img src={src} alt="" className="size-full object-cover" draggable={false} />
          <div className="absolute inset-0 bg-bg" style={{ opacity: bg.dim / 100 }} />
        </>
      )}
    </div>
  );
}
