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
import { addSection, addTask, moveSection, removeSection, updateSection, updateTask, useData } from "../../stores/data";
import { confirm, openContextMenu, openTask, useUi } from "../../stores/ui";
import { toggleDone } from "./actions";
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
    <div className="flex min-h-0 flex-1 gap-4 overflow-x-auto px-4 pb-6">
      <SortableContext items={sections.map((s) => `col:${s.id}`)} strategy={horizontalListSortingStrategy}>
        {columns.map((c) => (
          <Column key={c.section?.id ?? "none"} list={list} section={c.section} items={c.items} index={c.section ? sections.indexOf(c.section) : -1} count={sections.length} />
        ))}
      </SortableContext>
      <div className="w-72 shrink-0">
        {adding ? (
          <input
            autoFocus
            placeholder="Section name"
            className="h-10 w-full rounded-md border border-border bg-surface-2 px-3 text-sm outline-none focus:border-accent"
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
          <button type="button" onClick={() => setAdding(true)} className="flex h-10 w-full items-center gap-2 rounded-md border border-dashed border-border px-3 text-sm text-muted hover:border-accent hover:text-fg">
            <Plus size={16} /> Add section
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
  const [draft, setDraft] = useState("");
  const menu = useMenu();
  const [renaming, setRenaming] = useState(false);

  return (
    <section
      ref={setNodeRef}
      style={{ transform: sort.transform ? `translate3d(${sort.transform.x}px, 0, 0)` : undefined, transition: sort.transition }}
      aria-label={section?.name ?? "Unsectioned"}
      className={`flex w-72 shrink-0 flex-col rounded-lg border p-2 transition-colors duration-[var(--dur)] ${
        sort.isDragging ? "z-10 opacity-80 shadow-lg " : ""
      }${
        isOver ? "border-accent bg-accent-soft" : "border-transparent bg-bg"
      }`}
    >
      <header
        ref={section ? sort.setActivatorNodeRef : undefined}
        {...(section && !renaming ? { ...sort.attributes, ...sort.listeners } : {})}
        className={`flex h-9 items-center gap-2 px-2 ${section ? "cursor-grab" : ""}`}
      >
        {renaming && section ? (
          <input
            autoFocus
            defaultValue={section.name}
            className="h-7 min-w-0 flex-1 rounded-sm border border-accent bg-surface px-2 text-sm outline-none"
            onBlur={(e) => {
              if (e.target.value.trim()) updateSection(section.id, { name: e.target.value.trim() });
              setRenaming(false);
            }}
            onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          />
        ) : (
          <h3 className="flex-1 truncate text-sm font-semibold">{section?.name ?? "Unsectioned"}</h3>
        )}
        <span className="font-mono text-xs text-muted">{items.length}</span>
        {section && (
          <button ref={menu.anchor} type="button" aria-label="Section options" onClick={menu.toggle} className="grid size-7 place-items-center rounded-sm text-muted hover:bg-hover">
            <MoreHorizontal size={16} />
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
      <div className="flex min-h-16 flex-1 flex-col gap-2 overflow-y-auto p-1">
        {items.map((vm) => (
          <Card key={vm.task.id} vm={vm} />
        ))}
      </div>
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && draft.trim()) {
            addTask({ title: draft.trim(), listId: list.id, sectionId: section?.id ?? null }, "bottom");
            setDraft("");
          }
        }}
        placeholder="+ Add task"
        aria-label={`Add task to ${section?.name ?? "Unsectioned"}`}
        className="mt-1 h-9 rounded-sm bg-transparent px-2 text-sm outline-none placeholder:text-muted focus:bg-surface"
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
      className={`flex cursor-grab items-start gap-2.5 rounded-md border border-border bg-surface-2 p-3 shadow-sm transition-shadow hover:shadow-lg ${isDragging ? "opacity-40" : ""}`}
    >
      <TaskCheckbox status={t.status} priority={t.priority} onToggle={() => toggleDone(t.id, vm.key)} label={`Complete ${t.title}`} />
      <div className="min-w-0 flex-1">
        <div className="text-sm leading-5">{t.title}</div>
        {vm.date && <div className={`mt-1 text-xs ${vm.date < today ? "text-danger" : "text-muted"}`}>{relativeDayLabel(vm.date, today)}</div>}
      </div>
    </div>
  );
}
