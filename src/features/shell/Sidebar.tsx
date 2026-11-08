import { keyLabel } from "../../lib/platform";
import { useDndContext, useDraggable, useDroppable } from "@dnd-kit/core";
import {
  ChevronRight,
  FolderPlus,
  ListPlus,
  ListFilter,
  type LucideIcon,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Pencil,
  Pin,
  PinOff,
  Plus,
  Search,
  Archive,
  ArchiveRestore,
  Trash2,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import { Logo } from "../../components/Logo";
import { Collapse } from "../../components/ui/Collapse";
import { ListGlyph } from "../../components/ui/AppIcon";
import { addDaysLocal, moveToDate, todayLocal } from "../../domain/dates";
import { scheduleForKey } from "../../domain/recurrence";
import type { Folder, SavedFilter, TaskList, ViewId } from "../../domain/types";
import { canAddChild, canNest, childFolders } from "../../domain/folders";
import { justDragged, onDrop, type DragData, type DropData } from "../../lib/dnd";
import { withUndo } from "../../lib/undo";
import { addFolder, moveFolder, moveTasks, removeFolder, removeList, updateFolder, updateList, updateTask, useData } from "../../stores/data";
import { useSettings } from "../../stores/settings";
import { confirm, go, openContextMenu, openMenuAt, setPalette, useUi, type MenuEntry } from "../../stores/ui";
import { FocusBadge } from "../focus/FocusView";
import { editTask } from "../tasks/actions";
import { ListDialog, ListDialogButton } from "../tasks/ListDialog";
import { useCounts } from "../tasks/selectors";
import { MODULE_NAV, SETTINGS_NAV, SIDEBAR_SMART_NAV } from "./nav";

type Side = "left" | "right";

const dragged = (id: string) => {
  const sel = useUi.getState().selection;
  return sel.includes(id) ? sel : [id];
};

onDrop("list", (drag, drop) => {
  if (drag.type !== "task") return;
  const ids = dragged(drag.id);
  const name = useData.getState().lists[drop.listId]?.name ?? "list";
  withUndo(`Moved ${ids.length > 1 ? `${ids.length} tasks` : "task"} to ${name}`, () => moveTasks(ids, drop.listId));
});

onDrop("folder", (drag, drop) => {
  if (drag.type === "folder") moveFolder(drag.id, drop.id);
});

onDrop("smart", (drag, drop) => {
  if (drag.type !== "task") return;
  const ids = dragged(drag.id);
  if (drop.id === "inbox") return withUndo("Moved to Inbox", () => moveTasks(ids, "inbox"));
  // Upcoming means tomorrow.
  const date = drop.id === "today" ? todayLocal() : addDaysLocal(todayLocal(), 1);
  if (ids.length === 1 && useData.getState().tasks[ids[0]]?.recurrence) {
    const t = useData.getState().tasks[ids[0]];
    return void editTask(t.id, { schedule: moveToDate(drag.key ? scheduleForKey(t.schedule, drag.key) : t.schedule, date) }, drag.key);
  }
  withUndo(`Scheduled for ${drop.id === "today" ? "today" : "tomorrow"}`, () =>
    ids.forEach((id) => {
      const t = useData.getState().tasks[id];
      if (t && !t.recurrence) updateTask(id, { schedule: moveToDate(t.schedule, date) });
    }),
  );
});

function NavItem(props: {
  id: ViewId;
  label: string;
  icon: ReactNode;
  collapsed: boolean;
  side: Side;
  count?: number;
  /** Live content in the count slot (e.g. the running focus timer). */
  badge?: ReactNode;
  drop?: DropData;
  indent?: boolean;
  menu?: () => MenuEntry[];
}) {
  const active = useUi((s) => s.view === props.id);
  const { setNodeRef, isOver } = useDroppable({ id: `nav:${props.id}`, data: props.drop, disabled: !props.drop });
  const [tip, setTip] = useState<DOMRect | null>(null);
  const show = (e: { currentTarget: HTMLElement }) => props.collapsed && setTip(e.currentTarget.getBoundingClientRect());
  return (
    <li ref={setNodeRef} className="group/nav relative">
      <button
        type="button"
        onClick={() => go(props.id)}
        onContextMenu={(e) => props.menu && openContextMenu(e, props.menu())}
        onMouseEnter={show}
        onMouseLeave={() => setTip(null)}
        onFocus={show}
        onBlur={() => setTip(null)}
        aria-current={active ? "page" : undefined}
        aria-label={props.collapsed ? props.label : undefined}
        className={`nav-item w-full ${props.indent ? "pl-6" : ""} ${isOver ? "is-drop" : ""}`}
      >
        <span className="ni-icon">{props.icon}</span>
        <span className={`ni-label transition-opacity duration-[var(--dur)] ${props.collapsed ? "opacity-0" : ""}`}>{props.label}</span>
        {!props.collapsed && props.badge}
        {!props.collapsed && props.count ? (
          <span key={props.count} className={`ni-n anim-pop ${props.menu ? "group-hover/nav:opacity-0" : ""}`}>
            {props.count}
          </span>
        ) : null}
      </button>
      {props.menu && !props.collapsed && (
        <button
          type="button"
          aria-label={`${props.label} options`}
          onClick={(e) => props.menu && openMenuAt(e.currentTarget, props.menu())}
          className={`${iconBtn} absolute right-1 top-1/2 -translate-y-1/2 opacity-0 focus:opacity-100 group-hover/nav:opacity-100`}
        >
          <MoreHorizontal size={15} />
        </button>
      )}
      {tip && (
        <span
          role="tooltip"
          className="layer pointer-events-none fixed z-50 -translate-y-1/2 whitespace-nowrap rounded-control px-2 py-1 text-xs font-medium"
          style={{ top: tip.top + tip.height / 2, ...(props.side === "left" ? { left: tip.right + 10 } : { right: window.innerWidth - tip.left + 10 }) }}
        >
          {props.label}
        </span>
      )}
    </li>
  );
}

const icon = (I: LucideIcon) => <I size={16} strokeWidth={1.75} />;
const listIcon = (l: TaskList) => <ListGlyph icon={l.icon} color={l.color} size={16} />;

function SectionHeader({ label, open, onToggle, actions, tour }: { label: string; open: boolean; onToggle: () => void; actions?: ReactNode; tour?: string }) {
  return (
    <div data-tour={tour} className="group/sec mt-3 flex h-7 items-center pl-2 pr-1">
      <button type="button" onClick={onToggle} aria-expanded={open} className="t-label flex flex-1 items-center gap-1 text-muted hover:text-fg">
        <ChevronRight size={12} className={`transition-transform duration-[var(--dur)] ${open ? "rotate-90" : ""}`} />
        {label}
      </button>
      <div className="flex items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover/sec:opacity-100">{actions}</div>
    </div>
  );
}

function InlineName({ initial, onDone }: { initial: string; onDone: (v: string | null) => void }) {
  return (
    <input
      autoFocus
      defaultValue={initial}
      onBlur={(e) => onDone(e.target.value.trim() || null)}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") onDone(null);
      }}
      className="input my-0.5"
    />
  );
}

