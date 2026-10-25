import { useSortable } from "@dnd-kit/sortable";
import { ChevronRight, ListChecks, Pin, Repeat, Bell, FileText } from "lucide-react";
import { memo } from "react";
import { TaskCheckbox } from "../../components/ui/TaskCheckbox";
import { formatTime, relativeDayLabel, todayLocal } from "../../domain/dates";
import type { TreeRow } from "../../domain/taskViews";
import { useData } from "../../stores/data";
import { useSettings } from "../../stores/settings";
import { openTask, toggleCollapsed, useUi } from "../../stores/ui";
import { toggleDone } from "./actions";

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

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      role="option"
      aria-selected={selected}
      onClick={(e) => props.onClick(t.id, e)}
      onKeyDown={(e) => {
        if (e.key === "Enter") openTask(t.id, vm.key);
        if (e.key === " ") {
          e.preventDefault();
          toggleDone(t.id, vm.key);
        }
      }}
      className={`group relative flex min-h-[var(--row-h)] cursor-default items-start gap-2.5 rounded-sm py-[calc(var(--pad)*0.6)] pr-3 outline-none transition-colors duration-[var(--dur)] focus-visible:ring-2 focus-visible:ring-accent ${
        isDragging ? "opacity-40" : ""
      } ${selected || open ? "bg-accent-soft" : "hover:bg-hover"}`}
    >
      <div style={{ width: 8 + depth * 18 }} className="flex shrink-0 justify-end pt-[3px]">
        {childCount > 0 && (
          <button
            type="button"
            aria-label={collapsed ? "Expand subtasks" : "Collapse subtasks"}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              toggleCollapsed(t.id);
            }}
            className="-mr-1 grid size-4 place-items-center rounded text-muted hover:text-fg"
          >
            <ChevronRight size={14} className={`transition-transform duration-[var(--dur)] ${collapsed ? "" : "rotate-90"}`} />
          </button>
        )}
      </div>
      <div className="pt-[2px]">
        <TaskCheckbox status={t.status} priority={t.priority} onToggle={() => toggleDone(t.id, vm.key)} label={`Complete ${t.title}`} />
      </div>
      <div className="min-w-0 flex-1">
        <div className={`truncate text-[0.9rem] leading-6 ${done ? "text-muted line-through decoration-1" : ""}`}>
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
            <span className="inline-flex items-center gap-1">
              <ChevronRight size={11} />
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
              <span key={id} className="rounded-full bg-hover px-1.5 text-[0.7rem] text-fg-2">
                #{tags[id].name}
              </span>
            ) : null,
          )}
        </Meta>
      </div>
      <div className="flex shrink-0 items-center gap-2 pt-[3px] text-xs text-muted">
        {t.pinned && <Pin size={13} className="text-accent" aria-label="Pinned" />}
        {list && (
          <span className="flex max-w-32 items-center gap-1 truncate">
            {list.emoji ?? <span className="size-2 rounded-full" style={{ background: list.color ?? "var(--fg-muted)" }} />}
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
