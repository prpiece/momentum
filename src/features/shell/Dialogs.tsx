import { Button, Dialog } from "../../components/ui/Dialog";
import { Keys } from "../../components/ui/Keys";
import { FEATURE_GROUPS, FEATURES } from "../../domain/features";
import { setShortcuts, useUi } from "../../stores/ui";

/** "This / this and following / all" prompt for recurring tasks. */
export function ScopeDialog() {
  const ask = useUi((s) => s.scopeAsk);
  if (!ask) return null;
  const verb = ask.verb === "edit" ? "Change" : "Delete";
  const opt = (label: string, desc: string, run: () => void, danger = false) => (
    <button type="button" onClick={run} className={`w-full rounded-card border border-border px-4 py-3 text-left hover:bg-surface-2 ${danger ? "hover:border-danger" : "hover:border-border-strong"}`}>
      <div className="font-semibold">{label}</div>
      <div className="text-[length:var(--fs-sm)] text-muted">{desc}</div>
    </button>
  );
  return (
    <Dialog label={`${verb} recurring task`} onClose={() => ask.resolve(null)} width="max-w-sm">
      <div className="space-y-3 p-5">
        <h2 className="text-[length:var(--fs-lg)] font-semibold">{verb} recurring task</h2>
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
      <div className="p-5">
        <h2 className="text-[length:var(--fs-lg)] font-semibold">{ask.title}</h2>
        <p className="mt-2 text-fg-2">{ask.body}</p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => ask.resolve(false)}>
            Cancel
          </Button>
          <Button variant="danger" onClick={() => ask.resolve(true)}>
            {ask.confirm}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

/** The "?" sheet: every shortcut and token in the feature registry (D167); lib/shortcuts.ts implements the bindings. */
export function ShortcutSheet() {
  const open = useUi((s) => s.shortcutsOpen);
  if (!open) return null;
  const sections = FEATURE_GROUPS.map((group) => ({
    group,
    rows: FEATURES.filter((f) => f.group === group).flatMap((f) => f.commands.flatMap((c): [string, string, boolean][] => (c.kind === "keys" ? [[c.keys, c.text, false]] : c.kind === "token" ? [[c.token, c.text, true]] : []))),
  })).filter((s) => s.rows.length);
  return (
    <Dialog label="Keyboard shortcuts" onClose={() => setShortcuts(false)} width="max-w-[760px]">
      <div className="flex items-center gap-4 border-b border-border py-3.5 pl-5 pr-3.5">
        <h2 className="text-[length:var(--fs-lg)] font-semibold">Keyboard shortcuts</h2>
      </div>
      <div className="grid gap-x-8 gap-y-5 p-5 sm:grid-cols-2">
        {sections.map(({ group, rows }) => (
          <section key={group}>
            <h3 className="t-label mb-1.5 text-muted">{group}</h3>
            <dl>
              {rows.map(([keys, what, token]) => (
                <div key={keys + what} className="flex min-h-8 items-center justify-between gap-3 border-b border-border text-[length:var(--fs-sm)] last:border-b-0">
                  <dt className="text-fg-2">{what}</dt>
                  <dd>{token ? <span className="token">{keys}</span> : <Keys keys={keys} />}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
      <p className="flex items-center gap-1.5 border-t border-border px-5 py-3 text-[length:var(--fs-xs)] text-muted">
        Press <Keys keys="?" /> anywhere to open this, and <Keys keys="Ctrl K" /> to find any command by name.
      </p>
    </Dialog>
  );
}
