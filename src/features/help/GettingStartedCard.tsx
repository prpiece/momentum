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
        <Icon size={15} className="mt-0.5 shrink-0 text-fg-2" />
      ) : (
        <span
          aria-label={done ? "Done" : "Not done yet"}
          className={`mt-0.5 grid size-4 shrink-0 place-items-center rounded-full border ${done ? "border-accent bg-accent text-accent-fg" : "border-border"}`}
        >
          {done && <Check size={11} strokeWidth={3} />}
        </span>
      )}
      <div className="min-w-0">
        <div className={`text-sm ${done ? "text-muted line-through" : "font-medium"}`}>{f.title}</div>
        {!done && <p className="text-xs text-fg-2">{f.howTo}</p>}
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
    <section aria-label="Getting started" className="mx-6 mb-3 rounded-card border border-border bg-raised p-4">
      <div className="mb-1 flex items-center gap-2">
        <h2 className="text-sm font-semibold">Getting started</h2>
        <span className="tabular-nums text-xs text-muted">
          {doneCount} of {items.core.length}
        </span>
        <div className="flex-1" />
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss Getting started"
          className="grid size-7 place-items-center rounded-control text-muted hover:bg-surface-2 hover:text-fg focus-visible:ring-2 focus-visible:ring-accent"
        >
          <X size={15} />
        </button>
      </div>
      {items.fresh.length > 0 && (
        <ul aria-label="New" className="mb-2 border-b border-border pb-2">
          {items.fresh.map((f) => (
            <li key={f.id} className="flex items-start gap-2.5 py-1.5">
              <span className="mt-0.5 rounded-control bg-accent-soft px-1.5 text-[0.65rem] font-semibold uppercase leading-4 text-fg">New</span>
              <div className="min-w-0">
                <div className="text-sm font-medium">{f.title}</div>
                <p className="text-xs text-fg-2">{f.howTo}</p>
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
        className="mt-2 flex items-center gap-1 text-xs text-fg-2 hover:text-fg focus-visible:ring-2 focus-visible:ring-accent"
      >
        <ChevronDown size={14} className={`transition-transform duration-[var(--dur)] ${moreOpen ? "" : "-rotate-90"}`} /> More to try
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