export function Sidebar() {
  const { sidebarCollapsed: collapsed, sidebarSide: side } = useSettings((s) => s.settings);
  const savedFilters = useSettings((s) => s.settings.savedFilters);
  const update = useSettings((s) => s.update);
  const lists = useData((s) => s.lists);
  const folders = useData((s) => s.folders);
  const counts = useCounts();
  const [openSec, setOpenSec] = useState({ lists: true, filters: true, archived: false });
  const [renamingFolder, setRenamingFolder] = useState<string | null>(null);
  /** Where the inline new-folder input shows: "" is the top level, an id is under that folder. */
  const [newFolder, setNewFolder] = useState<string | null>(null);
  const [editList, setEditList] = useState<TaskList | null>(null);
  const [editingFilter, setEditingFilter] = useState<{ id: string; field: "name" | "query" } | null>(null);

  const Toggle = side === "left" ? (collapsed ? PanelLeftOpen : PanelLeftClose) : collapsed ? PanelRightOpen : PanelRightClose;
  const userLists = Object.values(lists)
    .filter((l) => l.id !== "inbox")
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || a.sortOrder - b.sortOrder);
  const activeLists = userLists.filter((l) => !l.archived);
  const archived = userLists.filter((l) => l.archived);
  const folderKids = (parentId: string | null) => childFolders(folders, parentId).sort((a, b) => a.sortOrder - b.sortOrder);
  const topFolders = folderKids(null);
  const smartDrop: Partial<Record<string, DropData>> = {
    inbox: { type: "smart", id: "inbox" },
    today: { type: "smart", id: "today" },
    upcoming: { type: "smart", id: "upcoming" },
  };

  const patchFilter = (id: string, patch: Partial<SavedFilter>) => update({ savedFilters: savedFilters.map((f) => (f.id === id ? { ...f, ...patch } : f)) });
  const filterItem = (f: SavedFilter) =>
    editingFilter?.id === f.id ? (
      <InlineName key={f.id} initial={f[editingFilter.field]} onDone={(v) => (v && patchFilter(f.id, { [editingFilter.field]: v }), setEditingFilter(null))} />
    ) : (
      <NavItem
        key={f.id}
        id={`filter:${f.id}`}
        label={f.name}
        icon={<ListFilter size={15} className="text-muted" />}
        collapsed={false}
        side={side}
        menu={() => [
          { label: "Rename", icon: <Pencil size={14} />, run: () => setEditingFilter({ id: f.id, field: "name" }) },
          { label: "Edit filter…", icon: <ListFilter size={14} />, run: () => setEditingFilter({ id: f.id, field: "query" }) },
          "sep",
          {
            label: "Remove filter",
            icon: <Trash2 size={14} />,
            danger: true,
            run: () => {
              if (useUi.getState().view === `filter:${f.id}`) go("today");
              update({ savedFilters: savedFilters.filter((x) => x.id !== f.id) });
            },
          },
        ]}
      />
    );

  const listItem = (l: TaskList, indent = false) => (
    <NavItem
      key={l.id}
      id={`list:${l.id}`}
      label={l.name}
      icon={listIcon(l)}
      collapsed={collapsed}
      side={side}
      count={counts.lists[l.id]}
      drop={{ type: "list", listId: l.id }}
      indent={indent}
      menu={() => [
        { label: "Edit list…", icon: <Pencil size={14} />, run: () => setEditList(l) },
        { label: l.pinned ? "Unpin" : "Pin to top", icon: l.pinned ? <PinOff size={14} /> : <Pin size={14} />, run: () => updateList(l.id, { pinned: !l.pinned }) },
        { label: l.archived ? "Unarchive" : "Archive", icon: l.archived ? <ArchiveRestore size={14} /> : <Archive size={14} />, run: () => updateList(l.id, { archived: !l.archived }) },
        "sep",
        {
          label: "Delete list",
          icon: <Trash2 size={14} />,
          danger: true,
          run: async () => {
            if (await confirm(`Delete “${l.name}”?`, "The list and all of its tasks are deleted. This can't be undone.")) {
              if (useUi.getState().view === `list:${l.id}`) go("inbox");
              removeList(l.id);
            }
          },
        },
      ]}
    />
  );

  const folderCount = (f: Folder): number =>
    activeLists.filter((l) => l.folderId === f.id).reduce((n, l) => n + (counts.lists[l.id] ?? 0), 0) + folderKids(f.id).reduce((n, c) => n + folderCount(c), 0);
  const newFolderInput = (parentId: string | null) =>
    newFolder === (parentId ?? "") && (
      <InlineName initial="" onDone={(v) => (v && addFolder(v, parentId), setNewFolder(null))} />
    );

  const folderBlock = (f: Folder) => {
    const inside = activeLists.filter((l) => l.folderId === f.id);
    return (
      <li key={f.id}>
        {renamingFolder === f.id ? (
          <InlineName initial={f.name} onDone={(v) => (v && updateFolder(f.id, { name: v }), setRenamingFolder(null))} />
        ) : (
          <FolderRow
            folder={f}
            count={folderCount(f)}
            onRename={() => setRenamingFolder(f.id)}
            onAddSub={() => (updateFolder(f.id, { collapsed: false }), setNewFolder(f.id))}
          />
        )}
        <Collapse open={!f.collapsed}>
          <ul className="ml-3 space-y-px">
            {newFolderInput(f.id)}
            {folderKids(f.id).map(folderBlock)}
            {inside.map((l) => listItem(l, true))}
          </ul>
        </Collapse>
      </li>
    );
  };

  return (
    <aside aria-label="Navigation" className={`flex shrink-0 flex-col gap-3 px-2 py-3 transition-[width] duration-[var(--dur)] ease-[var(--ease-out)] ${collapsed ? "w-14" : "w-[var(--sidebar)]"}`}>
      <div data-tauri-drag-region className={`flex h-8 select-none items-center ${collapsed ? "justify-center" : "justify-between pl-2"}`}>
        {!collapsed && (
          <div className="pointer-events-none flex items-center gap-2">
            <Logo size={22} />
            <span className="font-semibold">Momentum</span>
          </div>
        )}
        <button
          type="button"
          onClick={() => update({ sidebarCollapsed: !collapsed })}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-expanded={!collapsed}
          className="btn btn-ghost btn-sm icon-btn text-muted"
        >
          <Toggle size={16} strokeWidth={1.75} />
        </button>
      </div>

      {!collapsed && (
        <button type="button" data-tour="search" onClick={() => setPalette(true)} className="btn btn-secondary w-full justify-start text-muted">
          <Search size={16} strokeWidth={1.75} />
          <span className="flex-1 text-left">Search</span>
          <kbd className="kbd">{keyLabel("Ctrl K")}</kbd>
        </button>
      )}

      <nav className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
        <ul data-tour="nav" className="space-y-px">
          {SIDEBAR_SMART_NAV.map((n) => (
            <NavItem key={n.id} id={n.id} label={n.label} icon={icon(n.icon)} collapsed={collapsed} side={side} count={counts.smart[n.id] || undefined} drop={smartDrop[n.id]} />
          ))}
        </ul>
        <ul className="mt-px space-y-px">
          {MODULE_NAV.map((n) => (
            <NavItem key={n.id} id={n.id} label={n.label} icon={icon(n.icon)} collapsed={collapsed} side={side} badge={n.id === "focus" ? <FocusBadge /> : undefined} />
          ))}
        </ul>

        {!collapsed && (
          <>
            {savedFilters.length > 0 && (
              <>
                <SectionHeader label="Filters" open={openSec.filters} onToggle={() => setOpenSec({ ...openSec, filters: !openSec.filters })} />
                <Collapse open={openSec.filters}>
                  <ul className="space-y-px">{savedFilters.map(filterItem)}</ul>
                </Collapse>
              </>
            )}

            <SectionHeader
              tour="lists"
              label="Lists"
              open={openSec.lists}
              onToggle={() => setOpenSec({ ...openSec, lists: !openSec.lists })}
              actions={
                <>
                  <button type="button" aria-label="New folder" title="New folder" onClick={() => setNewFolder("")} className={iconBtn}>
                    <FolderPlus size={14} />
                  </button>
                  <ListDialogButton className="size-6">
                    <Plus size={15} />
                  </ListDialogButton>
                </>
              }
            />
            <Collapse open={openSec.lists}>
              <ul className="space-y-px">
                {newFolderInput(null)}
                {topFolders.map(folderBlock)}
                <TopLevelDrop />
                {activeLists.filter((l) => !l.folderId || !folders[l.folderId]).map((l) => listItem(l))}
                {!activeLists.length && !topFolders.length && <li className="px-3 py-1 text-xs text-muted">No lists yet. Use + to create one.</li>}
                {archived.length > 0 && (
                  <li>
                    <button type="button" onClick={() => setOpenSec({ ...openSec, archived: !openSec.archived })} className="flex h-8 w-full items-center gap-2 px-2 text-xs text-muted hover:text-fg">
                      <ChevronRight size={12} className={`transition-transform duration-[var(--dur)] ${openSec.archived ? "rotate-90" : ""}`} /> Archived · {archived.length}
                    </button>
                    <Collapse open={openSec.archived}>
                      <ul className="space-y-px opacity-70">{archived.map((l) => listItem(l, true))}</ul>
                    </Collapse>
                  </li>
                )}
              </ul>
            </Collapse>

          </>
        )}
      </nav>

      <ul data-tour="settings">
        <NavItem id={SETTINGS_NAV.id} label={SETTINGS_NAV.label} icon={icon(SETTINGS_NAV.icon)} collapsed={collapsed} side={side} />
      </ul>
      {editList && <ListDialog list={editList} onClose={() => setEditList(null)} />}
    </aside>
  );
}

