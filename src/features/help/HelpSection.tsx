import { Search } from "lucide-react";
import { useMemo, useState } from "react";
import { FEATURE_GROUPS, searchFeatures } from "../../domain/features";
import { useSettings } from "../../stores/settings";
import { go } from "../../stores/ui";
import { openTour } from "../shell/Tour";
import { CommandChips } from "./CommandChips";
import { FEATURE_ICON } from "./featureIcons";

/** Settings → Help: every command, shortcut and token, searchable (D169). */
export function HelpSection() {
  const [q, setQ] = useState("");
  const gs = useSettings((s) => s.settings.gettingStarted);
  const update = useSettings((s) => s.update);
  const found = useMemo(() => searchFeatures(q).filter((f) => !f.requires), [q]);
  return (
    <div className="space-y-4">
      <label className="flex h-9 items-center gap-2 rounded-control border border-border bg-surface px-3 focus-within:border-accent">
        <Search size={15} className="text-muted" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search commands, shortcuts and tokens"
          aria-label="Search help"
          className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted"
        />
      </label>
      {found.length === 0 && <p className="text-sm text-muted">Nothing matches “{q}”.</p>}
      {FEATURE_GROUPS.map((group) => {
        const rows = found.filter((f) => f.group === group);
        if (!rows.length) return null;
        return (
          <section key={group}>
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted">{group}</h3>
            <ul className="divide-y divide-border">
              {rows.map((f) => {
                const Icon = FEATURE_ICON[f.icon];
                return (
                  <li key={f.id} className="flex gap-3 py-2.5">
                    <Icon size={16} className="mt-0.5 shrink-0 text-fg-2" />
                    <div className="min-w-0 flex-1 space-y-1.5">
                      <div className="text-sm font-medium">{f.title}</div>
                      <p className="text-xs text-fg-2">{f.howTo}</p>
                      <CommandChips commands={f.commands} />
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
      <div className="flex flex-wrap gap-2 border-t border-border pt-4">
        <button
          type="button"
          onClick={() => {
            update({ gettingStarted: { ...gs, dismissed: false } });
            go("today");
          }}
          className="h-9 rounded-control border border-border px-3 text-sm hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-accent"
        >
          Show Getting started
        </button>
        <button type="button" onClick={openTour} className="h-9 rounded-control border border-border px-3 text-sm hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-accent">
          Take the tour
        </button>
      </div>
    </div>
  );
}
