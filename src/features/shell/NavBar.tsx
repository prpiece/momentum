import { useDroppable } from "@dnd-kit/core";
import { ChevronDown, ListFilter, MoreHorizontal, Plus, Search } from "lucide-react";
import { type MouseEvent, type ReactNode, useLayoutEffect, useRef, useState } from "react";
import { Logo } from "../../components/Logo";
import { ListGlyph } from "../../components/ui/AppIcon";
import { fitModules } from "../../domain/dockFit";
import type { ViewId } from "../../domain/types";
import type { DropData } from "../../lib/dnd";
import { GO } from "../../lib/shortcuts";
import { useData } from "../../stores/data";
import { useSettings } from "../../stores/settings";
import { go, openMenuAt, setPalette, useUi, type MenuEntry } from "../../stores/ui";
import { FocusBadge } from "../focus/FocusView";
import { ListDialog } from "../tasks/ListDialog";
import { useCounts } from "../tasks/selectors";
import { WindowControls } from "./WindowControls";
import { MODULE_NAV, MORE_NAV, PRIMARY_MODULE_NAV, SETTINGS_NAV, SIDEBAR_SMART_NAV } from "./nav";

type Variant = "top" | "dock";

/** Dock item geometry in rem: one fixed width, so the overflow fit needs no per-item measuring (D77). */
const DOCK_ITEM_REM = 4.25;
const DOCK_ICON_REM = 2.5;
const DOCK_GAP_REM = 0.125;
const DOCK_SEP_REM = 0.75; // margins around a 1px divider
const DOCK_PAD_REM = 1.5; // nav padding, both sides
const DOCK_INSET_REM = 1; // breathing room to the window edge

const dockBtn = (labels: boolean) =>
  `relative flex shrink-0 items-center justify-center rounded-sm text-sm transition-colors duration-[var(--dur)] ${labels ? "h-12 w-[4.25rem] flex-col gap-0.5 text-[0.65rem] font-medium leading-none" : "size-10"}`;
const dockState = (active: boolean) => (active ? "bg-accent-soft font-semibold text-fg" : "text-fg-2 hover:bg-hover hover:text-fg");

/** Styled tooltip for dock items: label plus shortcut, on hover and keyboard focus. Motion is zeroed globally under reduced motion. */
function Tip({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <span className="group relative flex shrink-0">
      {children}
      <span
        role="presentation"
        className="pointer-events-none absolute bottom-full left-1/2 z-30 mb-2 flex -translate-x-1/2 items-center gap-1.5 whitespace-nowrap rounded-sm border border-border bg-surface-2 px-2 py-1 text-xs text-fg opacity-0 shadow-lg transition-opacity duration-[var(--dur)] group-hover:opacity-100 group-has-[:focus-visible]:opacity-100"
      >
        {label}
        {hint && <kbd className="rounded border border-border px-1 font-mono text-[0.65rem] text-muted">{hint}</kbd>}
      </span>
    </span>
  );
}

const goHint = (id: ViewId) => {
  const key = Object.entries(GO).find(([, v]) => v === id)?.[0];
  return key ? `G ${key.toUpperCase()}` : undefined;
};

