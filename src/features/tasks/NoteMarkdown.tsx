import { useEffect, useState } from "react";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import { imageUrl } from "../../lib/appFiles";

const PREFIX = "attachment:";

function NoteImage({ src, alt }: { src: string; alt: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    void imageUrl("attachments", src.slice(PREFIX.length)).then((u) => live && setUrl(u));
    return () => {
      live = false;
    };
  }, [src]);
  if (!url || failed) return <span className="rounded-sm bg-hover px-1.5 py-0.5 text-xs text-muted">{alt || "Image"} (unavailable)</span>;
  return <img src={url} alt={alt} onError={() => setFailed(true)} className="max-w-full rounded-md" />;
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
