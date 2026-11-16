import { X } from "lucide-react";
import { useEffect, useState } from "react";
import { Dialog, IconButton } from "../../components/ui/Dialog";
import { clipText, previewKind } from "../../domain/attachmentPreview";
import { imageUrl } from "../../lib/appFiles";
import { ImageLightbox } from "./ImageLightbox";

/**
 * Preview of a stored attachment (FEAT-25): a PDF in the webview's own viewer, a .txt as text, an image in the lightbox.
 * Mount: `{open && <AttachmentPreview name="<file in attachments/>" onClose={...} />}`.
 */
export function AttachmentPreview({ name, onClose }: { name: string; onClose: () => void }) {
  const kind = previewKind(name);
  const [url, setUrl] = useState<string | null>(null);
  const [text, setText] = useState<{ text: string; cut: boolean } | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    (async () => {
      const u = await imageUrl("attachments", name);
      if (!u) throw new Error("no file");
      if (!live) return;
      setUrl(u);
      if (kind === "text") {
        const res = await fetch(u);
        if (!res.ok) throw new Error(String(res.status));
        const t = clipText(await res.text());
        if (live) setText(t);
      }
    })().catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [name, kind]);

  if (kind === "image") return url ? <ImageLightbox src={url} alt={name} onClose={onClose} /> : null;
  return (
    <Dialog label="File preview" width="max-w-[min(1000px,100%)]" onClose={onClose}>
      <div className="flex h-[calc(100dvh-2rem)] max-h-[860px] flex-col">
        <header className="flex h-12 shrink-0 items-center border-b border-border pl-5 pr-2">
          <span className="min-w-0 flex-1 truncate text-[length:var(--fs-sm)] text-muted">{name}</span>
          <IconButton className="btn-sm" label="Close" onClick={onClose}>
            <X size={16} strokeWidth={1.75} />
          </IconButton>
        </header>
        <div className="min-h-0 flex-1 overflow-auto bg-surface">
          {failed || !kind ? (
            <p className="p-6 text-sm text-fg-2">This file can&apos;t be previewed.</p>
          ) : kind === "pdf" ? (
            url && <iframe src={url} title={name} className="h-full w-full border-0" />
          ) : (
            text && (
              <>
                <pre className="whitespace-pre-wrap break-words p-5 text-sm">{text.text}</pre>
                {text.cut && <p className="px-5 pb-5 text-xs text-muted">Only the start of this file is shown.</p>}
              </>
            )
          )}
        </div>
      </div>
    </Dialog>
  );
}
