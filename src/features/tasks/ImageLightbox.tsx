import { Maximize, X, ZoomIn, ZoomOut } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Dialog, IconButton } from "../../components/ui/Dialog";

const MIN = 0.25;
const MAX = 8;
const STEP = 1.25;

/** Large view of a note image (D214): zoom with the buttons, + / - / 0 or Ctrl + wheel; drag to pan once zoomed. 100% is the fitted size. */
export function ImageLightbox({ src, alt, onClose }: { src: string; alt: string; onClose: () => void }) {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const stage = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  const zoomBy = (f: number) => setZoom((z) => Math.min(MAX, Math.max(MIN, z * f)));
  const reset = () => (setZoom(1), setPan({ x: 0, y: 0 }));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const f = e.key === "+" || e.key === "=" ? STEP : e.key === "-" ? 1 / STEP : 0;
      if (!f && e.key !== "0") return;
      // Capture phase: keeps 0-3 and friends from reaching the app's task shortcuts.
      e.stopPropagation();
      e.preventDefault();
      if (f) zoomBy(f);
      else reset();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, []);

  // Native listener: React's wheel handler is passive, so it could not stop the webview's own page zoom.
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      zoomBy(e.deltaY < 0 ? STEP : 1 / STEP);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  return (
    <Dialog label="Image viewer" width="max-w-[min(1100px,100%)]" onClose={onClose}>
      <div className="flex h-[calc(100dvh-2rem)] max-h-[860px] flex-col">
        <header className="flex h-12 shrink-0 items-center gap-0.5 border-b border-border pl-5 pr-2">
          <span className="min-w-0 flex-1 truncate text-[length:var(--fs-sm)] text-muted">{alt || "Image"}</span>
          <span className="mr-2 w-12 text-right text-[length:var(--fs-sm)] tabular-nums text-fg-2" aria-live="polite">
            {Math.round(zoom * 100)}%
          </span>
          <IconButton className="btn-sm" label="Zoom out" onClick={() => zoomBy(1 / STEP)}>
            <ZoomOut size={16} strokeWidth={1.75} />
          </IconButton>
          <IconButton className="btn-sm" label="Zoom in" onClick={() => zoomBy(STEP)}>
            <ZoomIn size={16} strokeWidth={1.75} />
          </IconButton>
          <IconButton className="btn-sm" label="Fit to window" onClick={reset}>
            <Maximize size={16} strokeWidth={1.75} />
          </IconButton>
          <IconButton className="btn-sm" label="Close" onClick={onClose}>
            <X size={16} strokeWidth={1.75} />
          </IconButton>
        </header>
        <div
          ref={stage}
          className={`grid min-h-0 flex-1 place-items-center overflow-hidden bg-surface p-4 ${zoom > 1 ? "cursor-grab active:cursor-grabbing" : ""}`}
          onPointerDown={(e) => {
            if (zoom <= 1) return;
            e.currentTarget.setPointerCapture(e.pointerId);
            drag.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y };
          }}
          onPointerMove={(e) => drag.current && setPan({ x: drag.current.px + e.clientX - drag.current.x, y: drag.current.py + e.clientY - drag.current.y })}
          onPointerUp={() => (drag.current = null)}
          onPointerCancel={() => (drag.current = null)}
          onDoubleClick={reset}
        >
          <img
            src={src}
            alt={alt}
            draggable={false}
            style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}
            className="max-h-full max-w-full select-none object-contain"
          />
        </div>
      </div>
    </Dialog>
  );
}
