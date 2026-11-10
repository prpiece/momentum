import { useDraggable, useDroppable } from "@dnd-kit/core";
import { Check, ListTree, Settings2 } from "lucide-react";
import { type CSSProperties, useMemo } from "react";
import { Popover, useMenu } from "../../components/ui/Popover";
import { TaskCheckbox } from "../../components/ui/TaskCheckbox";
import { ColorPicker } from "../../components/ui/ColorPicker";
import { accentForeground, accentHex, ACCENTS, isHex, ON_LIGHT, parseQuadrantColor, quadrantHex, type QuadrantColor } from "../../domain/color";
import { relativeDayLabel, todayLocal } from "../../domain/dates";
import { patchForQuadrant, QUADRANT_INFO, QUADRANT_VAR, QUADRANTS, quadrantOf, type Quadrant } from "../../domain/matrix";
import { sortVMs, topLevelIn, type TaskVM } from "../../domain/taskViews";
import { PRIORITIES, PRIORITY_LABEL, type Priority, type QuadrantColors } from "../../domain/types";
import { justDragged, onDrop } from "../../lib/dnd";
import { withUndo } from "../../lib/undo";
import { updateTask, useData, type NewTask } from "../../stores/data";
import { useSettings } from "../../stores/settings";
import { openContextMenu, openTask, useUi } from "../../stores/ui";
import { editTask, toggleDone } from "../tasks/actions";
import { InlineAdd } from "../tasks/InlineAdd";
import { taskMenu } from "../tasks/taskMenu";
import { derive, useDerived } from "../tasks/selectors";


onDrop("quadrant", (drag, drop) => {
  if (drag.type !== "task") return;
  const { tasks, lists } = useData.getState();
  const rules = useSettings.getState().settings.matrix;
  const today = todayLocal();
  const sel = useUi.getState().selection;
  const ids = sel.includes(drag.id) ? sel : [drag.id];
  const d = derive(tasks, lists);
  const vms = ids.map((id) => d.byId.get(id)).filter((v): v is TaskVM => !!v);
  const series = vms.filter((v) => v.task.recurrence && "schedule" in patchForQuadrant(v, drop.q, today, rules));
  const plain = vms.filter((v) => !series.includes(v));
  if (plain.length)
    withUndo(`Moved to ${QUADRANT_INFO[drop.q].title}`, () => plain.forEach((v) => updateTask(v.task.id, patchForQuadrant(v, drop.q, today, rules))));
  // Recurring tasks whose date must change go through the scope prompt.
  for (const v of series) void editTask(v.task.id, patchForQuadrant(v, drop.q, today, rules), v.key);
});

/** Matrix mode of a task view (D164): that view's open tasks, subtasks folded into their parent's card when it's here too (D196). New tasks get the view's defaults. */
export function MatrixView({ vms, defaults }: { vms: readonly TaskVM[]; defaults: Partial<NewTask> }) {
  const rules = useSettings((s) => s.settings.matrix);
  const today = todayLocal();
  const groups = useMemo(() => {
    const out: Record<Quadrant, TaskVM[]> = { 1: [], 2: [], 3: [], 4: [] };
    for (const vm of topLevelIn(vms.filter((v) => v.task.status === "open"))) out[quadrantOf(vm, today, rules)].push(vm);
    for (const q of QUADRANTS) out[q] = sortVMs(out[q], "date");
    return out;
  }, [vms, rules, today]);

  return (
    <div className="flex h-full min-h-0 flex-col px-[var(--gutter)] pb-6">
      <div className="flex items-center justify-end pb-2">
        <RulesEditor />
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-2 grid-rows-2 gap-3">
        {QUADRANTS.map((q) => (
          <QuadrantPanel key={q} q={q} items={groups[q]} defaults={defaults} />
        ))}
      </div>
    </div>
  );
}

