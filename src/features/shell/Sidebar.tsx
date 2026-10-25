import { type LucideIcon, PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen } from "lucide-react";
import { useState } from "react";
import { Logo } from "../../components/Logo";
import type { ViewId } from "../../domain/types";
import { useSettings } from "../../stores/settings";
import { useUi } from "../../stores/ui";
import { MODULE_NAV, SETTINGS_NAV, SMART_LIST_NAV } from "./nav";

type Side = "left" | "right";

function NavItem(props: {
  id: ViewId;
  label: string;
  icon: LucideIcon;
  collapsed: boolean;
  side: Side;
  count?: number;
}) {
  const active = useUi((s) => s.view === props.id);
  const go = useUi((s) => s.go);
  // Fixed-position tooltip escapes the sidebar's scroll clipping.
  const [tip, setTip] = useState<DOMRect | null>(null);
  const show = (e: { currentTarget: HTMLElement }) => props.collapsed && setTip(e.currentTarget.getBoundingClientRect());
  const Icon = props.icon;
  return (
    <li>
      <button
        type="button"
        onClick={() => go(props.id)}
        onMouseEnter={show}
        onMouseLeave={() => setTip(null)}
        onFocus={show}
        onBlur={() => setTip(null)}
        aria-current={active ? "page" : undefined}
        aria-label={props.collapsed ? props.label : undefined}
        className={`flex h-[var(--row-h)] w-full items-center gap-3 rounded-sm px-3 text-sm transition-colors duration-[var(--dur)] ${
          active ? "bg-accent-soft font-semibold text-fg" : "text-fg-2 hover:bg-hover hover:text-fg"
        }`}
      >
        <Icon size={18} strokeWidth={1.9} className={`shrink-0 ${active ? "text-accent" : ""}`} />
        <span
          className={`min-w-0 flex-1 truncate text-left transition-opacity duration-[var(--dur)] ${props.collapsed ? "opacity-0" : ""}`}
        >
          {props.label}
        </span>
        {!props.collapsed && props.count ? <span className="font-mono text-xs text-muted">{props.count}</span> : null}
      </button>
      {tip && (
        <span
          role="tooltip"
          className="pointer-events-none fixed z-50 -translate-y-1/2 whitespace-nowrap rounded-sm bg-fg px-2 py-1 text-xs font-medium text-bg shadow-lg"
          style={{
            top: tip.top + tip.height / 2,
            ...(props.side === "left" ? { left: tip.right + 10 } : { right: window.innerWidth - tip.left + 10 }),
          }}
        >
          {props.label}
        </span>
      )}
    </li>
  );
}

export function Sidebar() {
  const { sidebarCollapsed: collapsed, sidebarSide: side, hiddenSmartLists } = useSettings((s) => s.settings);
  const update = useSettings((s) => s.update);
  const smart = SMART_LIST_NAV.filter((n) => !hiddenSmartLists.includes(n.id));
  const Toggle =
    side === "left" ? (collapsed ? PanelLeftOpen : PanelLeftClose) : collapsed ? PanelRightOpen : PanelRightClose;
  const item = (n: { id: ViewId; label: string; icon: LucideIcon }) => (
    <NavItem key={n.id} {...n} collapsed={collapsed} side={side} />
  );

  return (
    <aside
      aria-label="Navigation"
      className={`flex shrink-0 flex-col py-3 transition-[width] duration-[var(--dur)] ease-[var(--ease)] ${
        collapsed ? "w-[4.25rem]" : "w-64"
      }`}
    >
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

      <nav className="mt-3 min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-2">
        <ul className="space-y-0.5">{smart.map(item)}</ul>
        <div className="mx-3 my-3 h-px bg-border" />
        <ul className="space-y-0.5">{MODULE_NAV.map(item)}</ul>
      </nav>

      <ul className="px-2 pt-2">{item(SETTINGS_NAV)}</ul>
    </aside>
  );
}
