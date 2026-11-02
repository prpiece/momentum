import { useDroppable } from "@dnd-kit/core";
import { ChevronDown, ListFilter, MoreHorizontal, Plus, Search } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Logo } from "../../components/Logo";
import { ListGlyph } from "../../components/ui/AppIcon";
import type { ViewId } from "../../domain/types";
import type { DropData } from "../../lib/dnd";
import { useData } from "../../stores/data";
import { useSettings } from "../../stores/settings";
import { go, openMenuAt, setPalette, useUi, type MenuEntry } from "../../stores/ui";
import { FocusBadge } from "../focus/FocusView";
import { ListDialog } from "../tasks/ListDialog";
import { useCounts } from "../tasks/selectors";
import { WindowControls } from "./WindowControls";
import { MODULE_NAV, MORE_NAV, PRIMARY_MODULE_NAV, SETTINGS_NAV, SIDEBAR_SMART_NAV } from "./nav";

type Variant = "top" | "dock";

function BarItem(props: { id: ViewId; label: string; icon: ReactNode; variant: Variant; count?: number; badge?: ReactNode; drop?: DropData }) {
  const active = useUi((s) => s.view === props.id);
  const { setNodeRef, isOver } = useDroppable({ id: `bar:${props.id}`, data: props.drop, disabled: !props.drop });
  const dock = props.variant === "dock";
  return (
    <button
      ref={setNodeRef}
      type="button"
      onClick={() => go(props.id)}
      aria-current={active ? "page" : undefined}
      aria-label={dock ? props.label : undefined}
      title={dock ? props.label : undefined}
      className={`relative flex shrink-0 items-center gap-2 rounded-sm text-sm transition-colors duration-[var(--dur)] ${dock ? "size-10 justify-center" : "h-8 px-3"} ${
        isOver ? "bg-accent text-accent-fg" : active ? "bg-accent-soft font-semibold text-fg" : "text-fg-2 hover:bg-hover hover:text-fg"
      }`}
    >
      <span className={active && !isOver ? "text-accent" : ""}>{props.icon}</span>
      {!dock && props.label}
      {!dock && props.badge}
      {props.count ? (
        <span className={dock ? "absolute right-0.5 top-0.5 min-w-4 rounded-full bg-accent px-1 font-mono text-[0.6rem] leading-4 text-accent-fg" : "font-mono text-xs text-muted"}>{props.count}</span>
      ) : null}
    </button>
  );
}

/**
 * Navigation for the "topbar" and "dock" layouts (D68): the sidebar's destinations in one row.
 * Lists and pinned filters sit behind a menu button.
 */
