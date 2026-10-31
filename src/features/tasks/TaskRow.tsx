import { useSortable } from "@dnd-kit/sortable";
import { ChevronRight, ListChecks, ListTree, Pin, Repeat, Bell, FileText } from "lucide-react";
import { memo, useState } from "react";
import { ListGlyph } from "../../components/ui/AppIcon";
import { TaskCheckbox } from "../../components/ui/TaskCheckbox";
import { formatTime, relativeDayLabel, todayLocal } from "../../domain/dates";
import type { TreeRow } from "../../domain/taskViews";
import { reducedMotion } from "../../lib/motion";
import { useData } from "../../stores/data";
import { useSettings } from "../../stores/settings";
import { openContextMenu, openTask, setFilter, toggleCollapsed, useUi } from "../../stores/ui";
import { toggleDone } from "./actions";
import { taskMenu } from "./taskMenu";

export type RowClick = (id: string, e: React.MouseEvent) => void;

/** One task line. Draggable everywhere (to lists, calendar, matrix); reorders only when `reorderable`. */
export const TaskRow = memo(function TaskRow(props: {
  row: TreeRow;
  container: string;
  reorderable: boolean;
  showList: boolean;
  onClick: RowClick;
}) {
  const { vm, depth, childCount, doneChildCount } = props.row;
  const t = vm.task;
  const selected = useUi((s) => s.selection.includes(t.id));
  const open = useUi((s) => s.drawer?.id === t.id);
  const collapsed = useUi((s) => !!s.collapsed[t.id]);
  const list = useData((s) => (props.showList ? s.lists[t.listId] : undefined));
  const tags = useData((s) => s.tags);
  const timeFormat = useSettings((s) => s.settings.timeFormat);

  const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({
    id: `${props.container}:${t.id}`,
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
    setTimeout(() => (toggleDone(t.id, vm.key), setLeaving(false)), 300);
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
      className={`group relative flex min-h-[var(--row-h)] cursor-default items-start gap-2.5 rounded-sm py-[calc(var(--pad)*0.6)] pr-3 outline-none transition-[color,background-color,opacity] duration-[var(--dur)] focus-visible:ring-2 focus-visible:ring-accent ${
        isDragging ? "opacity-40" : ""
      } ${selected || open ? "bg-accent-soft" : "hover:bg-hover"} ${fresh ? "anim-rise" : ""} ${leaving ? "opacity-50" : ""}`}
    >
      {/* A fixed toggle gutter keeps every checkbox in a column, with or without subtasks. */}
      <div style={{ width: 16 + depth * 20 }} className="flex h-6 shrink-0 items-center justify-end">
        {childCount > 0 && (
          <button
            type="button"
            aria-label={collapsed ? "Expand subtasks" : "Collapse subtasks"}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              toggleCollapsed(t.id);
            }}
            className="grid size-4 place-items-center rounded text-muted hover:bg-hover hover:text-fg focus-visible:ring-2 focus-visible:ring-accent"
          >
            <ChevronRight size={14} className={`transition-transform duration-[var(--dur)] ${collapsed ? "" : "rotate-90"}`} />
          </button>
        )}
      </div>
      <div className="flex h-6 items-center">
        <TaskCheckbox status={leaving ? "done" : t.status} priority={t.priority} onToggle={complete} label={`Complete ${t.title}`} />
      </div>
      <div className="min-w-0 flex-1">
        <div className={`truncate text-[0.9rem] leading-6 transition-colors duration-[var(--dur)] ${done || leaving ? "text-muted line-through decoration-1" : ""}`}>
          {t.title || <span className="text-muted">Untitled</span>}
        </div>
        <Meta>
          {vm.date && (
            <span className={overdue ? "font-medium text-danger" : vm.date === today ? "text-accent" : ""}>
              {relativeDayLabel(vm.date, today)}
              {time && ` ${time}`}
            </span>
          )}
          {t.recurrence && <Repeat size={12} aria-label="Repeats" />}
          {t.reminders.length > 0 && <Bell size={12} aria-label="Has reminders" />}
          {t.description && <FileText size={12} aria-label="Has notes" />}
          {childCount > 0 && (
            <span className="inline-flex items-center gap-1" aria-label="Subtasks done">
              <ListTree size={12} />
              {doneChildCount}/{childCount}
            </span>
          )}
          {t.checklist.length > 0 && (
            <span className="inline-flex items-center gap-1">
              <ListChecks size={12} />
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
                className="rounded-full bg-hover px-1.5 text-[0.7rem] text-fg-2 hover:bg-accent-soft hover:text-fg focus-visible:ring-2 focus-visible:ring-accent"
              >
                #{tags[id].name}
              </button>
            ) : null,
          )}
        </Meta>
      </div>
      <div className="flex h-6 shrink-0 items-center gap-2 text-xs text-muted">
        {t.pinned && <Pin size={13} className="text-accent" aria-label="Pinned" />}
        {list && (
          <span className="flex max-w-32 items-center gap-1 truncate">
            <ListGlyph icon={list.icon} color={list.color} size={13} />
            {list.name}
          </span>
        )}
      </div>
    </div>
  );
});

/** The secondary line under a title; renders nothing when it has no visible children. */
function Meta({ children }: { children: React.ReactNode }) {
  const items = (Array.isArray(children) ? children.flat() : [children]).filter((c) => c !== false && c != null && !(Array.isArray(c) && !c.length));
  if (!items.length) return null;
  return <div className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-muted">{children}</div>;
}
