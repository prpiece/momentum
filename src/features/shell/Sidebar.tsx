import { useDroppable } from "@dnd-kit/core";
import {
  ChevronRight,
  FolderPlus,
  Hash,
  type LucideIcon,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  Search,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import { Logo } from "../../components/Logo";
import { MenuItem, Popover, useMenu } from "../../components/ui/Popover";
import { addDaysLocal, moveToDate, todayLocal } from "../../domain/dates";
import { scheduleForKey } from "../../domain/recurrence";
import type { Folder, TaskList, ViewId } from "../../domain/types";
import { onDrop, type DropData } from "../../lib/dnd";
import { withUndo } from "../../lib/undo";
import { addFolder, moveTasks, removeFolder, removeTag, updateFolder, updateTag, updateTask, useData } from "../../stores/data";
import { useSettings } from "../../stores/settings";
import { confirm, go, setPalette, useUi } from "../../stores/ui";
import { FocusBadge } from "../focus/FocusView";
import { editTask } from "../tasks/actions";
import { ListDialog, ListDialogButton } from "../tasks/ListDialog";
import { useCounts } from "../tasks/selectors";
import { MODULE_NAV, SETTINGS_NAV, SMART_LIST_NAV } from "./nav";

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

onDrop("smart", (drag, drop) => {
  if (drag.type !== "task") return;
  const ids = dragged(drag.id);
  if (drop.id === "inbox") return withUndo("Moved to Inbox", () => moveTasks(ids, "inbox"));
  const date = drop.id === "today" ? todayLocal() : addDaysLocal(todayLocal(), 1);
  if (ids.length === 1 && useData.getState().tasks[ids[0]]?.recurrence) {
    const t = useData.getState().tasks[ids[0]];
    return void editTask(t.id, { schedule: moveToDate(drag.key ? scheduleForKey(t.schedule, drag.key) : t.schedule, date) }, drag.key);
  }
  withUndo(`Scheduled for ${drop.id}`, () =>
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
  menu?: (anchor: React.RefObject<HTMLButtonElement | null>, close: () => void) => ReactNode;
}) {
  const active = useUi((s) => s.view === props.id);
  const { setNodeRef, isOver } = useDroppable({ id: `nav:${props.id}`, data: props.drop, disabled: !props.drop });
  const [tip, setTip] = useState<DOMRect | null>(null);
  const menu = useMenu();
  const show = (e: { currentTarget: HTMLElement }) => props.collapsed && setTip(e.currentTarget.getBoundingClientRect());
  return (
    <li ref={setNodeRef} className="group/nav relative">
      <button
        type="button"
        onClick={() => go(props.id)}
        onContextMenu={(e) => {
          if (!props.menu) return;
          e.preventDefault();
          menu.setOpen(true);
        }}
        onMouseEnter={show}
        onMouseLeave={() => setTip(null)}
        onFocus={show}
        onBlur={() => setTip(null)}
        aria-current={active ? "page" : undefined}
        aria-label={props.collapsed ? props.label : undefined}
        className={`flex h-[var(--row-h)] w-full items-center gap-3 rounded-sm px-3 text-sm transition-colors duration-[var(--dur)] ${props.indent ? "pl-7" : ""} ${
          isOver ? "bg-accent text-accent-fg ring-2 ring-accent" : active ? "bg-accent-soft font-semibold text-fg" : "text-fg-2 hover:bg-hover hover:text-fg"
        }`}
      >
        <span className={`grid w-[18px] shrink-0 place-items-center ${active && !isOver ? "text-accent" : ""}`}>{props.icon}</span>
        <span className={`min-w-0 flex-1 truncate text-left transition-opacity duration-[var(--dur)] ${props.collapsed ? "opacity-0" : ""}`}>{props.label}</span>
        {!props.collapsed && props.badge}
        {!props.collapsed && props.count ? <span className={`font-mono text-xs text-muted ${props.menu ? "group-hover/nav:opacity-0" : ""}`}>{props.count}</span> : null}
      </button>
      {props.menu && !props.collapsed && (
        <button
          ref={menu.anchor}
          type="button"
          aria-label={`${props.label} options`}
          onClick={menu.toggle}
          className="absolute right-1.5 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded-sm text-muted opacity-0 hover:bg-hover hover:text-fg focus:opacity-100 group-hover/nav:opacity-100"
        >
          <MoreHorizontal size={15} />
        </button>
      )}
      {menu.open && props.menu?.(menu.anchor, menu.close)}
      {tip && (
        <span
          role="tooltip"
          className="pointer-events-none fixed z-50 -translate-y-1/2 whitespace-nowrap rounded-sm bg-fg px-2 py-1 text-xs font-medium text-bg shadow-lg"
          style={{ top: tip.top + tip.height / 2, ...(props.side === "left" ? { left: tip.right + 10 } : { right: window.innerWidth - tip.left + 10 }) }}
        >
          {props.label}
        </span>
      )}
    </li>
  );
}

const icon = (I: LucideIcon) => <I size={18} strokeWidth={1.9} />;
const listIcon = (l: TaskList) => (l.emoji ? <span className="text-[0.95rem] leading-none">{l.emoji}</span> : <span className="size-2.5 rounded-full" style={{ background: l.color ?? "var(--fg-muted)" }} />);

function SectionHeader({ label, open, onToggle, actions }: { label: string; open: boolean; onToggle: () => void; actions?: ReactNode }) {
  return (
    <div className="group/sec mt-4 flex h-7 items-center px-2">
      <button type="button" onClick={onToggle} aria-expanded={open} className="flex flex-1 items-center gap-1 text-[0.7rem] font-semibold uppercase tracking-wider text-muted hover:text-fg">
        <ChevronRight size={12} className={`transition-transform duration-[var(--dur)] ${open ? "rotate-90" : ""}`} />
        {label}
      </button>
      <div className="flex opacity-0 transition-opacity focus-within:opacity-100 group-hover/sec:opacity-100">{actions}</div>
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
      className="mx-2 my-0.5 h-8 w-[calc(100%-1rem)] rounded-sm border border-accent bg-surface px-2 text-sm outline-none"
    />
  );
}

export function Sidebar() {
  const { sidebarCollapsed: collapsed, sidebarSide: side, hiddenSmartLists } = useSettings((s) => s.settings);
  const update = useSettings((s) => s.update);
  const lists = useData((s) => s.lists);
  const folders = useData((s) => s.folders);
  const tags = useData((s) => s.tags);
  const counts = useCounts();
  const [openSec, setOpenSec] = useState({ lists: true, tags: true, archived: false });
  const [renamingFolder, setRenamingFolder] = useState<string | null>(null);
  const [newFolder, setNewFolder] = useState(false);
  const [editList, setEditList] = useState<TaskList | null>(null);
  const [renamingTag, setRenamingTag] = useState<string | null>(null);

  const smart = SMART_LIST_NAV.filter((n) => !hiddenSmartLists.includes(n.id));
  const Toggle = side === "left" ? (collapsed ? PanelLeftOpen : PanelLeftClose) : collapsed ? PanelRightOpen : PanelRightClose;
  const userLists = Object.values(lists)
    .filter((l) => l.id !== "inbox")
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || a.sortOrder - b.sortOrder);
  const activeLists = userLists.filter((l) => !l.archived);
  const archived = userLists.filter((l) => l.archived);
  const folderList = Object.values(folders).sort((a, b) => a.sortOrder - b.sortOrder);
  const smartDrop: Partial<Record<string, DropData>> = {
    inbox: { type: "smart", id: "inbox" },
    today: { type: "smart", id: "today" },
    tomorrow: { type: "smart", id: "tomorrow" },
  };

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
      menu={(anchor, close) => (
        <Popover anchor={anchor} onClose={close} align="end">
          <MenuItem onSelect={() => (close(), setEditList(l))}>Edit list…</MenuItem>
        </Popover>
      )}
    />
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
            count={inside.reduce((n, l) => n + (counts.lists[l.id] ?? 0), 0)}
            onRename={() => setRenamingFolder(f.id)}
          />
        )}
        {!f.collapsed && <ul className="space-y-0.5">{inside.map((l) => listItem(l, true))}</ul>}
      </li>
    );
  };

  return (
    <aside aria-label="Navigation" className={`flex shrink-0 flex-col py-3 transition-[width] duration-[var(--dur)] ease-[var(--ease)] ${collapsed ? "w-[4.25rem]" : "w-64"}`}>
      <div className={`flex h-10 items-center px-3 ${collapsed ? "justify-center" : "justify-between"}`}>
        {!collapsed && (
          <div className="flex items-center gap-2.5 px-1">
            <Logo size={26} />
            <span className="text-[1.05rem] font-bold tracking-tight">Momentum</span>
          </div>
        )}
        <button
          type="button"
          onClick={() => update({ sidebarCollapsed: !collapsed })}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-expanded={!collapsed}
          className="grid size-8 place-items-center rounded-sm text-muted transition-colors hover:bg-hover hover:text-fg"
        >
          <Toggle size={18} />
        </button>
      </div>

      {!collapsed && (
        <button type="button" onClick={() => setPalette(true)} className="mx-3 mt-2 flex h-9 items-center gap-2 rounded-sm border border-border bg-surface px-3 text-sm text-muted transition-colors hover:border-accent hover:text-fg">
          <Search size={15} />
          <span className="flex-1 text-left">Search</span>
          <kbd className="rounded border border-border px-1.5 font-mono text-[0.65rem]">Ctrl K</kbd>
        </button>
      )}

      <nav className="scroll-thin mt-3 min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-2">
        <ul className="space-y-0.5">
          {smart.map((n) => (
            <NavItem key={n.id} id={n.id} label={n.label} icon={icon(n.icon)} collapsed={collapsed} side={side} count={counts.smart[n.id] || undefined} drop={smartDrop[n.id]} />
          ))}
        </ul>
        <div className="mx-3 my-3 h-px bg-border" />
        <ul className="space-y-0.5">
          {MODULE_NAV.map((n) => (
            <NavItem key={n.id} id={n.id} label={n.label} icon={icon(n.icon)} collapsed={collapsed} side={side} badge={n.id === "focus" ? <FocusBadge /> : undefined} />
          ))}
        </ul>

        {!collapsed && (
          <>
            <SectionHeader
              label="Lists"
              open={openSec.lists}
              onToggle={() => setOpenSec({ ...openSec, lists: !openSec.lists })}
              actions={
                <>
                  <button type="button" aria-label="New folder" title="New folder" onClick={() => setNewFolder(true)} className="grid size-6 place-items-center rounded-sm text-muted hover:bg-hover hover:text-fg">
                    <FolderPlus size={14} />
                  </button>
                  <ListDialogButton>
                    <Plus size={15} />
                  </ListDialogButton>
                </>
              }
            />
            {openSec.lists && (
              <ul className="space-y-0.5">
                {newFolder && <InlineName initial="" onDone={(v) => (v && addFolder(v), setNewFolder(false))} />}
                {folderList.map(folderBlock)}
                {activeLists.filter((l) => !l.folderId || !folders[l.folderId]).map((l) => listItem(l))}
                {!activeLists.length && !folderList.length && <li className="px-3 py-1 text-xs text-muted">No lists yet. Use + to create one.</li>}
                {archived.length > 0 && (
                  <li>
                    <button type="button" onClick={() => setOpenSec({ ...openSec, archived: !openSec.archived })} className="flex h-8 w-full items-center gap-2 px-3 text-xs text-muted hover:text-fg">
                      <ChevronRight size={12} className={openSec.archived ? "rotate-90" : ""} /> Archived · {archived.length}
                    </button>
                    {openSec.archived && <ul className="space-y-0.5 opacity-70">{archived.map((l) => listItem(l, true))}</ul>}
                  </li>
                )}
              </ul>
            )}

            {Object.keys(tags).length > 0 && (
              <>
                <SectionHeader label="Tags" open={openSec.tags} onToggle={() => setOpenSec({ ...openSec, tags: !openSec.tags })} />
                {openSec.tags && (
                  <ul className="space-y-0.5">
                    {Object.values(tags)
                      .sort((a, b) => a.name.localeCompare(b.name))
                      .map((t) =>
                        renamingTag === t.id ? (
                          <InlineName key={t.id} initial={t.name} onDone={(v) => (v && updateTag(t.id, { name: v }), setRenamingTag(null))} />
                        ) : (
                          <NavItem
                            key={t.id}
                            id={`tag:${t.id}`}
                            label={t.name}
                            icon={<Hash size={15} className="text-muted" />}
                            collapsed={false}
                            side={side}
                            count={counts.tags[t.id]}
                            menu={(anchor, close) => (
                              <Popover anchor={anchor} onClose={close} align="end">
                                <MenuItem onSelect={() => (close(), setRenamingTag(t.id))}>Rename</MenuItem>
                                <MenuItem
                                  danger
                                  onSelect={async () => {
                                    close();
                                    if (await confirm(`Delete tag “${t.name}”?`, "It is removed from every task.")) removeTag(t.id);
                                  }}
                                >
                                  Delete tag
                                </MenuItem>
                              </Popover>
                            )}
                          />
                        ),
                      )}
                  </ul>
                )}
              </>
            )}
          </>
        )}
      </nav>

      <ul className="px-2 pt-2">
        <NavItem id={SETTINGS_NAV.id} label={SETTINGS_NAV.label} icon={icon(SETTINGS_NAV.icon)} collapsed={collapsed} side={side} />
      </ul>
      {editList && <ListDialog list={editList} onClose={() => setEditList(null)} />}
    </aside>
  );
}

