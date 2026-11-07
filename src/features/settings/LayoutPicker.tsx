import type { BarPosition, Layout } from "../../domain/types";
import { useSettings } from "../../stores/settings";

type Choice = { id: string; layout: Layout; barPosition?: BarPosition; name: string; hint: string };

const CHOICES: Choice[] = [
  { id: "sidebar", layout: "sidebar", name: "Sidebar", hint: "Navigation down the side" },
  { id: "top", layout: "bar", barPosition: "top", name: "Bar at the top", hint: "One strip across the top" },
  { id: "bottom", layout: "bar", barPosition: "bottom", name: "Bar at the bottom", hint: "One strip across the bottom, like a phone" },
];

/** A tiny drawing of each layout: navigation in muted bars, the content area in accent-soft. */
function Thumb({ choice }: { choice: Choice }) {
  const bar = "rounded-[2px] bg-fg-2/25";
  const strip = (
    <div className="flex h-2 items-center gap-1 px-0.5">
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className={`h-1 w-3 ${bar}`} />
      ))}
    </div>
  );
  return (
    <div className="flex h-14 w-full gap-1 overflow-hidden rounded-control border border-border bg-bg p-1" aria-hidden>
      {choice.layout === "sidebar" ? (
        <>
          <div className="flex w-1/4 flex-col gap-1 p-0.5">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className={`h-1 ${bar}`} />
            ))}
          </div>
          <div className="flex-1 rounded-[3px] border border-border bg-accent-soft" />
        </>
      ) : (
        <div className="flex flex-1 flex-col gap-1">
          {choice.barPosition === "top" && strip}
          <div className="flex-1 rounded-[3px] border border-border bg-accent-soft" />
          {choice.barPosition === "bottom" && strip}
        </div>
      )}
    </div>
  );
}

/** Settings → Appearance (D114). Changes apply as you click. */
export function LayoutPicker() {
  const layout = useSettings((s) => s.settings.layout);
  const barPosition = useSettings((s) => s.settings.barPosition);
  const update = useSettings((s) => s.update);
  const current = layout === "sidebar" ? "sidebar" : barPosition;
  return (
    <div role="radiogroup" aria-label="Layout" className="grid grid-cols-3 gap-2">
      {CHOICES.map((c) => (
        <button
          key={c.id}
          type="button"
          role="radio"
          aria-checked={current === c.id}
          onClick={() => update(c.barPosition ? { layout: c.layout, barPosition: c.barPosition } : { layout: c.layout })}
          className={`flex flex-col gap-1.5 rounded-card border p-2 text-left transition-colors duration-[var(--dur)] focus-visible:ring-2 focus-visible:ring-accent ${
            current === c.id ? "border-accent bg-accent-soft/40" : "border-border hover:bg-surface-2"
          }`}
        >
          <Thumb choice={c} />
          <span className="text-xs font-semibold">{c.name}</span>
          <span className="-mt-1 text-[0.68rem] leading-tight text-muted">{c.hint}</span>
        </button>
      ))}
    </div>
  );
}
