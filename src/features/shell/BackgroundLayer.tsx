import { useEffect, useState } from "react";
import { gradientCss } from "../../domain/backgrounds";
import { imageUrl } from "../../lib/appFiles";
import { useSettings } from "../../stores/settings";

/** Behind the whole window (D79): gradient or image, blurred, with a dim toward the theme's base. Also flags `html[data-bg]` so surfaces turn translucent. */
export function BackgroundLayer() {
  const bg = useSettings((s) => s.settings.background);
  const dim = useSettings((s) => s.settings.backgroundDim);
  const blur = useSettings((s) => s.settings.backgroundBlur);
  const [url, setUrl] = useState<string | null>(null);
  const name = bg.kind === "image" ? bg.name : null;

  useEffect(() => {
    let live = true;
    setUrl(null);
    if (name) void imageUrl("backgrounds", name).then((u) => live && setUrl(u));
    return () => {
      live = false;
    };
  }, [name]);

  const shown = bg.kind === "gradient" || (bg.kind === "image" && url !== null);
  useEffect(() => {
    document.documentElement.toggleAttribute("data-bg", shown);
    return () => document.documentElement.removeAttribute("data-bg");
  }, [shown]);

  if (!shown) return null;
  // The image is oversized by the blur radius so the blurred edges stay off screen.
  const inset = -2 * blur;
  const layer = bg.kind === "gradient" ? { background: gradientCss(bg.id) } : { backgroundImage: `url("${url}")`, backgroundSize: "cover", backgroundPosition: "center" };
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
      <div className="absolute" style={{ ...layer, inset, filter: `blur(${blur}px)` }} />
      <div className="absolute inset-0" style={{ background: `rgb(var(--dim-rgb) / ${dim}%)` }} />
    </div>
  );
}
