import { Dialog } from "../../components/ui/Dialog";
import { setUndoHistory, undoTo, useUndo } from "../../stores/undo";

const SOURCE = { you: "You", sync: "Sync", agent: "Agent" } as const;
const time = (at: number) => new Date(at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

/** Recent changes with who made them; Undo here takes back that change and every newer one (FEAT-24). */
export function UndoHistory() {
  const open = useUndo((s) => s.open);
  const entries = useUndo((s) => s.entries);
  if (!open) return null;
  const close = () => setUndoHistory(false);
  return (
    <Dialog onClose={close} label="Undo history" width="max-w-md">
      <div className="p-4">
        <h2 className="t-title mb-3">Undo history</h2>
        {entries.length === 0 ? (
          <p className="py-6 text-center text-[length:var(--fs-sm)] text-muted">Nothing to undo yet. Changes are kept until you quit.</p>
        ) : (
          <ul className="max-h-80 space-y-0.5 overflow-auto">
            {[...entries].reverse().map((e) => (
              <li key={e.id} className="flex items-center gap-2 rounded-control px-2 py-1.5 hover:bg-surface-2">
                <span className="min-w-0 flex-1 truncate text-[length:var(--fs-sm)]">{e.message}</span>
                <span className="token shrink-0">{SOURCE[e.source]}</span>
                <span className="w-16 shrink-0 text-right text-[length:var(--fs-xs)] tabular-nums text-muted">{time(e.at)}</span>
                <button type="button" className="btn btn-secondary btn-sm shrink-0" onClick={() => undoTo(e.id)}>
                  Undo
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Dialog>
  );
}
