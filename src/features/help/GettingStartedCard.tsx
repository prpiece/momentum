import { Check, ChevronDown, X } from "lucide-react";
import { useMemo, useState } from "react";
import { Collapse } from "../../components/ui/Collapse";
import { type Feature, gettingStartedItems } from "../../domain/features";
import { useAppVersion } from "../../lib/updater";
import { useSettings } from "../../stores/settings";
import { FEATURE_ICON } from "./featureIcons";

function Item({ f, done }: { f: Feature; done?: boolean }) {
  const Icon = FEATURE_ICON[f.icon];
  return (
    <li className="flex items-start gap-2.5 py-1.5">
      {done === undefined ? (
        <Icon size={16} strokeWidth={1.75} className="mt-0.5 shrink-0 text-fg-2" />
      ) : (
        <span
          aria-label={done ? "Done" : "Not done yet"}
          className={`mt-0.5 grid size-4 shrink-0 place-items-center rounded-full border-[1.5px] ${done ? "border-muted bg-muted text-surface" : "border-control-border"}`}
        >
          {done && <Check size={10} strokeWidth={2.75} />}
        </span>
      )}
      <div className="min-w-0">
        <div className={done ? "text-muted line-through" : "font-medium"}>{f.title}</div>
        {!done && <p className="text-[length:var(--fs-sm)] text-muted">{f.howTo}</p>}
      </div>
    </li>
  );
}

/** The dismissable card at the top of Today (D168): six first things, each ticked when you do it. */
export function GettingStartedCard() {
  const gs = useSettings((s) => s.settings.gettingStarted);
  const update = useSettings((s) => s.update);
  // No version outside Tauri (browser dev): nothing counts as new.
  const version = useAppVersion() ?? "0.0.0";
  const [moreOpen, setMoreOpen] = useState(false);
  const items = useMemo(() => gettingStartedItems(gs, version), [gs, version]);
  if (!items.visible) return null;
  const doneCount = items.core.filter((f) => gs.done.includes(f.id)).length;
  const dismiss = () => update({ gettingStarted: { ...gs, dismissed: true, seenVersion: version === "0.0.0" ? gs.seenVersion : version } });
  return (
    <section aria-label="Getting started" className="mb-3 rounded-card border border-border bg-surface p-4">
      <div className="mb-1 flex items-center gap-2">
        <h2 className="text-[length:var(--fs-lg)] font-semibold">Getting started</h2>
        <span className="text-[length:var(--fs-sm)] tabular-nums text-muted">
          {doneCount} of {items.core.length}
        </span>
        <div className="flex-1" />
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss Getting started"
          className="btn btn-ghost btn-sm icon-btn text-muted"
        >
          <X size={15} />
        </button>
      </div>
      {items.fresh.length > 0 && (
        <ul aria-label="New" className="mb-2 border-b border-border pb-2">
          {items.fresh.map((f) => (
            <li key={f.id} className="flex items-start gap-2.5 py-1.5">
              <span className="t-label mt-0.5 rounded-xs bg-accent-soft px-1.5 text-fg">New</span>
              <div className="min-w-0">
                <div className="font-medium">{f.title}</div>
                <p className="text-[length:var(--fs-sm)] text-muted">{f.howTo}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
      <ul className="grid gap-x-6 sm:grid-cols-2">
        {items.core.map((f) => (
          <Item key={f.id} f={f} done={gs.done.includes(f.id)} />
        ))}
      </ul>
      <button
        type="button"
        aria-expanded={moreOpen}
        onClick={() => setMoreOpen((o) => !o)}
        className="btn btn-ghost btn-sm mt-1 -ml-2"
      >
        <ChevronDown size={16} strokeWidth={1.75} className={`transition-transform duration-[var(--dur)] ${moreOpen ? "" : "-rotate-90"}`} /> More to try
      </button>
      <Collapse open={moreOpen}>
        <ul className="grid gap-x-6 pt-1 sm:grid-cols-2">
          {items.more.map((f) => (
            <Item key={f.id} f={f} />
          ))}
        </ul>
      </Collapse>
    </section>
  );
}
