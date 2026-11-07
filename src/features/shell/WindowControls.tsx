import { Copy, Minus, PictureInPicture2, Square, X } from "lucide-react";
import { useEffect, useState } from "react";
import { isTauri } from "../../db/client";

type Win = Awaited<ReturnType<typeof getWindow>>;
const invoke = async (cmd: string) => (await import("@tauri-apps/api/core")).invoke(cmd);
const getWindow = async () => (await import("@tauri-apps/api/window")).getCurrentWindow();

/**
 * Minimize / maximize / close for the undecorated main window (`decorations: false`).
 * Dragging and double-click-to-maximize come from `data-tauri-drag-region` on the header.
 * Close goes through CloseRequested, so close-to-tray still applies.
 */
export function WindowControls() {
  const [win, setWin] = useState<Win | null>(null);
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!isTauri) return;
    let unlisten: (() => void) | undefined;
    let alive = true;
    void getWindow().then(async (w) => {
      if (!alive) return;
      setWin(w);
      setMaximized(await w.isMaximized());
      unlisten = await w.onResized(async () => setMaximized(await w.isMaximized()));
    });
    return () => {
      alive = false;
      unlisten?.();
    };
  }, []);

  if (!win) return null;
  const btn = "grid h-8 w-10 place-items-center rounded-control text-muted transition-colors duration-[var(--dur)] hover:bg-surface-2 hover:text-fg";
  return (
    <div className="ml-auto flex shrink-0 items-center gap-0.5">
      <button type="button" aria-label="Mini window" title="Mini window" onClick={() => void invoke("toggle_mini")} className={btn}>
        <PictureInPicture2 size={16} />
      </button>
      <button type="button" aria-label="Minimize" title="Minimize" onClick={() => void win.minimize()} className={btn}>
        <Minus size={16} />
      </button>
      <button type="button" aria-label={maximized ? "Restore" : "Maximize"} title={maximized ? "Restore" : "Maximize"} onClick={() => void win.toggleMaximize()} className={btn}>
        {maximized ? <Copy size={13} className="-scale-x-100" /> : <Square size={13} />}
      </button>
      <button type="button" aria-label="Close" title="Close" onClick={() => void win.close()} className={`${btn} hover:bg-danger! hover:text-white!`}>
        <X size={17} />
      </button>
    </div>
  );
}
