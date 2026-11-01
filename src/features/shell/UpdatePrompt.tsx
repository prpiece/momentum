import { Download } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { Button, Dialog } from "../../components/ui/Dialog";
import { dismissUpdatePrompt, installUpdate, useUpdate } from "../../lib/updater";

/** The launch check found a release (D67): ask in a dialog, where it can't be missed. */
export function UpdatePrompt() {
  const { status, prompt } = useUpdate();
  if (!prompt || (status.kind !== "available" && status.kind !== "downloading")) return null;
  const downloading = status.kind === "downloading";
  const pct = downloading && status.progress !== null ? Math.round(status.progress * 100) : null;
  return (
    <Dialog label={`Momentum ${status.version} is available`} onClose={dismissUpdatePrompt} width="max-w-lg">
      <div className="p-6">
        <div className="mb-4 flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-full bg-accent-soft text-accent">
            <Download size={20} />
          </span>
          <div>
            <h2 className="text-lg font-bold tracking-tight">Update available</h2>
            <p className="text-xs text-muted">Momentum {status.version} is ready to install</p>
          </div>
        </div>
        {status.kind === "available" && status.notes && (
          <div className="prose-md max-h-[45vh] overflow-y-auto rounded-md border border-border bg-surface p-3 text-sm text-fg-2">
            <ReactMarkdown>{status.notes}</ReactMarkdown>
          </div>
        )}
        {downloading && (
          <div className="space-y-2" role="status">
            <div className="text-sm text-fg-2">{pct === null ? "Downloading…" : `Downloading… ${pct}%`} Momentum restarts when it's done.</div>
            <div className="h-1.5 overflow-hidden rounded-full bg-hover" role="progressbar" aria-label="Download progress" aria-valuenow={pct ?? undefined}>
              <div className={`h-full rounded-full bg-accent transition-[width] duration-[var(--dur)] ${pct === null ? "w-1/3 animate-pulse" : ""}`} style={pct === null ? undefined : { width: `${pct}%` }} />
            </div>
          </div>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <Button onClick={dismissUpdatePrompt}>{downloading ? "Hide" : "Later"}</Button>
          {!downloading && (
            <Button variant="primary" onClick={() => void installUpdate()}>
              Update and restart
            </Button>
          )}
        </div>
      </div>
    </Dialog>
  );
}
