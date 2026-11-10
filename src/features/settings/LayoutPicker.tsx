import type { BarPosition, BarStyle, Layout } from "../../domain/types";
import { useSettings } from "../../stores/settings";

type Choice = { id: string; layout: Layout; barPosition?: BarPosition; barStyle?: BarStyle; name: string; hint: string };

const CHOICES: Choice[] = [
  { id: "sidebar", layout: "sidebar", name: "Sidebar", hint: "Navigation down the side" },
  { id: "top", layout: "bar", barPosition: "top", barStyle: "flat", name: "Bar at the top", hint: "One strip across the top" },
  { id: "bottom", layout: "bar", barPosition: "bottom", barStyle: "flat", name: "Bar at the bottom", hint: "One strip across the bottom, like a phone" },
  { id: "floating", layout: "bar", barPosition: "bottom", barStyle: "floating", name: "Floating bar", hint: "A dock that floats above the page" },
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
          {choice.barStyle === "floating" ? (
            <div className="mx-auto flex h-2.5 w-4/5 items-center justify-center gap-1 rounded-full bg-raised shadow-float ring-1 ring-border">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="size-1 rounded-full bg-fg-2/40" />
              ))}
            </div>
          ) : (
            choice.barPosition === "bottom" && strip
          )}
        </div>
      )}
    </div>
  );
}

/** Settings → Appearance (D114). Changes apply as you click. */
export function LayoutPicker() {
  const layout = useSettings((s) => s.settings.layout);
  const barPosition = useSettings((s) => s.settings.barPosition);
  const barStyle = useSettings((s) => s.settings.barStyle);
  const update = useSettings((s) => s.update);
  const current = layout === "sidebar" ? "sidebar" : barStyle === "floating" ? "floating" : barPosition;
  return (
    <div role="radiogroup" aria-label="Layout" className="grid grid-cols-2 gap-2 min-[560px]:grid-cols-4">
      {CHOICES.map((c) => (
        <button
          key={c.id}
          type="button"
          role="radio"
          aria-checked={current === c.id}
          onClick={() => update(c.barPosition ? { layout: c.layout, barPosition: c.barPosition, barStyle: c.barStyle } : { layout: c.layout })}
          className={`flex flex-col gap-1.5 rounded-card border p-2 text-left transition-colors duration-[var(--dur)] focus-visible:ring-2 focus-visible:ring-accent ${
            current === c.id ? "border-accent-text bg-accent-soft" : "border-border hover:bg-surface-2"
          }`}
        >
          <Thumb choice={c} />
          <span className="text-[length:var(--fs-sm)] font-semibold">{c.name}</span>
          <span className="-mt-1 text-[length:var(--fs-xs)] leading-tight text-muted">{c.hint}</span>
        </button>
      ))}
    </div>
  );
}
