import { Copy, Download } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button, Dialog } from "../../components/ui/Dialog";
import { Segmented } from "../../components/ui/Segmented";
import { isTauri } from "../../db/client";
import { todayLocal } from "../../domain/dates";
import { shareSummary, type SharePeriod } from "../../domain/shareCard";
import { shareInputs } from "../../lib/celebrate";
import { useData } from "../../stores/data";
import { useFocus } from "../../stores/focus";
import { useSettings } from "../../stores/settings";
import { toast } from "../../stores/ui";
import { CARD_H, CARD_W, renderShareCard } from "./drawShareCard";

const OPTIONS = [
  { value: "week", label: "This week" },
  { value: "month", label: "This month" },
] as const;

/** Preview of the shareable stats card (D93), with Save PNG and Copy image. */
export function ShareDialog({ onClose }: { onClose: () => void }) {
  const tasks = useData((s) => s.tasks);
  const sessions = useFocus((s) => s.sessions);
  const ws = useSettings((s) => s.settings.weekStart);
  const [period, setPeriod] = useState<SharePeriod>("week");
  const canvas = useRef<HTMLCanvasElement>(null);
  const png = useRef<Blob | null>(null);
  const inputs = useMemo(shareInputs, []);
  const summary = useMemo(
    () => shareSummary(Object.values(tasks), Object.values(sessions), todayLocal(), period, ws, inputs.isPerfect, inputs.counts),
    [tasks, sessions, period, ws, inputs],
  );

  useEffect(() => {
    let live = true;
    png.current = null;
    if (canvas.current) void renderShareCard(canvas.current, summary).then((b) => live && (png.current = b));
    return () => void (live = false);
  }, [summary]);

  const blob = () => png.current ?? new Promise<Blob | null>((r) => canvas.current?.toBlob(r, "image/png"));

  async function save() {
    try {
      const data = await blob();
      if (!data) throw new Error("no image");
      const { save: pick } = await import("@tauri-apps/plugin-dialog");
      const picked = await pick({ defaultPath: `momentum-${period}-${todayLocal()}.png`, filters: [{ name: "PNG image", extensions: ["png"] }] });
      if (!picked) return;
      const path = picked.toLowerCase().endsWith(".png") ? picked : `${picked}.png`;
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("write_png", { path, bytes: Array.from(new Uint8Array(await data.arrayBuffer())) });
      toast("Saved the image");
    } catch (e) {
      toast(`Couldn't save the image: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async function copy() {
    try {
      const data = await blob();
      if (!data) throw new Error("no image");
      await navigator.clipboard.write([new ClipboardItem({ "image/png": data })]);
      toast("Copied the image");
    } catch {
      toast("Couldn't copy the image. Try Save PNG instead.");
    }
  }

  return (
    <Dialog onClose={onClose} label="Share your stats" width="max-w-3xl">
      <div className="flex flex-col gap-4 p-5">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-base font-semibold">Share your stats</h2>
          <div className="ml-auto">
            <Segmented name="share-period" label="Period" value={period} options={OPTIONS} onChange={setPeriod} />
          </div>
        </div>
        <canvas ref={canvas} width={CARD_W} height={CARD_H} role="img" aria-label="Preview of your stats card" className="w-full rounded-md border border-border" style={{ aspectRatio: `${CARD_W} / ${CARD_H}` }} />
        <p className="text-xs text-muted">Only numbers and charts. No task or list names.</p>
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Close</Button>
          <Button onClick={() => void copy()}>
            <Copy size={16} /> Copy image
          </Button>
          <Button variant="primary" onClick={() => void save()} disabled={!isTauri} title={isTauri ? undefined : "Available in the desktop app"}>
            <Download size={16} /> Save PNG
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
