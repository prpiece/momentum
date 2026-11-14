import { Button, Dialog } from "../../components/ui/Dialog";
import type { ImportPlan } from "../../domain/importPlan";
import { applyImportPlan } from "../../stores/importPlan";
import { setExternalImport, useUi } from "../../stores/ui";

const SOURCE = { todoist: "Todoist", ticktick: "TickTick" } as const;
const SHOWN_SKIPS = 5;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Preview of a Todoist or TickTick export, then one undoable import. Mounted once in App. */
export function ImportExternalDialog() {
  const pending = useUi((s) => s.externalImport);
  if (!pending) return null;
  const { source, plan } = pending;
  const { counts: n } = plan;
  const close = () => setExternalImport(null);
  const run = () => {
    applyImportPlan(plan);
    close();
  };
  const rows: [string, number][] = [
    ["Lists", n.lists],
    ["Folders", n.folders],
    ["Sections", n.sections],
    ["Tasks", n.tasks],
    ["Subtasks (included in tasks)", n.subtasks],
    ["Tags", n.tags],
    ["Completed", n.completed],
    ["Repeats kept", n.repeatsKept],
  ];
  return (
    <Dialog label={`Import from ${SOURCE[source]}`} onClose={close} width="max-w-lg">
      <div className="space-y-4 p-6">
        <h2 className="text-lg font-semibold">Import from {SOURCE[source]}</h2>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-1 rounded-card border border-border bg-surface p-3 text-sm" aria-live="polite">
          {rows
            .filter(([, v]) => v > 0)
            .map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-fg-2">{k}</dt>
                <dd className="text-right tabular-nums">{v}</dd>
              </div>
            ))}
        </dl>
        {n.repeatsNotKept > 0 && <p className="text-sm text-fg-2">{plural(n.repeatsNotKept, "repeat")} couldn&apos;t be carried over; those tasks import without repeating.</p>}
        <p className="text-xs text-muted">Every list is created new, even if you already have one with the same name. One Undo removes everything this import adds.</p>
        <Skipped plan={plan} />
        <div className="flex justify-end gap-2">
          <Button onClick={close}>Cancel</Button>
          <Button variant="primary" onClick={run} disabled={!n.tasks}>
            Import {plural(n.tasks, "task")}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

function Skipped({ plan }: { plan: ImportPlan }) {
  if (!plan.skipped.length) return null;
  return (
    <div className="text-xs text-muted">
      <div className="text-danger">{plural(plan.skipped.length, "row")} skipped</div>
      <ul className="mt-1 space-y-0.5">
        {plan.skipped.slice(0, SHOWN_SKIPS).map((s, i) => (
          <li key={i} className="tabular-nums">
            {s.line ? `Line ${s.line}: ` : ""}
            {s.reason}
          </li>
        ))}
        {plan.skipped.length > SHOWN_SKIPS && <li>and {plan.skipped.length - SHOWN_SKIPS} more</li>}
      </ul>
    </div>
  );
}
