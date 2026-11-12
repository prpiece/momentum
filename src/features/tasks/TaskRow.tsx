import { useSortable } from "@dnd-kit/sortable";
import { ChevronRight, CornerDownRight, ListChecks, ListTree, Pin, Repeat, Bell, FileText } from "lucide-react";
import { memo, useState } from "react";
import { ListGlyph } from "../../components/ui/AppIcon";
import { TaskCheckbox } from "../../components/ui/TaskCheckbox";
import { formatTime, relativeDayLabel, todayLocal } from "../../domain/dates";
import type { TreeRow } from "../../domain/taskViews";
import { DropLine, dropSide, SORT_TRANSITION } from "../../lib/dnd";
import { reducedMotion, withTransition } from "../../lib/motion";
import { useData } from "../../stores/data";
import { useSettings } from "../../stores/settings";
import { openContextMenu, openTask, setFilter, toggleCollapsed, useUi } from "../../stores/ui";
import { toggleDone } from "./actions";
import { taskMenu } from "./taskMenu";

export type RowClick = (id: string, e: React.MouseEvent) => void;

/** One task line. Draggable everywhere (to lists, calendar, matrix); reorders only when `reorderable`. */
export const TaskRow = memo(function TaskRow(props: {
  row: TreeRow;
  /** Parent title, for a subtask shown without its parent (D196). */
  parent?: string;
  container: string;
  reorderable: boolean;
  showList: boolean;
  onClick: RowClick;
}) {
  const { vm, depth, shownKids, childCount, doneChildCount } = props.row;
  const t = vm.task;
  const selected = useUi((s) => s.selection.includes(t.id));
  const open = useUi((s) => s.drawer?.id === t.id);
  const collapsed = useUi((s) => !!s.collapsed[t.id]);
  const list = useData((s) => (props.showList ? s.lists[t.listId] : undefined));
  const tags = useData((s) => s.tags);
  const timeFormat = useSettings((s) => s.settings.timeFormat);

  const { setNodeRef, attributes, listeners, transform, transition, isDragging, isOver, index, activeIndex } = useSortable({
    id: `${props.container}:${t.id}`,
    transition: SORT_TRANSITION,
    data: { type: "task", id: t.id, key: vm.key, container: props.container },
  });
  const style = props.reorderable && transform ? { transform: `translate3d(0, ${transform.y}px, 0)`, transition } : undefined;

  const today = todayLocal();
  const done = t.status !== "open";
  const overdue = !done && vm.date !== null && vm.date < today;
  const time = vm.schedule.kind === "timed" ? formatTime(new Date(vm.schedule.start), timeFormat) : null;
  const checklistDone = t.checklist.filter((c) => c.done).length;
  // A just-added task rises in; a completed one stays struck through for a beat before it leaves the view.
  const fresh = Date.now() - Date.parse(t.createdAt) < 1500;
  const [leaving, setLeaving] = useState(false);
  const complete = () => {
    if (t.status !== "open" || reducedMotion()) return toggleDone(t.id, vm.key);
    setLeaving(true);
    setTimeout(() => withTransition(() => (toggleDone(t.id, vm.key), setLeaving(false)), "vt-rows"), 300);
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      role="option"
      aria-selected={selected}
      data-task-id={t.id}
      onClick={(e) => props.onClick(t.id, e)}
      onContextMenu={(e) => openContextMenu(e, taskMenu(t.id, vm.key))}
      onKeyDown={(e) => {
        if (e.key === "Enter") openTask(t.id, vm.key);
        if (e.key === " ") {
          e.preventDefault();
          toggleDone(t.id, vm.key);
        }
      }}
      className={`group relative flex h-[var(--row)] cursor-default items-center gap-3 rounded-control pr-2 text-[length:var(--fs-base)] max-[719px]:h-auto max-[719px]:min-h-[var(--row-touch)] max-[719px]:items-start max-[719px]:rounded-none max-[719px]:border-b max-[719px]:border-border max-[719px]:py-3 max-[719px]:[&>.check]:mt-0.5 outline-none transition-opacity duration-[var(--dur)] focus-visible:shadow-[inset_0_0_0_2px_var(--accent-text)] focus-visible:outline-none ${
        isDragging ? "bg-accent-soft opacity-40" : ""
      } ${selected || open ? "bg-accent-soft" : "hover:bg-surface-2"} ${fresh ? "anim-rise" : ""} ${leaving ? "opacity-50" : ""}`}
    >
      <DropLine side={props.reorderable ? dropSide({ isOver, isDragging, index, activeIndex }) : null} />
      {/* A fixed toggle gutter keeps every checkbox in a column, with or without subtasks. */}
      <div style={{ width: 20 + depth * 20 }} className="-mr-1.5 flex shrink-0 items-center justify-end self-stretch max-[719px]:mt-0.5 max-[719px]:h-[var(--checkbox)] max-[719px]:self-start">
        {shownKids > 0 && (
          <button
            type="button"
            aria-label={collapsed ? "Expand subtasks" : "Collapse subtasks"}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              toggleCollapsed(t.id);
            }}
            className="grid size-4 place-items-center rounded-xs text-muted hover:bg-surface-2 hover:text-fg focus-visible:ring-2 focus-visible:ring-accent"
          >
            <ChevronRight size={14} className={`transition-transform duration-[var(--dur)] ${collapsed ? "" : "rotate-90"}`} />
          </button>
        )}
      </div>
      <TaskCheckbox status={leaving ? "done" : t.status} priority={t.priority} onToggle={complete} label={`Complete ${t.title}`} />
      {/* One line on desktop; below 720px the title, then a second line with the due date first (D200). */}
      <div className="flex min-w-0 flex-1 items-center gap-3 max-[719px]:flex-col max-[719px]:items-stretch max-[719px]:gap-0.5">
      <div className={`min-w-0 flex-1 truncate ${done || leaving ? "font-normal text-muted line-through decoration-1" : "font-medium"}`}>
        {t.title || <span className="text-muted">Untitled</span>}
      </div>
      <div className="contents max-[719px]:flex max-[719px]:items-center max-[719px]:gap-2.5 max-[719px]:overflow-hidden">
      {/* Meta, right of the title (D198): markers, counts, tags, the parent and the list. */}
      <div className={`flex min-w-0 shrink items-center gap-2.5 overflow-hidden text-[length:var(--fs-sm)] text-muted ${done ? "opacity-70" : ""}`}>
        {t.pinned && <Pin size={14} className="shrink-0 text-accent-text" aria-label="Pinned" />}
        {t.reminders.length > 0 && <Bell size={16} strokeWidth={1.75} className="shrink-0" aria-label="Has reminders" />}
        {t.description && <FileText size={16} strokeWidth={1.75} className="shrink-0" aria-label="Has notes" />}
        {t.recurrence && <Repeat size={16} strokeWidth={1.75} className="shrink-0" aria-label="Repeats" />}
        {childCount > 0 && (
          <span className="inline-flex shrink-0 items-center gap-[3px] tabular-nums" aria-label={`Subtasks ${doneChildCount} of ${childCount} done`}>
            <ListTree size={16} strokeWidth={1.75} />
            {doneChildCount}/{childCount}
          </span>
        )}
        {t.checklist.length > 0 && (
          <span className="inline-flex shrink-0 items-center gap-[3px] tabular-nums" aria-label={`Checklist ${checklistDone} of ${t.checklist.length} done`}>
            <ListChecks size={16} strokeWidth={1.75} />
            {checklistDone}/{t.checklist.length}
          </span>
        )}
        {t.tags.map((id) =>
          tags[id] ? (
            <button
              key={id}
              type="button"
              title={`Filter by #${tags[id].name}`}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                setFilter(useUi.getState().view, `#${tags[id].name}`);
              }}
              className="shrink-0 rounded-xs hover:text-fg"
            >
              #{tags[id].name}
            </button>
          ) : null,
        )}
        {props.parent && (
          <span className="inline-flex min-w-0 max-w-40 items-center gap-1" title={`Subtask of ${props.parent}`}>
            <CornerDownRight size={14} className="shrink-0" />
            <span className="truncate">{props.parent}</span>
          </span>
        )}
        {list && (
          <span className="inline-flex min-w-0 max-w-36 items-center gap-1.5">
            <ListGlyph icon={list.icon} color={list.color} size={14} />
            <span className="truncate">{list.name}</span>
          </span>
        )}
      </div>
      {/* Only dated rows get a date, so the meta sits against the row's right edge when there is none. */}
      {vm.date && (
        <span className={`shrink-0 whitespace-nowrap text-right text-[length:var(--fs-sm)] tabular-nums max-[719px]:order-first max-[719px]:text-left ${overdue ? "text-danger" : "text-fg-2"} ${done ? "opacity-70" : ""}`}>
          {vm.date === today ? (time ?? "Today") : `${relativeDayLabel(vm.date, today)}${time ? ` ${time}` : ""}`}
        </span>
      )}
      </div>
      </div>
    </div>
  );
});
