import { dismissUpdatePrompt, installUpdate, useUpdate } from "../../lib/updater";

/** The launch check found a release (D67): a compact floating card in the toast style, not a modal. */
export function UpdatePrompt() {
  const { status, prompt } = useUpdate();
  if (!prompt || (status.kind !== "available" && status.kind !== "downloading")) return null;
  const downloading = status.kind === "downloading";
  const pct = downloading && status.progress !== null ? Math.round(status.progress * 100) : null;
  return (
    <div role="status" aria-label={`Momentum ${status.version} is available`} className="layer layer-raised toast anim-rise fixed bottom-5 right-5 z-50 max-w-[min(420px,calc(100vw-32px))] max-[719px]:inset-x-4 max-[719px]:right-4">
      <span className="min-w-0 px-1">
        {downloading ? `Downloading ${status.version}${pct === null ? "…" : `… ${pct}%`}` : `Momentum ${status.version} is ready to install`}
      </span>
      {!downloading && (
        <button type="button" className="btn btn-ghost btn-sm toast-act shrink-0" onClick={() => void installUpdate()}>
          Update
        </button>
      )}
      <button type="button" className="btn btn-ghost btn-sm shrink-0 text-muted" onClick={dismissUpdatePrompt}>
        {downloading ? "Hide" : "Later"}
      </button>
    </div>
  );
}