function QuadrantPanel({ q, items, defaults }: { q: Quadrant; items: TaskVM[]; defaults: Partial<NewTask> }) {
  const info = QUADRANT_INFO[q];
  const rules = useSettings((s) => s.settings.matrix);
  const { setNodeRef, isOver } = useDroppable({ id: `quadrant:${q}`, data: { type: "quadrant", q } });
  // New tasks inherit the quadrant's attributes (same rule as dropping a blank task here); tokens typed in the box win (D220).
  const quadrantDefaults = { ...defaults, ...patchForQuadrant({ task: { priority: 0 }, date: null, schedule: { kind: "none" } }, q, todayLocal(), rules) };
  return (
    <section
      ref={setNodeRef}
      aria-label={info.title}
      className={`flex min-h-0 flex-col overflow-hidden rounded-card border px-2 pb-2 pt-2.5 ${isOver ? "border-accent-text bg-accent-soft" : "border-border bg-surface"}`}
    >
      <header className="flex items-center gap-2 px-1 pb-2">
        <span className="h-[18px] w-[3px] shrink-0 rounded-[2px]" style={{ background: QUADRANT_VAR[q] }} aria-hidden />
        <h2 className="text-[length:var(--fs-sm)] font-semibold">{info.title}</h2>
        <span className="truncate text-[length:var(--fs-xs)] text-muted">{info.hint}</span>
        <span className="ml-auto text-[length:var(--fs-xs)] tabular-nums text-muted">{items.length}</span>
      </header>
      <ul className="min-h-0 flex-1 overflow-y-auto">
        {items.map((vm) => (
          <MatrixItem key={vm.task.id} vm={vm} />
        ))}
        {!items.length && <li className="px-1 py-2 text-[length:var(--fs-sm)] text-muted">Drop tasks here</li>}
      </ul>
      <InlineAdd
        defaults={quadrantDefaults}
        placeholder={`+ Add to ${info.title}`}
        label={`Add task to ${info.title}`}
        className="mt-1 h-8 shrink-0 rounded-control border border-transparent bg-transparent px-2 text-[length:var(--fs-sm)] outline-none placeholder:text-muted hover:bg-surface-2 focus-visible:border-accent-text focus-visible:bg-surface focus-visible:shadow-[var(--focus-ring-input)] focus-visible:outline-none"
      />
    </section>
  );
}

function MatrixItem({ vm }: { vm: TaskVM }) {
  const t = vm.task;
  const kids = useDerived().childrenOf(t.id);
  const list = useData((s) => s.lists[t.listId]);
  const selected = useUi((s) => s.selection.includes(t.id));
  const { setNodeRef, attributes, listeners, isDragging } = useDraggable({ id: `matrix:${t.id}`, data: { type: "task", id: t.id, key: vm.key } });
  const today = todayLocal();
  return (
    <li
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onClick={() => !justDragged() && openTask(t.id, vm.key)}
      onContextMenu={(e) => openContextMenu(e, taskMenu(t.id, vm.key))}
      onKeyDown={(e) => e.key === "Enter" && openTask(t.id, vm.key)}
      className={`flex h-[var(--row-compact)] cursor-grab items-center gap-2.5 rounded-control px-1 text-[length:var(--fs-sm)] ${selected ? "bg-accent-soft" : "hover:bg-surface-2"} ${isDragging ? "opacity-40" : ""}`}
    >
      <TaskCheckbox status={t.status} priority={t.priority} onToggle={() => toggleDone(t.id, vm.key)} label={`Complete ${t.title}`} size={16} />
      <span className="min-w-0 flex-1 truncate font-medium">{t.title}</span>
      {kids.length > 0 && (
        <span className="flex shrink-0 items-center gap-[3px] tabular-nums text-muted" aria-label="Subtasks done">
          <ListTree size={16} strokeWidth={1.75} />
          {kids.filter((k) => k.task.status !== "open").length}/{kids.length}
        </span>
      )}
      {vm.date && <span className={`shrink-0 tabular-nums ${vm.date < today ? "text-danger" : "text-fg-2"}`}>{relativeDayLabel(vm.date, today)}</span>}
      {list && list.id !== "inbox" && <span className="max-w-24 shrink-0 truncate text-muted">{list.name}</span>}
    </li>
  );
}

