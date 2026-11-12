import type { BarPosition, Layout } from "../../domain/types";
import { useSettingsDraft } from "../../stores/settingsDraft";

type Choice = { id: string; layout: Layout; barPosition?: BarPosition; name: string; hint: string };

const CHOICES: Choice[] = [
  { id: "sidebar", layout: "sidebar", name: "Sidebar", hint: "Navigation down the side" },
  { id: "top", layout: "bar", barPosition: "top", name: "Bar at the top", hint: "One strip across the top" },
  { id: "bottom", layout: "bar", barPosition: "bottom", name: "Bar at the bottom", hint: "One strip across the bottom, like a phone" },
];

/** A tiny drawing of each layout: navigation in muted bars, the content area in accent-soft. */
function Thumb({ choice, floating }: { choice: Choice; floating: boolean }) {
  const bar = "rounded-[2px] bg-fg-2/25";
  const strip = (
    <div className="flex h-2 items-center gap-1 px-0.5">
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className={`h-1 w-3 ${bar}`} />
      ))}
    </div>
  );
  const dock = (
    <div className="mx-auto flex h-2.5 w-4/5 items-center justify-center gap-1 rounded-full bg-raised shadow-float ring-1 ring-border">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="size-1 rounded-full bg-fg-2/40" />
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
          {choice.barPosition === "top" && (floating ? dock : strip)}
          <div className="flex-1 rounded-[3px] border border-border bg-accent-soft" />
          {choice.barPosition === "bottom" && (floating ? dock : strip)}
        </div>
      )}
    </div>
  );
}

/** Settings → Appearance (D114). Changes wait for Save (D232). Floating is a separate switch (D223), so it keeps across positions. */
export function LayoutPicker() {
  const { draft, update } = useSettingsDraft();
  const { layout, barPosition, barStyle } = draft;
  const floating = barStyle === "floating";
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
            current === c.id ? "border-accent-text bg-accent-soft" : "border-border hover:bg-surface-2"
          }`}
        >
          <Thumb choice={c} floating={floating} />
          <span className="text-[length:var(--fs-sm)] font-semibold">{c.name}</span>
          <span className="-mt-1 text-[length:var(--fs-xs)] leading-tight text-muted">{c.hint}</span>
        </button>
      ))}
    </div>
  );
}
