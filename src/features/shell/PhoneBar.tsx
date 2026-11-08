import { CalendarDays, MoreHorizontal, Plus, Search, Sun, Target, type LucideIcon } from "lucide-react";
import { useMemo } from "react";
import { ListGlyph } from "../../components/ui/AppIcon";
import type { ViewId } from "../../domain/types";
import { useData } from "../../stores/data";
import { go, openMenuAt, setPalette, useUi, type MenuEntry } from "../../stores/ui";
import { focusQuickAdd } from "../tasks/QuickAdd";
import { MODULE_NAV, SETTINGS_NAV, SMART_LIST_NAV } from "./nav";

const MAIN: { id: ViewId; label: string; icon: LucideIcon }[] = [
  { id: "today", label: "Today", icon: Sun },
  { id: "calendar", label: "Calendar", icon: CalendarDays },
];
const SECOND: { id: ViewId; label: string; icon: LucideIcon }[] = [{ id: "habits", label: "Habits", icon: Target }];
const IN_BAR = new Set<ViewId>([...MAIN, ...SECOND].map((n) => n.id));

function Item({ id, label, icon: Icon }: { id: ViewId; label: string; icon: LucideIcon }) {
  const active = useUi((s) => s.view === id);
  return (
    <li>
      <button type="button" onClick={() => go(id)} aria-current={active ? "page" : undefined} className={`flex h-[var(--bottom-bar)] w-16 flex-col items-center justify-center gap-0.5 text-[12px] font-medium ${active ? "text-accent-text" : "text-muted"}`}>
        <Icon size={18} strokeWidth={1.75} />
        {label}
      </button>
    </li>
  );
}

/**
 * The phone layout's bottom bar (below 720px, D200): Today, Calendar, a round add button, Habits and More.
 * Everything else (Inbox, Upcoming, Focus, Progress, lists, search, Settings) is in More.
 */
export function PhoneBar() {
  const view = useUi((s) => s.view);
  const lists = useData((s) => s.lists);
  const userLists = useMemo(() => Object.values(lists).filter((l) => l.id !== "inbox" && !l.archived).sort((a, b) => Number(b.pinned) - Number(a.pinned) || a.sortOrder - b.sortOrder), [lists]);
  const more = (): MenuEntry[] => [
    ...[...SMART_LIST_NAV, ...MODULE_NAV].filter((n) => !IN_BAR.has(n.id)).map((n): MenuEntry => ({ label: n.label, icon: <n.icon size={16} />, run: () => go(n.id) })),
    ...(userLists.length ? (["sep"] as const) : []),
    ...userLists.map((l): MenuEntry => ({ label: l.name, icon: <ListGlyph icon={l.icon} color={l.color} size={16} />, run: () => go(`list:${l.id}`) })),
    "sep",
    { label: "Search", icon: <Search size={16} />, run: () => setPalette(true) },
    { label: SETTINGS_NAV.label, icon: <SETTINGS_NAV.icon size={16} />, run: () => go(SETTINGS_NAV.id) },
  ];
  return (
    <nav aria-label="Main" className="shrink-0 border-t border-border bg-surface pb-[env(safe-area-inset-bottom)]">
      <ul className="flex h-[var(--bottom-bar)] items-center justify-around">
        {MAIN.map((n) => (
          <Item key={n.id} {...n} />
        ))}
        <li>
          <button type="button" aria-label="New task" onClick={focusQuickAdd} className="grid size-11 place-items-center rounded-full bg-accent text-accent-fg hover:bg-accent-hover active:bg-accent-press">
            <Plus size={20} strokeWidth={1.75} />
          </button>
        </li>
        {SECOND.map((n) => (
          <Item key={n.id} {...n} />
        ))}
        <li>
          <button
            type="button"
            aria-haspopup="menu"
            aria-current={IN_BAR.has(view) ? undefined : "page"}
            onClick={(e) => openMenuAt(e.currentTarget, more())}
            className={`flex h-[var(--bottom-bar)] w-16 flex-col items-center justify-center gap-0.5 text-[12px] font-medium ${IN_BAR.has(view) ? "text-muted" : "text-accent-text"}`}
          >
            <MoreHorizontal size={18} strokeWidth={1.75} />
            More
          </button>
        </li>
      </ul>
    </nav>
  );
}
