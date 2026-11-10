import { useDndContext, useDraggable, useDroppable } from "@dnd-kit/core";
import { horizontalListSortingStrategy, SortableContext, useSortable } from "@dnd-kit/sortable";
import { MoreHorizontal, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { MenuItem, Popover, useMenu } from "../../components/ui/Popover";
import { TaskCheckbox } from "../../components/ui/TaskCheckbox";
import { relativeDayLabel, todayLocal } from "../../domain/dates";
import { sortVMs, topLevelIn, type TaskVM } from "../../domain/taskViews";
import type { Section, TaskList } from "../../domain/types";
import { onDrop } from "../../lib/dnd";
import { addSection, moveSection, removeSection, updateSection, updateTask, useData } from "../../stores/data";
import { confirm, openContextMenu, openTask, useUi } from "../../stores/ui";
import { toggleDone } from "./actions";
import { InlineAdd } from "./InlineAdd";
import { taskMenu } from "./taskMenu";

onDrop("kanban-column", (drag, drop) => {
  if (drag.type !== "task") return;
  const sel = useUi.getState().selection;
  const ids = sel.includes(drag.id) ? sel : [drag.id];
  for (const id of ids) updateTask(id, { listId: drop.listId, sectionId: drop.sectionId });
});

onDrop("column", (drag, drop) => {
  if (drag.type !== "column" || drag.id === drop.id) return;
  const siblings = Object.values(useData.getState().sections).filter((x) => x.listId === drop.listId).sort((a, b) => a.sortOrder - b.sortOrder);
  const to = siblings.findIndex((x) => x.id === drop.id);
  if (to >= 0) moveSection(drag.id, to);
});

/** Board of the list's sections; the first column holds tasks without a section. */
export function KanbanView({ list, vms }: { list: TaskList; vms: TaskVM[] }) {
  const allSections = useData((s) => s.sections);
  const sections = useMemo(
    () => Object.values(allSections).filter((x) => x.listId === list.id).sort((a, b) => a.sortOrder - b.sortOrder),
    [allSections, list.id],
  );
  const roots = sortVMs(topLevelIn(vms.filter((v) => v.task.status === "open")), "manual");
  const [adding, setAdding] = useState(false);
  const unsectioned = roots.filter((v) => !v.task.sectionId || !sections.some((s) => s.id === v.task.sectionId));
  // Only when it holds tasks, or there are no sections to add to (D88). Never conjured by a drag.
  const showUnsectioned = unsectioned.length > 0 || sections.length === 0;
  const columns: { section: Section | null; items: TaskVM[] }[] = [
    ...(showUnsectioned ? [{ section: null, items: unsectioned }] : []),
    ...sections.map((section) => ({ section, items: roots.filter((v) => v.task.sectionId === section.id) })),
  ];

  return (
    <div className="flex min-h-0 flex-1 items-start gap-3 overflow-x-auto px-[var(--gutter)] pb-6">
      <SortableContext items={sections.map((s) => `col:${s.id}`)} strategy={horizontalListSortingStrategy}>
        {columns.map((c) => (
          <Column key={c.section?.id ?? "none"} list={list} section={c.section} items={c.items} index={c.section ? sections.indexOf(c.section) : -1} count={sections.length} />
        ))}
      </SortableContext>
      <div className="w-40 shrink-0">
        {adding ? (
          <input
            autoFocus
            placeholder="Section name"
            className="input"
            onBlur={() => setAdding(false)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && e.currentTarget.value.trim()) {
                addSection(list.id, e.currentTarget.value.trim());
                setAdding(false);
              }
              if (e.key === "Escape") setAdding(false);
            }}
          />
        ) : (
          <button type="button" onClick={() => setAdding(true)} className="btn btn-ghost w-full justify-start">
            <Plus size={16} strokeWidth={1.75} /> Add section
          </button>
        )}
      </div>
    </div>
  );
}

