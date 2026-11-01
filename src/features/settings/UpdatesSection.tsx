import { formatDistanceToNow } from "date-fns";
import { Download, RefreshCw } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { checkForUpdate, installUpdate, useAppVersion, useUpdate, type UpdateStatus } from "../../lib/updater";
import { useSettings } from "../../stores/settings";
import { Line, Switch } from "./NotificationSection";

function statusLine(s: UpdateStatus): string {
  switch (s.kind) {
    case "idle":
      return "Not checked yet this session";
    case "checking":
      return "Checking…";
    case "current":
      return "Up to date";
    case "available":
      return `Version ${s.version} is available`;
    case "downloading":
      return s.progress === null ? `Downloading ${s.version}…` : `Downloading ${s.version}… ${Math.round(s.progress * 100)}%`;
    case "error":
      return s.message;
  }
}

/** Settings → Updates (D66): the version, the last check, release notes and download progress. */
export function UpdatesSection() {
  const version = useAppVersion();
  const { status, checkedAt } = useUpdate();
  const checkUpdates = useSettings((s) => s.settings.checkUpdates);
  const update = useSettings((s) => s.update);
  const busy = status.kind === "checking" || status.kind === "downloading";
  const btn = "flex h-9 items-center gap-2 rounded-sm border border-border px-3 text-sm hover:bg-hover focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium">Momentum {version ?? "(browser preview)"}</div>
          <div className={`text-xs ${status.kind === "error" ? "text-danger" : status.kind === "available" ? "font-medium text-accent" : "text-muted"}`} role="status">
            {statusLine(status)}
            {checkedAt && status.kind !== "checking" && ` · checked ${formatDistanceToNow(new Date(checkedAt), { addSuffix: true })}`}
          </div>
        </div>
        {status.kind === "available" ? (
          <button type="button" onClick={() => void installUpdate()} className={`${btn} border-accent bg-accent text-accent-fg hover:bg-accent-hover`}>
            <Download size={15} /> Update and restart
          </button>
        ) : (
          <button type="button" disabled={busy} onClick={() => void checkForUpdate(true)} className={btn}>
            <RefreshCw size={15} className={status.kind === "checking" ? "animate-spin" : ""} /> Check now
          </button>
        )}
      </div>
      {status.kind === "downloading" && (
        <div className="h-1.5 overflow-hidden rounded-full bg-hover" role="progressbar" aria-label="Download progress" aria-valuenow={status.progress === null ? undefined : Math.round(status.progress * 100)}>
          <div className={`h-full rounded-full bg-accent transition-[width] duration-[var(--dur)] ${status.progress === null ? "w-1/3 animate-pulse" : ""}`} style={status.progress === null ? undefined : { width: `${status.progress * 100}%` }} />
        </div>
      )}
      {status.kind === "available" && status.notes && (
        <div className="prose-md max-h-64 overflow-y-auto rounded-md border border-border bg-surface p-3 text-sm text-fg-2">
          <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted">What's new in {status.version}</div>
          <ReactMarkdown>{status.notes}</ReactMarkdown>
        </div>
      )}
      <Line title="Check at launch" hint="The update check is Momentum's only network call.">
        <Switch checked={checkUpdates} onChange={(v) => update({ checkUpdates: v })} label="Check for updates at launch" />
      </Line>
    </div>
  );
}
