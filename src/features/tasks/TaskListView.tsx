import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ChevronRight } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";
import { droppedSchedule } from "../../domain/calendar";
import { todayLocal } from "../../domain/dates";
import { rangeBetween } from "../../domain/focus";
import { idsMoveBy, idsMoveNear } from "../../domain/order";
import { flattenTree, groupVMs, sortVMs, topLevelIn, type TaskVM, type TreeRow } from "../../domain/taskViews";
import type { ViewId, ViewOptions } from "../../domain/types";
import { onDrop } from "../../lib/dnd";
import { reorderTask, useData } from "../../stores/data";
import { applySchedule, currentSchedule } from "../../stores/schedule";
import { useSettings } from "../../stores/settings";
import { openTask, setSelection, toggleCollapsed, useUi } from "../../stores/ui";
import type { Derived } from "../../domain/taskViews";
import { TaskRow, type RowClick } from "./TaskRow";
import { isDayView, setManualOrder, setViewOptions, viewOptionsOf } from "./viewOptions";
import type { TaskViewSpec } from "./viewSpec";

type Row =
  | { kind: "header"; key: string; label: string; count: number; collapsible?: string; date?: string }
  | { kind: "task"; key: string; row: TreeRow; parent?: string };

/** Views ordered by date (Today, Upcoming, any list sorted or grouped by date) move tasks between days instead of reordering (D253). */
const movesByDate = (o: ViewOptions) => o.groupBy === "date" || o.sortBy === "date";

/** What each mounted Today/Upcoming shows: the top-level open task ids of every group, in display order (D331). */
const dayGroups = new Map<string, string[][]>();

/** Moves a task within its group of a day view and saves the whole view's order; the view switches to Manual. */
function reorderInDay(view: string, id: string, step: (ids: string[]) => string[]) {
  const groups = dayGroups.get(view);
  if (!groups?.some((g) => g.includes(id))) return;
  setManualOrder(view as ViewId, groups.map((g) => (g.includes(id) ? step(g) : g)).flat());
  if (viewOptionsOf(view as ViewId, useSettings.getState().settings.viewOptions).sortBy !== "manual") setViewOptions(view as ViewId, { sortBy: "manual" });
}

/** Moves a task next to `targetId`, or by `delta` places, among its siblings in its list (a list's own Manual order is `sortOrder`). */
function reorderSiblings(id: string, targetId?: string, delta?: -1 | 1) {
  const tasks = useData.getState().tasks;
  const a = tasks[id];
  if (!a) return;
  const sibs = Object.values(tasks)
    .filter((t) => !t.deletedAt && t.listId === a.listId && t.parentId === a.parentId)
    .sort((x, y) => x.sortOrder - y.sortOrder)
    .map((t) => t.id);
  const to = targetId ? sibs.indexOf(targetId) : sibs.indexOf(id) + (delta ?? 0);
  if (to >= 0 && to < sibs.length) reorderTask(id, to, sibs);
}

// Dropping a task row onto another row in the same container reorders siblings, or in a date-ordered
// view moves the task to that row's day (keeping its time). Today and Upcoming reorder within a group
// (D331): always in Manual, and in the other sorts when the rows share a day.
onDrop("task", (drag, drop) => {
  if (drag.type !== "task" || drag.container !== drop.container || drag.id === drop.id) return;
  const opts = viewOptionsOf(drop.container as ViewId, useSettings.getState().settings.viewOptions);
  const group = isDayView(drop.container) ? dayGroups.get(drop.container)?.find((g) => g.includes(drag.id) && g.includes(drop.id)) : undefined;
  if (group && (opts.sortBy === "manual" || drop.date === drag.date)) return reorderInDay(drop.container, drag.id, (ids) => idsMoveNear(ids, drag.id, drop.id));
  if (movesByDate(opts)) {
    if (drop.date === undefined || drop.date === drag.date) return;
    const ref = { source: "task" as const, id: drag.id, key: drag.key };
    const current = currentSchedule(ref);
    void applySchedule(ref, drop.date ? droppedSchedule(current, drop.date, "keepTime", 0) : { kind: "none" });
    return;
  }
  const tasks = useData.getState().tasks;
  const a = tasks[drag.id];
  const b = tasks[drop.id];
  if (!a || !b || a.parentId !== b.parentId || a.listId !== b.listId) return;
  reorderSiblings(a.id, b.id);
});

