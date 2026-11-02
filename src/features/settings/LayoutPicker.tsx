import { LAYOUTS, type Layout } from "../../domain/types";
import { useSettings } from "../../stores/settings";

const NAMES: Record<Layout, [string, string]> = {
  classic: ["Classic", "Sidebar and a floating card"],
  flat: ["Flat", "Edge to edge, no card"],
  topbar: ["Top bar", "Navigation across the top"],
  dock: ["Dock", "A floating dock at the bottom"],
};

/** A tiny drawing of each layout: sidebar/bar in muted bars, the content area in accent-soft. */
function Thumb({ layout }: { layout: Layout }) {
  const bar = "rounded-[2px] bg-fg-2/25";
  const card = "rounded-[3px] bg-accent-soft";
  return (
    <div
      className="flex h-14 w-full gap-1 overflow-hidden rounded-sm border border-border bg-bg p-1"
      aria-hidden
    >
      {layout === "classic" && (
        <>
          <div className="flex w-1/4 flex-col gap-1 p-0.5">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className={`h-1 ${bar}`} />
            ))}
          </div>
          <div className={`flex-1 border border-border shadow-sm ${card}`} />
        </>
      )}
      {layout === "flat" && (
        <div className="-m-1 flex flex-1">
          <div className="flex w-1/4 flex-col gap-1 p-1.5">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className={`h-1 ${bar}`} />
            ))}
          </div>
          <div className="flex-1 border-l border-border bg-accent-soft" />
        </div>
      )}
      {layout === "topbar" && (
        <div className="flex flex-1 flex-col gap-1">
          <div className="flex h-2 items-center gap-1 px-0.5">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className={`h-1 w-3 ${bar}`} />
            ))}
          </div>
          <div className={`flex-1 border border-border ${card}`} />
        </div>
      )}
      {layout === "dock" && (
        <div className="flex flex-1 flex-col items-center gap-1">
          <div className={`w-full flex-1 border border-border ${card}`} />
          <div className="flex h-2.5 items-center gap-0.5 rounded-[3px] border border-border bg-surface-2 px-1">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="size-1 rounded-full bg-fg-2/40" />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** Settings → Layout and the tour's first step (D68). Changes apply as you click. */
export function LayoutPicker() {
  const layout = useSettings((s) => s.settings.layout);
  const update = useSettings((s) => s.update);
  return (
    <div className="@container">
      <div
        role="radiogroup"
        aria-label="Layout"
        className="grid grid-cols-2 gap-2 @lg:grid-cols-4"
      >
        {LAYOUTS.map((l) => (
          <button
            key={l}
            type="button"
            role="radio"
            aria-checked={layout === l}
            onClick={() => update({ layout: l })}
            className={`flex flex-col gap-1.5 rounded-md border p-2 text-left transition-colors duration-[var(--dur)] focus-visible:ring-2 focus-visible:ring-accent ${
              layout === l
                ? "border-accent bg-accent-soft/40"
                : "border-border hover:bg-hover"
            }`}
          >
            <Thumb layout={l} />
            <span className="text-xs font-semibold">{NAMES[l][0]}</span>
            <span className="-mt-1 text-[0.68rem] leading-tight text-muted">
              {NAMES[l][1]}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