function FolderRow({ folder, count, onRename }: { folder: Folder; count: number; onRename: () => void }) {
  const menu = useMenu();
  const [newList, setNewList] = useState(false);
  return (
    <div className="group/nav relative">
      <button
        type="button"
        onClick={() => updateFolder(folder.id, { collapsed: !folder.collapsed })}
        aria-expanded={!folder.collapsed}
        className="flex h-[var(--row-h)] w-full items-center gap-2 rounded-sm px-3 text-sm font-medium text-fg-2 hover:bg-hover hover:text-fg"
      >
        <ChevronRight size={14} className={`text-muted transition-transform duration-[var(--dur)] ${folder.collapsed ? "" : "rotate-90"}`} />
        <span className="flex-1 truncate text-left">{folder.name}</span>
        {count > 0 && <span className="font-mono text-xs text-muted group-hover/nav:opacity-0">{count}</span>}
      </button>
      <button ref={menu.anchor} type="button" aria-label={`${folder.name} options`} onClick={menu.toggle} className="absolute right-1.5 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded-sm text-muted opacity-0 hover:bg-hover focus:opacity-100 group-hover/nav:opacity-100">
        <MoreHorizontal size={15} />
      </button>
      {menu.open && (
        <Popover anchor={menu.anchor} onClose={menu.close} align="end">
          <MenuItem onSelect={() => (menu.close(), setNewList(true))}>New list in folder…</MenuItem>
          <MenuItem onSelect={() => (menu.close(), onRename())}>Rename</MenuItem>
          <MenuItem
            danger
            onSelect={async () => {
              menu.close();
              if (await confirm(`Delete folder “${folder.name}”?`, "Its lists move out of the folder; no tasks are deleted.")) removeFolder(folder.id);
            }}
          >
            Delete folder
          </MenuItem>
        </Popover>
      )}
      {newList && <ListDialog folderId={folder.id} onClose={() => setNewList(false)} />}
    </div>
  );
}
