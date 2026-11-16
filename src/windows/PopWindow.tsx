import { Check, Pin } from "lucide-react";
import { useEffect, useState } from "react";
import { parsePopState, type PopState } from "../domain/popout";
import { apply, readAppearance } from "../lib/applySettings";

const view = new URLSearchParams(location.search).get("view") ?? "today";

/**
 * A list popped out into its own window (FEAT-27). Read-only: no database, it renders the state the
 * main window pushes and sends completes and opens back as `mini:action` events (D33).
 */
export function PopWindow() {
  const [state, setState] = useState<PopState | null>(null);
  const [onTop, setOnTop] = useState(false);
  useEffect(() => {
    const a = readAppearance();
    if (a) apply(a);
    let off: (() => void)[] = [];
    void (async () => {
      const { listen, emit } = await import("@tauri-apps/api/event");
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      const hello = () => void emit("pop:hello", { view });
      off = [
        await listen<unknown>("pop:state", (e) => {
          const s = parsePopState(e.payload);
          if (s && s.view === view) setState(s);
        }),
        await getCurrentWindow().onFocusChanged(({ payload }) => payload && hello()),
      ];
      hello();
    })();
    return () => off.forEach((f) => f());
  }, []);
  // FEAT-28: pinned on top, the window works as a desktop widget.
  const pin = async () => {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().setAlwaysOnTop(!onTop);
    setOnTop(!onTop);
  };
  const send = async (action: object) => (await import("@tauri-apps/api/event")).emit("mini:action", action);
  return (
    <div className="flex h-full flex-col bg-surface">
      <header data-tauri-drag-region className="flex h-10 shrink-0 select-none items-center border-b border-border px-3 text-[length:var(--fs-sm)] font-medium">
        <span data-tauri-drag-region className="min-w-0 flex-1 truncate">{state?.title ?? "Momentum"}</span>
        <button type="button" aria-pressed={onTop} title={onTop ? "Stop keeping on top" : "Keep on top"} aria-label="Keep on top" className={`btn btn-ghost icon-btn ${onTop ? "text-accent-text" : "text-muted"}`} onClick={() => void pin()}>
          <Pin size={14} />
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-auto px-2 py-2">
        {!state ? (
          <p className="px-2 py-6 text-center text-[length:var(--fs-sm)] text-muted">Waiting for Momentum…</p>
        ) : !state.tasks.length ? (
          <p className="px-2 py-6 text-center text-[length:var(--fs-sm)] text-muted">Nothing here.</p>
        ) : (
          <ul className="space-y-0.5">
            {state.tasks.map((t) => (
              <li key={t.id} className="flex h-[var(--row)] items-center gap-2.5 rounded-control px-2 hover:bg-surface-2">
                <button type="button" role="checkbox" aria-checked={false} aria-label={`Complete ${t.title}`} className="check" onClick={(e) => e.detail < 2 && void send({ type: "toggle", id: t.id, key: t.key })}>
                  <Check strokeWidth={2.75} />
                </button>
                <button type="button" title="Open in Momentum" className="min-w-0 flex-1 truncate text-left text-[length:var(--fs-sm)]" onClick={() => void send({ type: "open", id: t.id, key: t.key })}>
                  {t.title}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
