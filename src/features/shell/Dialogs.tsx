import { Button, Dialog } from "../../components/ui/Dialog";
import { setShortcuts, useUi } from "../../stores/ui";

/** "This / this and following / all" prompt for recurring tasks. */
export function ScopeDialog() {
  const ask = useUi((s) => s.scopeAsk);
  if (!ask) return null;
  const verb = ask.verb === "edit" ? "Change" : "Delete";
  const opt = (label: string, desc: string, run: () => void, danger = false) => (
    <button type="button" onClick={run} className={`w-full rounded-md border border-border px-4 py-3 text-left transition-colors hover:border-accent hover:bg-accent-soft ${danger ? "hover:border-danger" : ""}`}>
      <div className="text-sm font-semibold">{label}</div>
      <div className="text-xs text-muted">{desc}</div>
    </button>
  );
  return (
    <Dialog label={`${verb} recurring task`} onClose={() => ask.resolve(null)} width="max-w-sm">
      <div className="space-y-3 p-6">
        <h2 className="text-lg font-semibold">{verb} recurring task</h2>
        {opt("This occurrence", "Only the one you selected.", () => ask.resolve("this"))}
        {opt("This and following", "This one and every later occurrence.", () => ask.resolve("following"))}
        {opt("All occurrences", "The whole series, past and future.", () => ask.resolve("all"))}
        <div className="flex justify-end pt-1">
          <Button onClick={() => ask.resolve(null)}>Cancel</Button>
        </div>
      </div>
    </Dialog>
  );
}

export function ConfirmDialog() {
  const ask = useUi((s) => s.confirmAsk);
  if (!ask) return null;
  return (
    <Dialog label={ask.title} onClose={() => ask.resolve(false)} width="max-w-sm">
      <div className="space-y-4 p-6">
        <h2 className="text-lg font-semibold">{ask.title}</h2>
        <p className="text-sm text-fg-2">{ask.body}</p>
        <div className="flex justify-end gap-2">
          <Button onClick={() => ask.resolve(false)}>Cancel</Button>
          <Button variant="danger" onClick={() => ask.resolve(true)}>
            {ask.confirm}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

/** Single source of truth for the "?" sheet; lib/shortcuts.ts implements the bindings. */
export const SHORTCUTS: [section: string, keys: string, what: string][] = [
  ["General", "Ctrl K", "Search & commands"],
  ["General", "N", "New task (focus quick add)"],
  ["General", "Ctrl Shift A", "Quick add from anywhere (global)"],
  ["General", "Ctrl Z", "Undo last change"],
  ["General", "?", "This cheat sheet"],
  ["General", "Esc", "Close drawer / clear selection"],
  ["Tasks", "Enter", "Open focused task"],
  ["Tasks", "Space", "Complete focused task"],
  ["Tasks", "Ctrl / Shift + click", "Multi-select"],
  ["Tasks", "Delete", "Delete selected tasks"],
  ["Quick add", "!high  !2", "Priority"],
  ["Quick add", "#tag  ~List", "Tag, list"],
  ["Quick add", "tomorrow 5pm, every mon", "Date, time, repeat"],
  ["Calendar", "D / X / W / M / A", "Day / 3-day / week / month / agenda"],
  ["Calendar", "T", "Jump to today"],
  ["Calendar", "← →", "Previous / next"],
];

export function ShortcutSheet() {
  const open = useUi((s) => s.shortcutsOpen);
  if (!open) return null;
  const sections = [...new Set(SHORTCUTS.map((s) => s[0]))];
  return (
    <Dialog label="Keyboard shortcuts" onClose={() => setShortcuts(false)} width="max-w-2xl">
      <div className="p-6">
        <h2 className="mb-4 text-lg font-semibold">Keyboard shortcuts</h2>
        <div className="grid gap-6 sm:grid-cols-2">
          {sections.map((sec) => (
            <section key={sec}>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">{sec}</h3>
              <dl className="space-y-1.5">
                {SHORTCUTS.filter((s) => s[0] === sec).map(([, keys, what]) => (
                  <div key={keys} className="flex items-center justify-between gap-4 text-sm">
                    <dt className="text-fg-2">{what}</dt>
                    <dd>
                      <kbd className="rounded-sm border border-border bg-surface px-1.5 py-0.5 font-mono text-xs">{keys}</kbd>
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </div>
    </Dialog>
  );
}
