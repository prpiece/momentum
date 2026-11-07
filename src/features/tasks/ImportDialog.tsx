import { CalendarDays, Flag } from "lucide-react";
import { useMemo, useState } from "react";
import { Button, Dialog } from "../../components/ui/Dialog";
import { Segmented } from "../../components/ui/Segmented";
import { formatTime, relativeDayLabel, todayLocal } from "../../domain/dates";
import { splitImport } from "../../domain/bulkImport";
import { parseQuickAdd } from "../../domain/quickAdd";
import { PRIORITY_LABEL, type Task } from "../../domain/types";
import { useData } from "../../stores/data";
import { useSettings } from "../../stores/settings";
import { setImport, toast, useUi } from "../../stores/ui";
import { withUndo } from "../../lib/undo";
import { createFromText } from "./quickAddSubmit";

const PREVIEW = 5;
const field = "rounded-control border border-border bg-bg px-2.5 py-1.5 text-sm outline-none focus-visible:border-accent focus-visible:shadow-[0_0_0_3px_var(--accent-soft)]";

/** Paste a block of text, one task per line or custom separator (D92). Mounted once in App. */
export function ImportDialog() {
  const open = useUi((s) => s.importOpen);
  return open ? <ImportBody /> : null;
}

function ImportBody() {
  const view = useUi((s) => s.view);
  const lists = useData((s) => s.lists);
  const smartParse = useSettings((s) => s.settings.smartParse);
  const timeFormat = useSettings((s) => s.settings.timeFormat);
  const [text, setText] = useState("");
  const [mode, setMode] = useState<"line" | "custom">("line");
  const [sep, setSep] = useState(";");
  const [plain, setPlain] = useState(false);
  const [listId, setListId] = useState(() => {
    const id = view.startsWith("list:") ? view.slice(5) : "inbox";
    return lists[id] ? id : "inbox";
  });
  const names = useMemo(() => Object.values(lists).map((l) => l.name), [lists]);
  const choices = useMemo(() => Object.values(lists).filter((l) => !l.archived || l.id === listId), [lists, listId]);
  const parsing = smartParse && !plain;

  const { items, total } = useMemo(() => splitImport(text, mode === "custom" && sep ? sep : undefined), [text, mode, sep]);
  const preview = useMemo(() => {
    const now = new Date();
    // Indent by depth so the preview shows the subtask tree.
    const depth = (i: number): number => ((p) => (p === null ? 0 : 1 + depth(p)))(items[i].parent);
    return items.slice(0, PREVIEW).map(({ text: raw }, i) => ({ raw, depth: depth(i), p: parseQuickAdd(raw, now, parsing, names) }));
  }, [items, parsing, names]);
  const subtasks = items.filter((i) => i.parent !== null).length;
  const today = todayLocal();
  const close = () => setImport(false);

  const run = () => {
    if (!items.length) return;
    const missing = new Set<string>();
    withUndo(`Imported ${items.length} task${items.length === 1 ? "" : "s"}`, () => {
      // Items come parents first, so each subtask's parent already exists. In pasted order (bottom).
      const created: (Task | null)[] = [];
      for (const { text: line, parent } of items) {
        const p = parent === null ? null : created[parent];
        const defaults = p ? { listId: p.listId, parentId: p.id } : { listId };
        created.push(createFromText(line, defaults, parsing, () => false, "typed", (name) => missing.add(name), "bottom"));
      }
    });
    if (missing.size) toast(`No list named ${[...missing].map((n) => `“${n}”`).join(", ")}; those tasks went to the chosen list`);
    close();
  };

  return (
    <Dialog label="Import tasks" onClose={close} width="max-w-xl">
      <div className="space-y-4 p-6">
        <h2 className="text-lg font-semibold">Import tasks</h2>
        <textarea
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && (e.ctrlKey || e.metaKey) && (e.preventDefault(), run())}
          rows={7}
          aria-label="Text to import"
          placeholder={"Paste a list here, one task per line. Indent a line to make it a subtask:\n- Plan trip friday\n    - Book flights !high\n- Call mum"}
          className={`${field} block w-full resize-y`}
        />
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <span className="text-sm text-fg-2">Separator</span>
          <Segmented
            name="import-sep"
            label="Separator"
            value={mode}
            options={[
              { value: "line", label: "New line" },
              { value: "custom", label: "Custom" },
            ]}
            onChange={setMode}
          />
          {mode === "custom" && <input value={sep} onChange={(e) => setSep(e.target.value)} aria-label="Custom separator" maxLength={8} className={`${field} w-20 tabular-nums`} />}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <label className="flex items-center gap-2 text-sm text-fg-2">
            <input type="checkbox" checked={plain} onChange={(e) => setPlain(e.target.checked)} className="size-4 accent-[var(--accent)]" />
            Treat each item as plain text
          </label>
          <label className="flex items-center gap-2 text-sm text-fg-2">
            Add to
            <select value={listId} onChange={(e) => setListId(e.target.value)} className={field}>
              {choices.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div aria-live="polite" className="rounded-card border border-border bg-surface p-3">
          <div className="tabular-nums text-sm text-muted">
            {items.length} task{items.length === 1 ? "" : "s"}
            {subtasks > 0 && ` · ${subtasks} subtask${subtasks === 1 ? "" : "s"}`}
          </div>
          {total > items.length && <p className="mt-1 text-xs text-danger">Only the first {items.length} of {total} items will be imported.</p>}
          {preview.length > 0 && (
            <ul className="mt-2 space-y-1.5">
              {preview.map(({ raw, depth, p }, i) => {
                const s = p.schedule;
                const when =
                  s.kind === "day"
                    ? relativeDayLabel(s.date, today)
                    : s.kind === "timed"
                      ? `${relativeDayLabel(todayLocal(new Date(s.start)), today)} ${formatTime(new Date(s.start), timeFormat)}`
                      : null;
                return (
                  <li key={i} className="flex items-center gap-2 text-sm" style={{ paddingLeft: `${depth * 1.25}rem` }}>
                    <span className="min-w-0 flex-1 truncate">{p.title || raw}</span>
                    {when && (
                      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-xs font-medium">
                        <CalendarDays size={12} className="text-accent" />
                        {when}
                      </span>
                    )}
                    {p.priority !== null && (
                      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-xs font-medium">
                        <Flag size={12} className="text-accent" />
                        {PRIORITY_LABEL[p.priority]}
                      </span>
                    )}
                  </li>
                );
              })}
              {items.length > PREVIEW && <li className="text-xs text-muted">and {items.length - PREVIEW} more</li>}
            </ul>
          )}
        </div>
        <div className="flex justify-end gap-2">
          <Button onClick={close}>Cancel</Button>
          <Button variant="primary" onClick={run} disabled={!items.length}>
            Import
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