/** Only while a folder is dragged: dropping here moves it to the top level. */
function TopLevelDrop() {
  const dragging = useDndContext().active?.data.current?.type === "folder";
  const { setNodeRef, isOver } = useDroppable({ id: "folder-drop:top", data: { type: "folder", id: null } satisfies DropData, disabled: !dragging });
  if (!dragging) return null;
  return (
    <li ref={setNodeRef} className={`mx-1 rounded-control border border-dashed px-3 py-1.5 text-xs ${isOver ? "border-accent bg-accent-soft text-fg" : "border-border text-muted"}`}>
      Move to top level
    </li>
  );
}

const iconBtn = "btn btn-ghost icon-btn size-6 text-muted";

function FolderRow({ folder, count, onRename, onAddSub }: { folder: Folder; count: number; onRename: () => void; onAddSub: () => void }) {
  const [newList, setNewList] = useState(false);
  const folders = useData((s) => s.folders);
  const canSub = canAddChild(folders, folder.id);
  const drag = useDraggable({ id: `folder:${folder.id}`, data: { type: "folder", id: folder.id } satisfies DragData });
  const drop = useDroppable({ id: `folder-drop:${folder.id}`, data: { type: "folder", id: folder.id } satisfies DropData });
  const dragId = useDndContext().active?.data.current;
  const target = drop.isOver && typeof dragId === "object" && dragId?.type === "folder" && canNest(folders, dragId.id, folder.id) && dragId.id !== folder.id;
  const items = (): MenuEntry[] => [
    { label: "New list in folder…", icon: <Plus size={14} />, run: () => setNewList(true) },
    ...(canSub ? [{ label: "New subfolder…", icon: <FolderPlus size={14} />, run: onAddSub }] : []),
    { label: "Rename", icon: <Pencil size={14} />, run: onRename },
    ...(folder.parentId ? [{ label: "Move to top level", icon: <ChevronRight size={14} />, run: () => void moveFolder(folder.id, null) }] : []),
    // Keyboard path for nesting (D71): the same targets a drag accepts.
    ...Object.values(folders)
      .filter((f) => f.id !== folder.parentId && canNest(folders, folder.id, f.id))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((f) => ({ label: `Move into ${f.name}`, icon: <ChevronRight size={14} />, run: () => void moveFolder(folder.id, f.id) })),
    "sep",
    {
      label: "Delete folder",
      icon: <Trash2 size={14} />,
      danger: true,
      run: async () => {
        if (await confirm(`Delete folder “${folder.name}”?`, "Its lists and subfolders move up one level; no tasks are deleted.")) removeFolder(folder.id);
      },
    },
  ];
  const t = drag.transform;
  return (
    <div
      ref={(n) => (drag.setNodeRef(n), drop.setNodeRef(n))}
      style={t ? { transform: `translate3d(${t.x}px, ${t.y}px, 0)`, position: "relative", zIndex: 20 } : undefined}
      className={`group/nav relative rounded-control ${target ? "ring-2 ring-accent" : ""} ${drag.isDragging ? "opacity-70" : ""}`}
    >
      <button
        type="button"
        {...drag.listeners}
        onKeyDown={undefined} /* pointer drag only: Enter/Space must keep toggling the folder */
        onClick={() => !justDragged() && updateFolder(folder.id, { collapsed: !folder.collapsed })}
        onContextMenu={(e) => openContextMenu(e, items())}
        aria-expanded={!folder.collapsed}
        className="nav-item w-full font-medium text-fg-2"
      >
        <span className="ni-icon">
          <ChevronRight size={14} className={`text-muted transition-transform duration-[var(--dur)] ${folder.collapsed ? "" : "rotate-90"}`} />
        </span>
        <span className="ni-label">{folder.name}</span>
        {count > 0 && <span className="ni-n group-focus-within/nav:opacity-0 group-hover/nav:opacity-0">{count}</span>}
      </button>
      <div className="absolute right-1 top-1/2 flex -translate-y-1/2 items-center opacity-0 focus-within:opacity-100 group-hover/nav:opacity-100">
        <button type="button" aria-label={`New list in ${folder.name}`} title="New list" onClick={() => setNewList(true)} className={iconBtn}>
          <ListPlus size={14} />
        </button>
        {canSub && (
          <button type="button" aria-label={`New subfolder in ${folder.name}`} title="New subfolder" onClick={onAddSub} className={iconBtn}>
            <FolderPlus size={14} />
          </button>
        )}
        <button type="button" aria-label={`${folder.name} options`} onClick={(e) => openMenuAt(e.currentTarget, items())} className={iconBtn}>
          <MoreHorizontal size={15} />
        </button>
      </div>
      {newList && <ListDialog folderId={folder.id} onClose={() => setNewList(false)} />}
    </div>
  );
}
