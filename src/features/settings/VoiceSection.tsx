import { Download, Trash2, X } from "lucide-react";
import { useEffect } from "react";
import { isTauri } from "../../db/client";
import type { ModelStatus } from "../../domain/voice";
import { cancelVoiceModelDownload, downloadVoiceModel, MODEL_DISK_MB, MODEL_DOWNLOAD_MB, refreshVoiceModel, removeVoiceModel, useVoiceModel } from "../../lib/voice";

function statusLine(s: ModelStatus): string {
  switch (s.state) {
    case "missing":
      return "Not installed";
    case "downloading":
      return `Downloading… ${Math.round(s.received / 1e6)} of ${Math.round(s.total / 1e6)} MB`;
    case "verifying":
      return "Verifying and unpacking…";
    case "ready":
      return "Ready. Speech is recognized on this computer.";
    case "error":
      return s.message;
  }
}

/** Settings → Voice (D81): the opt-in voice model download. */
export function VoiceSection() {
  const status = useVoiceModel((s) => s.status);
  useEffect(() => {
    void refreshVoiceModel().catch((e) => console.error("Voice model status failed", e));
  }, []);
  const btn = "flex h-9 items-center gap-2 rounded-sm border border-border px-3 text-sm hover:bg-hover focus-visible:ring-2 focus-visible:ring-accent";

  if (!isTauri) return <p className="text-sm text-muted">Voice quick-add needs the desktop app.</p>;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium">Voice model</div>
          <div className={`text-xs ${status.state === "error" ? "text-danger" : "text-muted"}`} role="status">
            {statusLine(status)}
          </div>
        </div>
        {(status.state === "missing" || status.state === "error") && (
          <button type="button" onClick={downloadVoiceModel} className={`${btn} border-accent bg-accent text-accent-fg hover:bg-accent-hover`}>
            <Download size={15} /> {status.state === "error" ? "Try again" : `Download (~${MODEL_DOWNLOAD_MB} MB)`}
          </button>
        )}
        {status.state === "downloading" && (
          <button type="button" onClick={cancelVoiceModelDownload} className={btn}>
            <X size={15} /> Cancel
          </button>
        )}
        {status.state === "ready" && (
          <button type="button" onClick={() => void removeVoiceModel()} className={btn}>
            <Trash2 size={15} /> Remove
          </button>
        )}
      </div>
      {(status.state === "downloading" || status.state === "verifying") && (
        <div className="h-1.5 overflow-hidden rounded-full bg-hover" role="progressbar" aria-label="Voice model download" aria-valuenow={status.state === "downloading" ? Math.round((status.received / status.total) * 100) : undefined}>
          <div
            className={`h-full rounded-full bg-accent transition-[width] duration-[var(--dur)] ${status.state === "verifying" ? "w-full animate-pulse" : ""}`}
            style={status.state === "downloading" ? { width: `${(status.received / status.total) * 100}%` } : undefined}
          />
        </div>
      )}
      {status.state !== "ready" && (
        <p className="text-xs text-muted">
          A one-time download of about {MODEL_DOWNLOAD_MB} MB ({MODEL_DISK_MB} MB on disk). After that, voice works offline and nothing you say leaves this computer.
        </p>
      )}
    </div>
  );
}
