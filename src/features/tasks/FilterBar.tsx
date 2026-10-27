import { Pin, Search, X } from "lucide-react";
import { useMemo } from "react";
import { parseFilter } from "../../domain/filter";
import type { ViewId } from "../../domain/types";
import { uid } from "../../stores/data";
import { useSettings } from "../../stores/settings";
import { go, setFilter, useUi } from "../../stores/ui";

/** Narrows the current task view with quick-add syntax: `#work !high ~home tomorrow overdue`. */
export function FilterBar({ view }: { view: ViewId }) {
  const query = useUi((s) => s.filters[view] ?? "");
  const saved = useSettings((s) => s.settings.savedFilters);
  const update = useSettings((s) => s.update);
  const chips = useMemo(() => parseFilter(query, new Date()).chips, [query]);
  const canPin = query.trim() !== "" && !view.startsWith("filter:");

  const pin = () => {
    const f = { id: uid(), name: query.trim(), query: query.trim() };
    update({ savedFilters: [...saved, f] });
    setFilter(view, "");
    go(`filter:${f.id}`);
  };

  return (
    <div className="flex h-8 min-w-0 max-w-sm flex-1 items-center gap-1.5 rounded-sm border border-border bg-bg px-2 transition-colors focus-within:border-accent">
      <Search size={14} className="shrink-0 text-muted" />
      <input
        value={query}
        onChange={(e) => setFilter(view, e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape" && query) {
            e.stopPropagation();
            setFilter(view, "");
          }
        }}
        placeholder="Filter: #tag !high ~list tomorrow"
        aria-label="Filter tasks"
        title="Filter with quick-add syntax. Also: overdue, nodate, done, wontdo"
        className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-muted"
      />
      {chips.length > 0 && (
        <span className="shrink-0 rounded-full bg-accent-soft px-1.5 font-mono text-[0.65rem] text-accent" title={chips.map((c) => c.text).join(" ")}>
          {chips.length}
        </span>
      )}
      {query && (
        <button type="button" aria-label="Clear filter" onClick={() => setFilter(view, "")} className="grid size-5 shrink-0 place-items-center rounded-sm text-muted hover:bg-hover hover:text-fg">
          <X size={13} />
        </button>
      )}
      {canPin && (
        <button type="button" aria-label="Pin filter to sidebar" title="Pin to sidebar" onClick={pin} className="grid size-5 shrink-0 place-items-center rounded-sm text-muted hover:bg-hover hover:text-accent">
          <Pin size={13} />
        </button>
      )}
    </div>
  );
}
