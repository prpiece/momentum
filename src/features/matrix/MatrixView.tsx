import { useDraggable, useDroppable } from "@dnd-kit/core";
import { ListTree, Settings2 } from "lucide-react";
import { useMemo, useState } from "react";
import { Popover, useMenu } from "../../components/ui/Popover";
import { TaskCheckbox } from "../../components/ui/TaskCheckbox";
import { relativeDayLabel, todayLocal } from "../../domain/dates";
import { patchForQuadrant, QUADRANT_INFO, QUADRANTS, quadrantOf, type Quadrant } from "../../domain/matrix";
import { sortVMs, type TaskVM } from "../../domain/taskViews";
import { PRIORITIES, PRIORITY_LABEL, type Priority } from "../../domain/types";
import { justDragged, onDrop } from "../../lib/dnd";
import { withUndo } from "../../lib/undo";
import { addTask, rootOf, updateTask, useData } from "../../stores/data";
import { useSettings } from "../../stores/settings";
import { openContextMenu, openTask, useUi } from "../../stores/ui";
import { editTask, toggleDone } from "../tasks/actions";
import { taskMenu } from "../tasks/taskMenu";
import { derive, useDerived } from "../tasks/selectors";

const TONE: Record<Quadrant, string> = { 1: "var(--p3)", 2: "var(--accent)", 3: "var(--p2)", 4: "var(--fg-muted)" };

onDrop("quadrant", (drag, drop) => {
  if (drag.type !== "task") return;
  const { tasks, lists } = useData.getState();
  const rules = useSettings.getState().settings.matrix;
  const today = todayLocal();
  const sel = useUi.getState().selection;
  // A dragged subtask moves its parent: the matrix only holds top-level tasks (D58).
  const ids = [...new Set((sel.includes(drag.id) ? sel : [drag.id]).map(rootOf))];
  const d = derive(tasks, lists);
  const vms = ids.map((id) => d.byId.get(id)).filter((v): v is TaskVM => !!v);
  const series = vms.filter((v) => v.task.recurrence && "schedule" in patchForQuadrant(v, drop.q, today, rules));
  const plain = vms.filter((v) => !series.includes(v));
  if (plain.length)
    withUndo(`Moved to ${QUADRANT_INFO[drop.q].title}`, () => plain.forEach((v) => updateTask(v.task.id, patchForQuadrant(v, drop.q, today, rules))));
  // Recurring tasks whose date must change go through the scope prompt.
  for (const v of series) void editTask(v.task.id, patchForQuadrant(v, drop.q, today, rules), v.key);
});

export function MatrixView() {
  const derived = useDerived();
  const rules = useSettings((s) => s.settings.matrix);
  const today = todayLocal();
  const groups = useMemo(() => {
    const out: Record<Quadrant, TaskVM[]> = { 1: [], 2: [], 3: [], 4: [] };
    for (const vm of derived.roots) if (vm.task.status === "open") out[quadrantOf(vm, today, rules)].push(vm);
    for (const q of QUADRANTS) out[q] = sortVMs(out[q], "date");
    return out;
  }, [derived, rules, today]);

  return (
    <div className="flex h-full min-h-0 flex-col px-4 pb-4">
      <div className="flex items-center justify-end px-2 pb-2">
        <RulesEditor />
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-2 grid-rows-2 gap-3">
        {QUADRANTS.map((q) => (
          <QuadrantPanel key={q} q={q} items={groups[q]} />
        ))}
      </div>
    </div>
  );
}

