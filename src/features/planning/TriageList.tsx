import { type ReactNode, useEffect, useRef, useState } from "react";
import { Button } from "../../components/ui/Dialog";
import type { Triage } from "../../domain/planDay";
import type { TaskVM } from "../../domain/taskViews";
import { typing } from "../../lib/shortcuts";

const KEYS: Record<string, Triage> = { k: "keep", t: "tomorrow", s: "someday", d: "drop" };
const LABEL: Record<Triage, string> = { keep: "Keep", tomorrow: "Tomorrow", someday: "Someday", drop: "Drop" };

/**
 * One task at a time with Keep / Tomorrow / Someday / Drop, on buttons or the K T S D keys. A handled task leaves
 * the list; `onAct` does the store change (Keep may do nothing, in the shutdown sweep).
 */
export function TriageList({ items, keepLabel = "Keep", onAct, onDone }: { items: readonly TaskVM[]; keepLabel?: string; onAct: (vm: TaskVM, a: Triage) => void; onDone: ReactNode }) {
  const [handled, setHandled] = useState<ReadonlySet<string>>(new Set());
  const left = items.filter((vm) => !handled.has(vm.task.id));
  const cur = left[0];
  const root = useRef<HTMLDivElement>(null);
  const act = (a: Triage) => {
    if (!cur) return;
    onAct(cur, a);
    setHandled((h) => new Set(h).add(cur.task.id));
  };
  // Re-bound each render: the handler closes over the current task.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const a = KEYS[e.key.toLowerCase()];
      if (!a || e.ctrlKey || e.metaKey || e.altKey || typing(e)) return;
      // Stacked dialogs (as in Dialog.tsx): only react when this list sits in the topmost dialog or menu.
      const top = [...document.querySelectorAll("[role=dialog], [role=menu]")].pop();
      if (top && top !== root.current?.closest("[role=dialog], [role=menu]")) return;
      e.preventDefault();
      act(a);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });
  if (!cur) return <>{onDone}</>;
  return (
    <div ref={root} className="flex flex-col gap-3">
      <p className="text-[length:var(--fs-sm)] text-muted tabular-nums">{left.length} left</p>
      {/* The card changes under the user after every key press, so say what is current. */}
      <div className="card" aria-live="polite" aria-atomic="true">
        <div className="font-medium">{cur.task.title}</div>
        {cur.date && <div className="text-[length:var(--fs-sm)] text-muted tabular-nums">{cur.date}</div>}
      </div>
      <div className="flex flex-wrap gap-2">
        {(["keep", "tomorrow", "someday", "drop"] as const).map((a) => (
          <Button key={a} variant={a === "keep" ? "primary" : "secondary"} onClick={() => act(a)} keys={a === "keep" ? "K" : a[0].toUpperCase()}>
            {a === "keep" ? keepLabel : LABEL[a]} <span className="kbd">{a === "keep" ? "K" : a[0].toUpperCase()}</span>
          </Button>
        ))}
      </div>
    </div>
  );
}
