import { Copy, Maximize2 } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import { fetchAttachment, imageUrl } from "../../lib/appFiles";
import { toast } from "../../stores/ui";
import { AttachmentPreview } from "./AttachmentPreview";
import { ImageLightbox } from "./ImageLightbox";

const PREFIX = "attachment:";

/** `loading` also covers downloading a file this device lacks (D291); a `fetched` file that still won't load has failed. */
type Shown = { kind: "loading" } | { kind: "local" | "fetched"; url: string } | { kind: "failed" };

function NoteImage({ src, alt }: { src: string; alt: string }) {
  const name = src.slice(PREFIX.length);
  const [shown, setShown] = useState<Shown>({ kind: "loading" });
  const [big, setBig] = useState(false);
  useEffect(() => {
    let live = true;
    setShown({ kind: "loading" });
    void imageUrl("attachments", name).then((u) => live && setShown(u ? { kind: "local", url: u } : { kind: "failed" }));
    return () => {
      live = false;
    };
  }, [name]);
  // Not on this device: fetch it once from the server, then load the file again (the query busts the failed load).
  const missing = () => {
    if (shown.kind !== "local") return setShown({ kind: "failed" });
    const url = shown.url;
    setShown({ kind: "loading" });
    void fetchAttachment(name).then((ok) => setShown(ok ? { kind: "fetched", url: `${url}?v=${Date.now()}` } : { kind: "failed" }));
  };
  const chip = "rounded-control bg-surface-2 px-1.5 py-0.5 text-xs text-muted";
  if (shown.kind === "loading") return <span className={chip} aria-busy="true">{alt || "Image"} (loading…)</span>;
  if (shown.kind === "failed") return <span className={chip}>{alt || "Image"} (unavailable)</span>;
  const url = shown.url;
  const btn =
    "grid size-7 place-items-center rounded-control bg-raised/90 text-fg-2 opacity-0 shadow-float transition-opacity hover:text-fg focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-accent group-hover/img:opacity-100";
  return (
    // The stops keep clicks and keys (also from the portalled viewer) from reaching the note's click-to-edit.
    <span className="group/img relative my-2 block w-fit" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
      <img src={url} alt={alt} onError={missing} onClick={() => setBig(true)} className="max-h-64 max-w-full cursor-zoom-in rounded-card object-contain" />
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

/** `[name](attachment:file.pdf)`: a button that opens the in-app preview (FEAT-25). Stops clicks so the note doesn't switch to editing. */
function NoteFile({ href, children }: { href: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <span onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
      <button type="button" onClick={() => setOpen(true)} className="text-accent-text underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-accent">
        {children}
      </button>
      {open && <AttachmentPreview name={href.slice(PREFIX.length)} onClose={() => setOpen(false)} />}
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
    // GFM for tables (D267); raw HTML stays off (react-markdown escapes it without rehype-raw).
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      urlTransform={(u) => (u.startsWith(PREFIX) ? u : defaultUrlTransform(u))}
      components={{ a: ({ href, children }) => (href?.startsWith(PREFIX) ? <NoteFile href={href}>{children}</NoteFile> : <a href={href}>{children}</a>), img: ({ src, alt }) => (typeof src === "string" && src.startsWith(PREFIX) ? <NoteImage src={src} alt={alt ?? ""} /> : <span className="text-muted">{alt || "Image"}</span>) }}
    >
      {children}
    </ReactMarkdown>
  );
}