function QuadrantPanel({ q, items }: { q: Quadrant; items: TaskVM[] }) {
  const info = QUADRANT_INFO[q];
  const rules = useSettings((s) => s.settings.matrix);
  const { setNodeRef, isOver } = useDroppable({ id: `quadrant:${q}`, data: { type: "quadrant", q } });
  const [draft, setDraft] = useState("");
  const add = () => {
    const title = draft.trim();
    if (!title) return;
    // New tasks inherit the quadrant's attributes (same rule as dropping a blank task here).
    addTask({ title, ...patchForQuadrant({ task: { priority: 0 }, date: null, schedule: { kind: "none" } }, q, todayLocal(), rules) });
    setDraft("");
  };
  return (
    <section
      ref={setNodeRef}
      aria-label={info.title}
      className={`flex min-h-0 flex-col rounded-lg border bg-surface-2 shadow-sm transition-colors duration-[var(--dur)] ${isOver ? "border-accent bg-accent-soft" : "border-border"}`}
      style={{ borderTopColor: TONE[q], borderTopWidth: 3 }}
    >
      <header className="flex items-baseline gap-2 px-4 pb-2 pt-3">
        <span className="grid size-5 place-items-center rounded-full font-mono text-[0.7rem] font-bold text-white" style={{ background: TONE[q] }}>
          {q}
        </span>
        <h2 className="text-sm font-semibold">{info.title}</h2>
        <span className="text-xs text-muted">{info.hint}</span>
        <span className="ml-auto font-mono text-xs text-muted">{items.length}</span>
      </header>
      <ul className="scroll-thin min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2">
        {items.map((vm) => (
          <MatrixItem key={vm.task.id} vm={vm} />
        ))}
        {!items.length && <li className="px-2 py-6 text-center text-xs text-muted">Drop tasks here</li>}
      </ul>
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && add()}
        placeholder={`+ Add to ${info.title}`}
        aria-label={`Add task to ${info.title}`}
        className="m-2 h-9 rounded-sm bg-transparent px-2 text-sm outline-none placeholder:text-muted focus:bg-surface"
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
      className={`flex cursor-grab items-center gap-2.5 rounded-sm px-2 py-1.5 text-sm transition-colors ${selected ? "bg-accent-soft" : "hover:bg-hover"} ${isDragging ? "opacity-40" : ""}`}
    >
      <TaskCheckbox status={t.status} priority={t.priority} onToggle={() => toggleDone(t.id, vm.key)} label={`Complete ${t.title}`} size={16} />
      <span className="min-w-0 flex-1 truncate">{t.title}</span>
      {kids.length > 0 && (
        <span className="flex shrink-0 items-center gap-1 text-xs text-muted" aria-label="Subtasks done">
          <ListTree size={12} />
          {kids.filter((k) => k.task.status !== "open").length}/{kids.length}
        </span>
      )}
      {vm.date && <span className={`shrink-0 text-xs ${vm.date < today ? "text-danger" : "text-muted"}`}>{relativeDayLabel(vm.date, today)}</span>}
      {list && list.id !== "inbox" && <span className="max-w-24 shrink-0 truncate text-xs text-muted">{list.name}</span>}
    </li>
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
      <button ref={menu.anchor} type="button" onClick={menu.toggle} className="flex h-8 items-center gap-1.5 rounded-sm px-2.5 text-xs text-fg-2 hover:bg-hover">
        <Settings2 size={15} /> Rules
      </button>
      {menu.open && (
        <Popover anchor={menu.anchor} onClose={menu.close} align="end" className="w-72 p-4">
          <h3 className="text-sm font-semibold">Important means priority…</h3>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {[...PRIORITIES].reverse().map((p) => (
              <button
                key={p}
                type="button"
                aria-pressed={rules.importantPriorities.includes(p)}
                onClick={() => toggle(p)}
                className={`h-7 rounded-full px-3 text-xs ${rules.importantPriorities.includes(p) ? "bg-accent text-accent-fg" : "bg-hover text-fg-2"}`}
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
              className="h-8 w-16 rounded-sm border border-border bg-surface px-2 outline-none focus:border-accent"
            />
            days (or overdue)
          </div>
          <p className="mt-3 text-xs text-muted">Dragging a task between quadrants changes its priority and due date to match these rules.</p>
        </Popover>
      )}
    </>
  );
}