export function TaskListView(props: { spec: TaskViewSpec; vms: TaskVM[]; derived: Derived; options: ViewOptions }) {
  const { spec, vms, derived, options } = props;
  const lists = useData((s) => s.lists);
  const tags = useData((s) => s.tags);
  const collapsed = useUi((s) => s.collapsed);
  const today = todayLocal();
  const saved = useSettings((s) => s.settings.manualOrder[spec.id]);
  const dayView = isDayView(spec.id);
  const reorderable = (!!spec.list || dayView) && options.sortBy === "manual" && options.groupBy === "none";
  const container = spec.id;
  const byDate = !reorderable && movesByDate(options);

  const { rows, groups } = useMemo(() => {
    // Every view nests a subtask under its parent when both are in it; otherwise the subtask
    // stands alone, labelled with its parent (D196).
    const inView = new Set(vms.map((v) => v.task.id));
    const isOpen = (v: TaskVM) => v.task.status === "open";
    const all = (id: string) => derived.childrenOf(id);
    const childrenOf = (id: string) => sortVMs(all(id).filter((k) => inView.has(k.task.id)), "manual");
    const collapsedSet = new Set(Object.keys(collapsed));
    const parentOf = (r: TreeRow) => (r.depth === 0 && r.vm.task.parentId ? derived.byId.get(r.vm.task.parentId)?.task.title : undefined);
    const out: Row[] = [];
    const groups: string[][] = [];
    const openOnes = spec.splitCompleted ? vms.filter(isOpen) : vms;
    const roots = topLevelIn(openOnes);
    for (const g of groupVMs(sortVMs(roots, options.sortBy, saved), options.groupBy, { today, lists: new Map(Object.entries(lists)), tags: new Map(Object.entries(tags)) })) {
      // Day groups (Today, each of the next seven days) take drops too (D253).
      const date = options.groupBy !== "date" ? undefined : g.key === "1" ? today : g.key.startsWith("2:") ? g.key.slice(2) : undefined;
      if (g.label) out.push({ kind: "header", key: `h:${g.key}`, label: g.label, count: g.items.length, date });
      const ids: string[] = [];
      for (const r of flattenTree(g.items, childrenOf, collapsedSet, all)) {
        out.push({ kind: "task", key: `${g.key}:${r.vm.task.id}`, row: r, parent: parentOf(r) });
        if (r.depth === 0) ids.push(r.vm.task.id);
      }
      groups.push(ids);
    }
    if (spec.splitCompleted) {
      // Finished subtasks of an open parent in the view stay nested under it.
      const done = vms.filter((v) => !isOpen(v) && !(v.task.parentId && inView.has(v.task.parentId) && derived.byId.get(v.task.parentId)?.task.status === "open"));
      if (done.length) {
        const ck = `completed:${spec.id}`;
        // Completed starts collapsed; toggling records "expanded" in the same map.
        const expanded = !!collapsed[ck];
        out.push({ kind: "header", key: "h:done", label: "Completed", count: done.length, collapsible: ck });
        if (expanded)
          for (const vm of sortVMs(done, "created").sort((a, b) => (b.task.completedAt ?? "").localeCompare(a.task.completedAt ?? ""))) {
            const row = flattenTree([vm], () => [], collapsedSet, all)[0];
            out.push({ kind: "task", key: `done:${vm.task.id}`, row, parent: parentOf(row) });
          }
      }
    }
    return { rows: out, groups };
  }, [vms, derived, options, spec, collapsed, lists, tags, today, saved]);

  useEffect(() => {
    if (!dayView) return;
    dayGroups.set(container, groups);
    return () => void dayGroups.delete(container);
  }, [dayView, container, groups]);

  // Alt+Up / Alt+Down moves the focused row one place (D331).
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!e.altKey || (e.key !== "ArrowUp" && e.key !== "ArrowDown") || !(e.target instanceof HTMLElement)) return;
    const id = e.target.dataset.taskId;
    if (!id) return;
    const delta = e.key === "ArrowUp" ? -1 : 1;
    if (dayView) reorderInDay(container, id, (ids) => idsMoveBy(ids, id, delta));
    else if (reorderable) reorderSiblings(id, undefined, delta);
    else return;
    e.preventDefault();
    const root = e.currentTarget;
    requestAnimationFrame(() => root.querySelector(`[data-task-id="${id}"]`)?.scrollIntoView({ block: "nearest" }));
  };

  const taskIds = useMemo(() => rows.flatMap((r) => (r.kind === "task" ? [r.row.vm.task.id] : [])), [rows]);

  const onClick: RowClick = (id, e) => {
    const sel = useUi.getState().selection;
    if (e.ctrlKey || e.metaKey) return setSelection(sel.includes(id) ? sel.filter((s) => s !== id) : [...sel, id]);
    if (e.shiftKey && sel.length) {
      // An anchor that's no longer in this list (filtered or scrolled out of the view) starts the range at the clicked row.
      return setSelection(rangeBetween(taskIds, sel[sel.length - 1], id));
    }
    setSelection([id]);
    openTask(id, derived.byId.get(id)?.key ?? null);
  };

  const scroller = useRef<HTMLDivElement>(null);
  const virtual = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scroller.current,
    estimateSize: (i) => (rows[i].kind === "header" ? 48 : 36),
    overscan: 12,
    getItemKey: (i) => rows[i].key,
  });

  return (
    <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto pb-24" role="listbox" onKeyDown={onKeyDown} aria-multiselectable="true" aria-label={spec.title}>
      <SortableContext items={taskIds.map((id) => `${container}:${id}`)} strategy={verticalListSortingStrategy}>
        {/* Centred page column; the scrollbar stays at the window edge. */}
        <div className="mx-auto max-w-[var(--content-max)] px-[calc(var(--gutter)-8px)]">
        <div style={{ height: virtual.getTotalSize(), position: "relative" }}>
          {virtual.getVirtualItems().map((vi) => {
            const r = rows[vi.index];
            return (
              <div key={vi.key} data-index={vi.index} ref={virtual.measureElement} className="absolute inset-x-0" style={{ top: vi.start }}>
                {r.kind === "header" ? (
                  <GroupHeader label={r.label} count={r.count} toggleKey={r.collapsible} expanded={r.collapsible ? !!collapsed[r.collapsible] : true} date={byDate ? r.date : undefined} />
                ) : (
                  <TaskRow row={r.row} parent={r.parent} container={container} reorderable={reorderable} movesByDate={byDate} dayOrder={dayView} showList={!spec.list} onClick={onClick} />
                )}
              </div>
            );
          })}
        </div>
        </div>
      </SortableContext>
    </div>
  );
}