export function NavBar({ variant }: { variant: Variant }) {
  const counts = useCounts();
  const lists = useData((s) => s.lists);
  const savedFilters = useSettings((s) => s.settings.savedFilters);
  const view = useUi((s) => s.view);
  const [newList, setNewList] = useState(false);
  const dock = variant === "dock";
  const size = 18;

  const listsMenu = (): MenuEntry[] => {
    const user = Object.values(lists)
      .filter((l) => l.id !== "inbox" && !l.archived)
      .sort((a, b) => Number(b.pinned) - Number(a.pinned) || a.sortOrder - b.sortOrder);
    return [
      ...savedFilters.map((f): MenuEntry => ({ label: f.name, icon: <ListFilter size={14} />, run: () => go(`filter:${f.id}`) })),
      ...(savedFilters.length ? (["sep"] as const) : []),
      ...user.map((l): MenuEntry => ({ label: l.name, icon: <ListGlyph icon={l.icon} color={l.color} size={14} />, hint: counts.lists[l.id] ? String(counts.lists[l.id]) : undefined, run: () => go(`list:${l.id}`) })),
      ...(user.length ? (["sep"] as const) : []),
      { label: "New list…", icon: <Plus size={14} />, run: () => setNewList(true) },
    ];
  };
  const onList = view.startsWith("list:") || view.startsWith("filter:");
  const modules = dock ? MODULE_NAV : PRIMARY_MODULE_NAV;
  const btn = `flex shrink-0 items-center gap-1.5 rounded-sm text-sm transition-colors duration-[var(--dur)] hover:bg-hover hover:text-fg ${dock ? "size-10 justify-center" : "h-8 px-3"}`;
  const sep = <span className={dock ? "mx-1 h-6 w-px shrink-0 bg-border" : "mx-1 h-5 w-px shrink-0 bg-border"} aria-hidden />;

  const items = (
    <>
      {SIDEBAR_SMART_NAV.map((n) => (
        <BarItem key={n.id} id={n.id} label={n.label} icon={<n.icon size={size} />} variant={variant} count={counts.smart[n.id] || undefined} drop={n.id === "logbook" ? undefined : { type: "smart", id: n.id }} />
      ))}
      {sep}
      {modules.map((n) => (
        <BarItem key={n.id} id={n.id} label={n.label} icon={<n.icon size={size} />} variant={variant} badge={n.id === "focus" ? <FocusBadge /> : undefined} />
      ))}
      {!dock && (
        <>
          {/* The current module stays visible next to Calendar, like the sidebar's closed "More". */}
          {MORE_NAV.filter((n) => n.id === view).map((n) => (
            <BarItem key={n.id} id={n.id} label={n.label} icon={<n.icon size={size} />} variant={variant} />
          ))}
          <button type="button" aria-label="More" onClick={(e) => openMenuAt(e.currentTarget, MORE_NAV.map((n) => ({ label: n.label, icon: <n.icon size={14} />, run: () => go(n.id) })))} className={`${btn} text-fg-2`}>
            <MoreHorizontal size={size} /> More
          </button>
        </>
      )}
      <button type="button" aria-label="Lists" title="Lists" data-tour="lists" onClick={(e) => openMenuAt(e.currentTarget, listsMenu())} className={`${btn} ${onList ? "bg-accent-soft font-semibold text-fg" : "text-fg-2"}`}>
        <ListFilter size={size} className={onList ? "text-accent" : ""} />
        {!dock && (
          <>
            Lists <ChevronDown size={14} />
          </>
        )}
      </button>
    </>
  );

  return (
    <>
      {dock ? (
        <div className="flex shrink-0 justify-center pb-2">
          <nav aria-label="Navigation" data-tour="nav" className="scroll-thin flex max-w-[calc(100%-1rem)] items-center gap-0.5 overflow-x-auto rounded-lg border border-border bg-surface-2 p-1.5 shadow-lg">
            {items}
            {sep}
            <button type="button" aria-label="Search" title="Search (Ctrl K)" data-tour="search" onClick={() => setPalette(true)} className={`${btn} text-fg-2`}>
              <Search size={size} />
            </button>
            <span data-tour="settings" className="contents">
              <BarItem id={SETTINGS_NAV.id} label={SETTINGS_NAV.label} icon={<SETTINGS_NAV.icon size={size} />} variant={variant} />
            </span>
          </nav>
        </div>
      ) : (
        <div data-tauri-drag-region className="flex h-12 shrink-0 select-none items-center gap-3 px-3">
          <div className="pointer-events-none flex shrink-0 items-center gap-2 px-1">
            <Logo size={24} />
            <span className="font-bold tracking-tight">Momentum</span>
          </div>
          <nav aria-label="Navigation" data-tour="nav" className="scroll-thin flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto">
            {items}
          </nav>
          <button type="button" data-tour="search" onClick={() => setPalette(true)} className="flex h-8 shrink-0 items-center gap-2 rounded-sm border border-border bg-surface px-3 text-sm text-muted transition-colors hover:border-accent hover:text-fg">
            <Search size={15} /> Search <kbd className="rounded border border-border px-1.5 font-mono text-[0.65rem]">Ctrl K</kbd>
          </button>
          <span data-tour="settings" className="contents">
            <BarItem id={SETTINGS_NAV.id} label={SETTINGS_NAV.label} icon={<SETTINGS_NAV.icon size={size} />} variant="dock" />
          </span>
          <WindowControls />
        </div>
      )}
      {newList && <ListDialog onClose={() => setNewList(false)} />}
    </>
  );
}
