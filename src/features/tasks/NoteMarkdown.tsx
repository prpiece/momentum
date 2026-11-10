import { Copy, Maximize2 } from "lucide-react";
import { useEffect, useState } from "react";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import { imageUrl } from "../../lib/appFiles";
import { toast } from "../../stores/ui";
import { ImageLightbox } from "./ImageLightbox";

const PREFIX = "attachment:";

function NoteImage({ src, alt }: { src: string; alt: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [big, setBig] = useState(false);
  useEffect(() => {
    let live = true;
    void imageUrl("attachments", src.slice(PREFIX.length)).then((u) => live && setUrl(u));
    return () => {
      live = false;
    };
  }, [src]);
  if (!url || failed) return <span className="rounded-control bg-surface-2 px-1.5 py-0.5 text-xs text-muted">{alt || "Image"} (unavailable)</span>;
  const btn =
    "grid size-7 place-items-center rounded-control bg-raised/90 text-fg-2 opacity-0 shadow-float transition-opacity hover:text-fg focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-accent group-hover/img:opacity-100";
  return (
    // The stops keep clicks and keys (also from the portalled viewer) from reaching the note's click-to-edit.
    <span className="group/img relative my-2 block w-fit" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
      <img src={url} alt={alt} onError={() => setFailed(true)} onClick={() => setBig(true)} className="max-h-64 max-w-full cursor-zoom-in rounded-card object-contain" />
      <span className="absolute right-1.5 top-1.5 flex gap-1">
        <button type="button" aria-label="Enlarge image" title="Enlarge image" onClick={() => setBig(true)} className={btn}>
          <Maximize2 size={14} />
        </button>
        <button type="button" aria-label="Copy image" title="Copy image" onClick={() => void copyImage(url)} className={btn}>
          <Copy size={14} />
        </button>
      </span>
      {big && <ImageLightbox src={url} alt={alt} onClose={() => setBig(false)} />}
    </span>
  );
}

/** Clipboard images must be PNG, so other formats are redrawn first (D99). */
async function copyImage(url: string) {
  try {
    let blob = await (await fetch(url)).blob();
    if (blob.type !== "image/png") {
      const bmp = await createImageBitmap(blob);
      const c = new OffscreenCanvas(bmp.width, bmp.height);
      c.getContext("2d")?.drawImage(bmp, 0, 0);
      blob = await c.convertToBlob({ type: "image/png" });
    }
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
    toast("Copied the image");
  } catch {
    toast("Couldn't copy the image.");
  }
}

/** Markdown for task notes: keeps `attachment:` image URLs and resolves them to app-data files (D78). */
export function NoteMarkdown({ children }: { children: string }) {
  return (
    <ReactMarkdown
      urlTransform={(u) => (u.startsWith(PREFIX) ? u : defaultUrlTransform(u))}
      components={{ img: ({ src, alt }) => (typeof src === "string" && src.startsWith(PREFIX) ? <NoteImage src={src} alt={alt ?? ""} /> : <span className="text-muted">{alt || "Image"}</span>) }}
    >
      {children}
    </ReactMarkdown>
  );
}