function Column({ list, section, items, index, count }: { list: TaskList; section: Section | null; items: TaskVM[]; index: number; count: number }) {
  const dragType = useDndContext().active?.data.current?.type;
  // Task drops and column reorder use separate droppables on the same node, enabled one at a time.
  const drop = useDroppable({
    id: `kanban:${list.id}:${section?.id ?? "none"}`,
    data: { type: "kanban-column", listId: list.id, sectionId: section?.id ?? null },
    disabled: dragType === "column",
  });
  const sort = useSortable({
    id: `col:${section?.id ?? "none"}`,
    data: { type: "column", id: section?.id ?? "", listId: list.id },
    disabled: !section || dragType === "task",
  });
  const { isOver } = drop;
  const setNodeRef = (el: HTMLElement | null) => (drop.setNodeRef(el), sort.setNodeRef(el));
  const menu = useMenu();
  const [renaming, setRenaming] = useState(false);

  return (
    <section
      ref={setNodeRef}
      style={{ transform: sort.transform ? `translate3d(${sort.transform.x}px, 0, 0)` : undefined, transition: sort.transition }}
      aria-label={section?.name ?? "Unsectioned"}
      className={`flex max-h-full w-[280px] shrink-0 flex-col rounded-card border px-2 pb-2 ${
        sort.isDragging ? "z-10 opacity-80 shadow-float " : ""
      }${
        isOver ? "border-accent-text bg-accent-soft" : "border-transparent bg-bg"
      }`}
    >
      <header
        ref={section ? sort.setActivatorNodeRef : undefined}
        {...(section && !renaming ? { ...sort.attributes, ...sort.listeners } : {})}
        className={`flex h-10 shrink-0 items-center gap-2 px-1 ${section ? "cursor-grab" : ""}`}
      >
        {renaming && section ? (
          <input
            autoFocus
            defaultValue={section.name}
            className="input h-7 min-w-0 flex-1"
            onBlur={(e) => {
              if (e.target.value.trim()) updateSection(section.id, { name: e.target.value.trim() });
              setRenaming(false);
            }}
            onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          />
        ) : (
          <h3 className="min-w-0 truncate text-[length:var(--fs-sm)] font-semibold">{section?.name ?? "Unsectioned"}</h3>
        )}
        <span className="mr-auto text-[length:var(--fs-sm)] tabular-nums text-muted">{items.length}</span>
        {section && (
          <button ref={menu.anchor} type="button" aria-label="Section options" onClick={menu.toggle} className="btn btn-ghost btn-sm icon-btn text-muted">
            <MoreHorizontal size={16} strokeWidth={1.75} />
          </button>
        )}
        {menu.open && section && (
          <Popover anchor={menu.anchor} onClose={menu.close} align="end">
            <MenuItem onSelect={() => (menu.close(), setRenaming(true))}>Rename</MenuItem>
            <MenuItem disabled={index <= 0} onSelect={() => (menu.close(), moveSection(section.id, index - 1))}>Move left</MenuItem>
            <MenuItem disabled={index >= count - 1} onSelect={() => (menu.close(), moveSection(section.id, index + 1))}>Move right</MenuItem>
            <MenuItem
              danger
              onSelect={async () => {
                menu.close();
                if (await confirm(`Delete section “${section.name}”?`, "Its tasks move to “Unsectioned”.")) removeSection(section.id);
              }}
            >
              Delete section
            </MenuItem>
          </Popover>
        )}
      </header>
      <div className="flex min-h-16 flex-1 flex-col gap-2 overflow-y-auto">
        {items.map((vm) => (
          <Card key={vm.task.id} vm={vm} />
        ))}
      </div>
      <InlineAdd
        defaults={{ listId: list.id, sectionId: section?.id ?? null }}
        position="bottom"
        placeholder="+ Add task"
        label={`Add task to ${section?.name ?? "Unsectioned"}`}
        className="mt-1 h-8 shrink-0 rounded-control border border-transparent bg-transparent px-2 text-[length:var(--fs-sm)] outline-none placeholder:text-muted hover:bg-surface-2 focus-visible:border-accent-text focus-visible:bg-surface focus-visible:shadow-[var(--focus-ring-input)] focus-visible:outline-none"
      />
    </section>
  );
}

function Card({ vm }: { vm: TaskVM }) {
  const t = vm.task;
  const { setNodeRef, attributes, listeners, isDragging } = useDraggable({ id: `card:${t.id}`, data: { type: "task", id: t.id, key: vm.key } });
  const today = todayLocal();
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onClick={() => openTask(t.id, vm.key)}
      onContextMenu={(e) => openContextMenu(e, taskMenu(t.id, vm.key))}
      onKeyDown={(e) => e.key === "Enter" && openTask(t.id, vm.key)}
      className={`flex cursor-grab flex-col gap-2 rounded-card border border-border bg-surface px-3 py-2.5 hover:border-border-strong ${isDragging ? "opacity-40" : ""}`}
    >
      <div className="flex items-start gap-2.5 font-medium">
        <span className="mt-px">
          <TaskCheckbox status={t.status} priority={t.priority} onToggle={() => toggleDone(t.id, vm.key)} label={`Complete ${t.title}`} />
        </span>
        <span className={`min-w-0 flex-1 ${t.status !== "open" ? "font-normal text-muted line-through" : ""}`}>{t.title}</span>
      </div>
      {vm.date && (
        <div className="flex items-center gap-2.5 pl-7 text-[length:var(--fs-sm)] text-muted">
          <span className={`ml-auto tabular-nums ${t.status === "open" && vm.date < today ? "text-danger" : "text-fg-2"}`}>{relativeDayLabel(vm.date, today)}</span>
        </div>
      )}
    </div>
  );
}
