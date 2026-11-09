import { useDroppable } from "@dnd-kit/core";
import { ChevronDown, ListFilter, MoreHorizontal, Plus, Search } from "lucide-react";
import { type ReactNode, type Ref, useLayoutEffect, useRef, useState } from "react";
import { Logo } from "../../components/Logo";
import { ListGlyph } from "../../components/ui/AppIcon";
import { fitItems } from "../../domain/dockFit";
import { GO } from "../../domain/features";
import type { BarPosition, ViewId } from "../../domain/types";
import { keyLabel } from "../../lib/platform";
import type { DropData } from "../../lib/dnd";
import { useData } from "../../stores/data";
import { useSettings } from "../../stores/settings";
import { go, openMenuAt, setPalette, useUi, type MenuEntry } from "../../stores/ui";
import { FocusBadge } from "../focus/FocusView";
import { ListDialog } from "../tasks/ListDialog";
import { useCounts } from "../tasks/selectors";
import { WindowControls } from "./WindowControls";
import { MODULE_NAV, SETTINGS_NAV, SIDEBAR_SMART_NAV } from "./nav";

const GAP = 2; // px between items (gap-0.5)
const ICON = 16;

const goHint = (id: ViewId) => {
  const key = Object.entries(GO).find(([, v]) => v === id)?.[0];
  return key ? `G ${key.toUpperCase()}` : undefined;
};

function BarItem(props: { id: ViewId; label: string; icon: ReactNode; count?: number; badge?: ReactNode; drop?: DropData; hidden?: boolean; itemRef?: Ref<HTMLSpanElement> }) {
  const active = useUi((s) => s.view === props.id);
  const { setNodeRef, isOver } = useDroppable({ id: `bar:${props.id}`, data: props.drop, disabled: !props.drop || props.hidden });
  return (
    // Folded items stay laid out (out of flow, invisible) so their width can be measured.
    <span ref={props.itemRef} className={`flex shrink-0 ${props.hidden ? "invisible absolute" : ""}`} aria-hidden={props.hidden || undefined}>
      <button ref={setNodeRef} type="button" tabIndex={props.hidden ? -1 : undefined} onClick={() => go(props.id)} aria-current={active ? "page" : undefined} className={`nav-item ${isOver ? "is-drop" : ""}`}>
        <span className="ni-icon">{props.icon}</span>
        {props.label}
        {props.badge}
        {props.count ? <span className="ni-n">{props.count}</span> : null}
      </button>
    </span>
  );
}

/**
 * Navigation for the bar layout (D114, D198): one strip at the top or bottom, labels always shown.
 * Destinations that don't fit fold into "More" (D77), measured from each item's real width.
 * Lists and pinned filters sit behind a menu button.
 */
export function NavBar({ position }: { position: BarPosition }) {
  const counts = useCounts();
  const lists = useData((s) => s.lists);
  const savedFilters = useSettings((s) => s.settings.savedFilters);
  const view = useUi((s) => s.view);
  const [newList, setNewList] = useState(false);

  const dests = [
    ...SIDEBAR_SMART_NAV.map((n) => ({ ...n, count: counts.smart[n.id] || undefined, drop: { type: "smart", id: n.id } as DropData, badge: undefined })),
    ...MODULE_NAV.map((n) => ({ ...n, count: undefined, drop: undefined, badge: n.id === "focus" ? <FocusBadge /> : undefined })),
  ];

  // The nav's width doesn't depend on what's inside it (flex-1, min-w-0), so folding can't feed back into the measure.
  const navRef = useRef<HTMLElement>(null);
  const moreRef = useRef<HTMLButtonElement>(null);
  const listsRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const [fit, setFit] = useState(dests.length);
  const measure = () => {
    const nav = navRef.current;
    if (!nav) return;
    const widths = itemRefs.current.slice(0, dests.length).map((el) => el?.offsetWidth ?? 0);
    const avail = nav.clientWidth - (listsRef.current?.offsetWidth ?? 0) - GAP;
    setFit(fitItems(avail, widths, GAP, (moreRef.current?.offsetWidth ?? 0) + GAP));
  };
  // Every render: counts and the focus badge change item widths. Same result, no re-render.
  useLayoutEffect(measure);
  useLayoutEffect(() => {
    const ro = new ResizeObserver(() => measure());
    if (navRef.current) ro.observe(navRef.current);
    return () => ro.disconnect();
  }, []);

  const hidden = dests.slice(fit);
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

  return (
    <>
      <div data-tauri-drag-region className="flex h-12 shrink-0 select-none items-center gap-2 bg-bg px-3">
        <div className="pointer-events-none flex shrink-0 items-center gap-2 pl-1 pr-2">
          <Logo size={22} />
          <span className="font-semibold max-[999px]:hidden">Momentum</span>
        </div>
        <nav ref={navRef} aria-label="Navigation" data-tour="nav" className="relative flex min-w-0 flex-1 items-center gap-0.5">
          <div className="relative flex min-w-0 items-center gap-0.5 overflow-hidden">
            {dests.map((n, i) => (
              <BarItem
                key={n.id}
                itemRef={(el) => void (itemRefs.current[i] = el)}
                id={n.id}
                label={n.label}
                icon={<n.icon size={ICON} strokeWidth={1.75} />}
                count={n.count}
                badge={n.badge}
                drop={n.drop}
                hidden={i >= fit}
              />
            ))}
          </div>
          <button
            ref={moreRef}
            type="button"
            aria-current={hidden.some((n) => n.id === view) ? "page" : undefined}
            onClick={(e) => openMenuAt(e.currentTarget, hidden.map((n) => ({ label: n.label, icon: <n.icon size={14} />, hint: goHint(n.id), run: () => go(n.id) })))}
            className={`nav-item shrink-0 ${hidden.length ? "" : "invisible absolute"}`}
            tabIndex={hidden.length ? undefined : -1}
            aria-hidden={hidden.length ? undefined : true}
          >
            <span className="ni-icon">
              <MoreHorizontal size={ICON} strokeWidth={1.75} />
            </span>
            More
          </button>
          <button ref={listsRef} type="button" data-tour="lists" aria-current={onList ? "page" : undefined} onClick={(e) => openMenuAt(e.currentTarget, listsMenu())} className="nav-item shrink-0">
            <span className="ni-icon">
              <ListFilter size={ICON} strokeWidth={1.75} />
            </span>
            Lists <ChevronDown size={14} className="text-muted" />
          </button>
        </nav>
        <button type="button" data-tour="search" onClick={() => setPalette(true)} className="btn btn-secondary shrink-0 text-muted">
          <Search size={16} strokeWidth={1.75} aria-label="Search" /> <span className="max-[999px]:hidden">Search</span> <kbd className="kbd max-[999px]:hidden">{keyLabel("Ctrl K")}</kbd>
        </button>
        <span data-tour="settings" className="contents">
          <BarItem id={SETTINGS_NAV.id} label={SETTINGS_NAV.label} icon={<SETTINGS_NAV.icon size={ICON} strokeWidth={1.75} />} />
        </span>
        {position === "top" && <WindowControls />}
      </div>
      {newList && <ListDialog onClose={() => setNewList(false)} />}
    </>
  );
}