function GroupHeader(props: { label: string; count: number; toggleKey?: string; expanded: boolean; date?: string }) {
  // A day's header is a drop target for that day (the calendar's keep-time slot).
  const { setNodeRef, isOver } = useDroppable({ id: `group:${props.date ?? props.label}`, data: { type: "slot", date: props.date, mode: "keepTime" }, disabled: !props.date });
  const content = (
    <>
      {props.toggleKey && <ChevronRight size={16} strokeWidth={1.75} className={`transition-transform duration-[var(--dur)] ${props.expanded ? "rotate-90" : ""}`} />}
      <span className="t-label">{props.label}</span>
      <span className="text-[length:var(--fs-xs)] tabular-nums">{props.count}</span>
    </>
  );
  // A ruled 28px header (the mock's .sec-sys); padding, not margin, so the virtualizer measures the gap.
  const cls = "flex h-7 items-center gap-1.5 rounded-xs text-muted";
  return (
    <div className="pt-4 pb-1">
      <div ref={setNodeRef} className={`flex items-center rounded-xs border-b px-1 transition-colors ${isOver ? "border-accent-text bg-accent-soft text-fg" : "border-border"}`}>
        {props.toggleKey ? (
          <button type="button" aria-expanded={props.expanded} onClick={() => toggleCollapsed(props.toggleKey ?? "")} className={`${cls} hover:text-fg`}>
            {content}
          </button>
        ) : (
          <div className={cls}>{content}</div>
        )}
      </div>
    </div>
  );
}