function BarItem(props: { id: ViewId; label: string; icon: ReactNode; variant: Variant; labels?: boolean; tooltip?: boolean; count?: number; badge?: ReactNode; drop?: DropData }) {
  const active = useUi((s) => s.view === props.id);
  const { setNodeRef, isOver } = useDroppable({ id: `bar:${props.id}`, data: props.drop, disabled: !props.drop });
  const dock = props.variant === "dock";
  const labels = dock && props.labels === true;
  const button = (
    <button
      ref={setNodeRef}
      type="button"
      onClick={() => go(props.id)}
      aria-current={active ? "page" : undefined}
      aria-label={dock ? props.label : undefined}
      title={dock && !props.tooltip ? props.label : undefined}
      className={`${dock ? dockBtn(labels) : "relative flex h-8 shrink-0 items-center gap-2 rounded-sm px-3 text-sm transition-colors duration-[var(--dur)]"} focus-visible:ring-2 focus-visible:ring-accent ${
        isOver ? "bg-accent text-accent-fg" : dockState(active)
      }`}
    >
      <span className={active && !isOver ? "text-accent" : ""}>{props.icon}</span>
      {labels && <span>{props.label}</span>}
      {!dock && props.label}
      {!dock && props.badge}
      {props.count ? (
        <span className={dock ? "absolute right-0.5 top-0.5 min-w-4 rounded-full bg-accent px-1 font-mono text-[0.6rem] leading-4 text-accent-fg" : "font-mono text-xs text-muted"}>{props.count}</span>
      ) : null}
    </button>
  );
  return props.tooltip ? (
    <Tip label={props.label} hint={goHint(props.id)}>
      {button}
    </Tip>
  ) : (
    button
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
  const dockLabels = useSettings((s) => s.settings.dockLabels);
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
  const btn = "flex h-8 shrink-0 items-center gap-1.5 rounded-sm px-3 text-sm transition-colors duration-[var(--dur)] hover:bg-hover hover:text-fg focus-visible:ring-2 focus-visible:ring-accent";
  const sep = <span className="mx-1 h-5 w-px shrink-0 bg-border" aria-hidden />;
  const smartItems = SIDEBAR_SMART_NAV.map((n) => (
    <BarItem key={n.id} id={n.id} label={n.label} icon={<n.icon size={size} />} variant={variant} labels={dockLabels} tooltip={dock} count={counts.smart[n.id] || undefined} drop={n.id === "logbook" ? undefined : { type: "smart", id: n.id }} />
  ));

  // Dock: all modules, the trailing ones folded into "More" when the window is too narrow (D77).
  const outerRef = useRef<HTMLDivElement>(null);
  const smartRef = useRef<HTMLDivElement>(null);
  const lastRef = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState(MODULE_NAV.length);
  useLayoutEffect(() => {
    const outer = outerRef.current;
    const smart = smartRef.current;
    const last = lastRef.current;
    if (!dock || !outer || !smart || !last) return;
    const measure = () => {
      const rem = parseFloat(getComputedStyle(document.documentElement).fontSize);
      const avail = outer.clientWidth - (DOCK_INSET_REM + DOCK_PAD_REM + 2 * DOCK_SEP_REM) * rem - 4 - smart.offsetWidth - last.offsetWidth;
      const item = (dockLabels ? DOCK_ITEM_REM : DOCK_ICON_REM) * rem;
      setFit(fitModules(avail, item, DOCK_GAP_REM * rem, MODULE_NAV.length));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(outer);
    ro.observe(smart);
    ro.observe(last);
    return () => ro.disconnect();
  }, [dock, dockLabels]);

  const dockSep = <span className="mx-1.5 h-8 w-px shrink-0 bg-border" aria-hidden />;
  const shown = MODULE_NAV.slice(0, fit);
  const hidden = MODULE_NAV.slice(fit);
  const hiddenActive = hidden.some((n) => n.id === view);
  const dockPlain = (label: string, hint: string | undefined, icon: ReactNode, active: boolean, props: { onClick: (e: MouseEvent<HTMLButtonElement>) => void; tour?: string }) => (
    <Tip label={label} hint={hint}>
      <button type="button" aria-label={label} data-tour={props.tour} onClick={props.onClick} className={`${dockBtn(dockLabels)} focus-visible:ring-2 focus-visible:ring-accent ${dockState(active)}`}>
        <span className={active ? "text-accent" : ""}>{icon}</span>
        {dockLabels && <span>{label}</span>}
      </button>
    </Tip>
  );

  const items = (
    <>
      {smartItems}
      {sep}
      {PRIMARY_MODULE_NAV.map((n) => (
        <BarItem key={n.id} id={n.id} label={n.label} icon={<n.icon size={size} />} variant={variant} badge={n.id === "focus" ? <FocusBadge /> : undefined} />
      ))}
      {/* The current module stays visible next to Calendar, like the sidebar's closed "More". */}
      {MORE_NAV.filter((n) => n.id === view).map((n) => (
        <BarItem key={n.id} id={n.id} label={n.label} icon={<n.icon size={size} />} variant={variant} />
      ))}
      <button type="button" aria-label="More" onClick={(e) => openMenuAt(e.currentTarget, MORE_NAV.map((n) => ({ label: n.label, icon: <n.icon size={14} />, run: () => go(n.id) })))} className={`${btn} text-fg-2`}>
        <MoreHorizontal size={size} /> More
      </button>
      <button type="button" aria-label="Lists" title="Lists" data-tour="lists" onClick={(e) => openMenuAt(e.currentTarget, listsMenu())} className={`${btn} ${onList ? "bg-accent-soft font-semibold text-fg" : "text-fg-2"}`}>
        <ListFilter size={size} className={onList ? "text-accent" : ""} />
        Lists <ChevronDown size={14} />
      </button>
    </>
  );

  return (
    <>
      {dock ? (
        <div ref={outerRef} className="flex shrink-0 justify-center pb-2">
          <nav aria-label="Navigation" data-tour="nav" className="glass flex max-w-[calc(100%-1rem)] items-center rounded-lg border border-border bg-surface-2 p-1.5 shadow-lg">
            <div ref={smartRef} className="flex items-center gap-0.5">
              {smartItems}
            </div>
            {dockSep}
            <div className="flex items-center gap-0.5">
              {shown.map((n) => (
                <BarItem key={n.id} id={n.id} label={n.label} icon={<n.icon size={size} />} variant={variant} labels={dockLabels} tooltip badge={n.id === "focus" ? <FocusBadge /> : undefined} />
              ))}
              {hidden.length > 0 &&
                dockPlain("More", undefined, <MoreHorizontal size={size} />, hiddenActive, {
                  onClick: (e) => openMenuAt(e.currentTarget, hidden.map((n) => ({ label: n.label, icon: <n.icon size={14} />, hint: goHint(n.id), run: () => go(n.id) }))),
                })}
            </div>
            {dockSep}
            <div ref={lastRef} className="flex items-center gap-0.5">
              {dockPlain("Lists", undefined, <ListFilter size={size} />, onList, { tour: "lists", onClick: (e) => openMenuAt(e.currentTarget, listsMenu()) })}
              {dockPlain("Search", "Ctrl K", <Search size={size} />, false, { tour: "search", onClick: () => setPalette(true) })}
              <span data-tour="settings" className="contents">
                <BarItem id={SETTINGS_NAV.id} label={SETTINGS_NAV.label} icon={<SETTINGS_NAV.icon size={size} />} variant={variant} labels={dockLabels} tooltip />
              </span>
            </div>
          </nav>
        </div>
      ) : (
        <div data-tauri-drag-region className="glass flex h-12 shrink-0 select-none items-center gap-3 px-3">
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