/** Per-quadrant colour: a preset or any custom hex (D85, D216); unset keeps the theme default. */
function QuadrantColorPicker() {
  const colors = useSettings((s) => s.settings.matrixColors);
  const accent = useSettings((s) => s.settings.accent);
  const update = useSettings((s) => s.update);
  const [open, setOpen] = useState<Quadrant | null>(null);
  const pick = (q: Quadrant, c: QuadrantColor | null) => {
    const next: QuadrantColors = [...colors];
    next[q - 1] = c;
    update({ matrixColors: next });
  };
  /** The colour currently drawn for q, as a hex for the picker. */
  const currentHex = (q: Quadrant) => {
    const c = colors[q - 1];
    const theme = document.documentElement.dataset.theme === "dark" ? "dark" : "light";
    if (c) return quadrantHex(c, theme);
    const v = getComputedStyle(document.documentElement).getPropertyValue(QUADRANT_VAR[q].slice(4, -1)).trim();
    return isHex(v) ? v : accentHex(accent, theme);
  };
  const link = "rounded-control px-1.5 py-0.5 text-xs text-fg-2 hover:bg-surface-2 hover:text-fg";
  return (
    <>
      <div className="mt-4 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Colours</h3>
        <span className="flex gap-1">
          <button type="button" className={link} onClick={() => update({ matrixColors: [accent, accent, accent, accent] })}>Use accent for all</button>
          <button type="button" className={link} disabled={colors.every((c) => c === null)} onClick={() => update({ matrixColors: [null, null, null, null] })}>Reset</button>
        </span>
      </div>
      {QUADRANTS.map((q) => (
        <div key={q} className="mt-2" role="group" aria-label={`${QUADRANT_INFO[q].title} colour`}>
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-fg-2">{QUADRANT_INFO[q].title}</span>
            <button
              type="button"
              aria-label={`${QUADRANT_INFO[q].title} colour, ${colors[q - 1] ?? "default"}`}
              aria-expanded={open === q}
              onClick={() => setOpen(open === q ? null : q)}
              className="size-6 rounded-full border border-control-border"
              style={{ background: QUADRANT_VAR[q] }}
            />
          </div>
          {open === q && (
            <div className="mt-2 flex flex-col gap-3 rounded-card border border-border p-3">
              <ColorPicker value={currentHex(q)} onChange={(hex) => pick(q, parseQuadrantColor(hex))} />
              <div className="flex flex-wrap gap-2 p-1">
                {ACCENTS.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    title={p.name}
                    aria-label={p.name}
                    aria-pressed={colors[q - 1] === p.id}
                    onClick={() => pick(q, colors[q - 1] === p.id ? null : p.id)}
                    className="swatch grid size-5 place-items-center rounded-full transition-transform duration-[var(--dur)] hover:scale-110"
                    style={{ "--sw": p.light, "--sw-d": p.dark, "--sw-fg": accentForeground(p.light), "--sw-fg-d": ON_LIGHT } as CSSProperties}
                  >
                    {colors[q - 1] === p.id && <Check size={11} strokeWidth={3.5} />}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      ))}
    </>
  );
}

function RulesEditor() {
  const rules = useSettings((s) => s.settings.matrix);
  const update = useSettings((s) => s.update);
  const menu = useMenu();
  const toggle = (p: Priority) => {
    const next = rules.importantPriorities.includes(p) ? rules.importantPriorities.filter((x) => x !== p) : [...rules.importantPriorities, p].sort();
    if (next.length === 0 || next.length === PRIORITIES.length) return; // keep the rules satisfiable
    update({ matrix: { ...rules, importantPriorities: next } });
  };
  return (
    <>
      <button ref={menu.anchor} type="button" onClick={menu.toggle} className="btn btn-ghost btn-sm">
        <Settings2 size={15} /> Rules
      </button>
      {menu.open && (
        <Popover anchor={menu.anchor} onClose={menu.close} align="end" className="max-h-[80vh] w-72 overflow-y-auto p-4">
          <h3 className="text-sm font-semibold">Important means priority…</h3>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {[...PRIORITIES].reverse().map((p) => (
              <button
                key={p}
                type="button"
                aria-pressed={rules.importantPriorities.includes(p)}
                onClick={() => toggle(p)}
                className="btn btn-ghost btn-sm border-border"
              >
                {PRIORITY_LABEL[p]}
              </button>
            ))}
          </div>
          <h3 className="mt-4 text-sm font-semibold">Urgent means due within…</h3>
          <div className="mt-2 flex items-center gap-2 text-sm">
            <input
              type="number"
              min={0}
              max={30}
              value={rules.urgentDays}
              onChange={(e) => {
                const n = Math.round(Number(e.target.value));
                if (Number.isFinite(n) && n >= 0 && n <= 30) update({ matrix: { ...rules, urgentDays: n } });
              }}
              aria-label="Urgent within days"
              className="input w-16"
            />
            days (or overdue)
          </div>
          <p className="mt-3 text-xs text-muted">Dragging a task between quadrants changes its priority and due date to match these rules.</p>
          <QuadrantColorPicker />
        </Popover>
      )}
    </>
  );
}
