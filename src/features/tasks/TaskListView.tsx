import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ChevronRight } from "lucide-react";
import { useMemo, useRef } from "react";
import { todayLocal } from "../../domain/dates";
import { flattenTree, groupVMs, sortVMs, type TaskVM, type TreeRow } from "../../domain/taskViews";
import type { ViewOptions } from "../../domain/types";
import { onDrop } from "../../lib/dnd";
import { reorderTask, useData } from "../../stores/data";
import { openTask, setSelection, toggleCollapsed, useUi } from "../../stores/ui";
import type { Derived } from "./selectors";
import { TaskRow, type RowClick } from "./TaskRow";
import type { TaskViewSpec } from "./viewSpec";

type Row =
  | { kind: "header"; key: string; label: string; count: number; collapsible?: string }
  | { kind: "task"; key: string; row: TreeRow };

// Dropping a task row onto another row in the same container reorders siblings.
onDrop("task", (drag, drop) => {
  if (drag.type !== "task" || drag.container !== drop.container || drag.id === drop.id) return;
  const tasks = useData.getState().tasks;
  const a = tasks[drag.id];
  const b = tasks[drop.id];
  if (!a || !b || a.parentId !== b.parentId || a.listId !== b.listId) return;
  const sibs = Object.values(tasks)
    .filter((t) => !t.deletedAt && t.listId === b.listId && t.parentId === b.parentId)
    .sort((x, y) => x.sortOrder - y.sortOrder);
  reorderTask(a.id, sibs.findIndex((t) => t.id === b.id), sibs.map((t) => t.id));
});

export function TaskListView(props: { spec: TaskViewSpec; vms: TaskVM[]; derived: Derived; options: ViewOptions }) {
  const { spec, vms, derived, options } = props;
  const lists = useData((s) => s.lists);
  const tags = useData((s) => s.tags);
  const collapsed = useUi((s) => s.collapsed);
  const today = todayLocal();
  const reorderable = !!spec.list && options.sortBy === "manual" && options.groupBy === "none";
  const container = spec.id;

  const rows = useMemo<Row[]>(() => {
    const inView = new Set(vms.map((v) => v.task.id));
    const isOpen = (v: TaskVM) => v.task.status === "open";
    const parentShown = (v: TaskVM) => !!v.task.parentId && inView.has(v.task.parentId);
    const openOnes = spec.splitCompleted ? vms.filter(isOpen) : vms;
    const roots = spec.tree ? openOnes.filter((v) => !parentShown(v)) : openOnes;
    const childrenOf = (id: string) => sortVMs(derived.childrenOf(id).filter((k) => inView.has(k.task.id)), "manual");
    const collapsedSet = new Set(Object.keys(collapsed));
    const out: Row[] = [];
    for (const g of groupVMs(sortVMs(roots, options.sortBy), options.groupBy, { today, lists: new Map(Object.entries(lists)), tags: new Map(Object.entries(tags)) })) {
      if (g.label) out.push({ kind: "header", key: `h:${g.key}`, label: g.label, count: g.items.length });
      const tree = spec.tree ? flattenTree(g.items, childrenOf, collapsedSet) : g.items.map((vm) => ({ vm, depth: 0, childCount: 0, doneChildCount: 0 }));
      for (const r of tree) out.push({ kind: "task", key: `${g.key}:${r.vm.task.id}`, row: r });
    }
    if (spec.splitCompleted) {
      const done = vms.filter((v) => !isOpen(v) && !(parentShown(v) && spec.tree && derived.byId.get(v.task.parentId ?? "")?.task.status === "open"));
      if (done.length) {
        const ck = `completed:${spec.id}`;
        // Completed starts collapsed; toggling records "expanded" in the same map.
        const expanded = !!collapsed[ck];
        out.push({ kind: "header", key: "h:done", label: "Completed", count: done.length, collapsible: ck });
        if (expanded)
          for (const vm of sortVMs(done, "created").sort((a, b) => (b.task.completedAt ?? "").localeCompare(a.task.completedAt ?? "")))
            out.push({ kind: "task", key: `done:${vm.task.id}`, row: { vm, depth: 0, childCount: 0, doneChildCount: 0 } });
      }
    }
    return out;
  }, [vms, derived, options, spec, collapsed, lists, tags, today]);

  const taskIds = useMemo(() => rows.flatMap((r) => (r.kind === "task" ? [r.row.vm.task.id] : [])), [rows]);

  const onClick: RowClick = (id, e) => {
    const sel = useUi.getState().selection;
    if (e.ctrlKey || e.metaKey) return setSelection(sel.includes(id) ? sel.filter((s) => s !== id) : [...sel, id]);
    if (e.shiftKey && sel.length) {
      const a = taskIds.indexOf(sel[sel.length - 1]);
      const b = taskIds.indexOf(id);
      return setSelection(taskIds.slice(Math.min(a, b), Math.max(a, b) + 1));
    }
    setSelection([id]);
    openTask(id, derived.byId.get(id)?.key ?? null);
  };

  const scroller = useRef<HTMLDivElement>(null);
  const virtual = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scroller.current,
    estimateSize: (i) => (rows[i].kind === "header" ? 36 : 44),
    overscan: 12,
    getItemKey: (i) => rows[i].key,
  });

  return (
    <div ref={scroller} className="scroll-thin min-h-0 flex-1 overflow-y-auto px-4 pb-24" role="listbox" aria-multiselectable="true" aria-label={spec.title}>
      <SortableContext items={taskIds.map((id) => `${container}:${id}`)} strategy={verticalListSortingStrategy}>
        <div style={{ height: virtual.getTotalSize(), position: "relative" }}>
          {virtual.getVirtualItems().map((vi) => {
            const r = rows[vi.index];
            return (
              <div key={vi.key} data-index={vi.index} ref={virtual.measureElement} className="absolute inset-x-0" style={{ top: vi.start }}>
                {r.kind === "header" ? (
                  <GroupHeader label={r.label} count={r.count} toggleKey={r.collapsible} expanded={r.collapsible ? !!collapsed[r.collapsible] : true} />
                ) : (
                  <TaskRow row={r.row} container={container} reorderable={reorderable} showList={!spec.list} onClick={onClick} />
                )}
              </div>
            );
          })}
        </div>
      </SortableContext>
    </div>
  );
}

function GroupHeader(props: { label: string; count: number; toggleKey?: string; expanded: boolean }) {
  const content = (
    <>
      {props.toggleKey && <ChevronRight size={14} className={`transition-transform duration-[var(--dur)] ${props.expanded ? "rotate-90" : ""}`} />}
      <span>{props.label}</span>
      <span className="font-mono font-normal text-muted">{props.count}</span>
    </>
  );
  const cls = "flex items-center gap-1.5 px-2 pb-1.5 pt-4 text-xs font-semibold uppercase tracking-wider text-fg-2";
  return props.toggleKey ? (
    <button type="button" aria-expanded={props.expanded} onClick={() => toggleCollapsed(props.toggleKey ?? "")} className={`${cls} hover:text-fg`}>
      {content}
    </button>
  ) : (
    <div className={cls}>{content}</div>
  );
}
