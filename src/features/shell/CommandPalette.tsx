import { CornerDownLeft, Hash, Moon, PanelLeft, Plus, Search, Sun, SunMoon, Keyboard, ListPlus, CheckCircle2, Circle } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import { Dialog } from "../../components/ui/Dialog";
import { matchScore } from "../../domain/taskViews";
import type { ViewId } from "../../domain/types";
import { useData } from "../../stores/data";
import { useSettings } from "../../stores/settings";
import { go, openTask, setPalette, setShortcuts, useUi } from "../../stores/ui";
import { ListDialog } from "../tasks/ListDialog";
import { focusQuickAdd } from "../tasks/QuickAdd";
import { useDerived } from "../tasks/selectors";
import { MODULE_NAV, SETTINGS_NAV, SMART_LIST_NAV } from "./nav";

type Item = { id: string; group: string; label: string; hint?: string; icon: ReactNode; run: () => void; score: number };

/** Extra palette sources (habits, countdowns…) registered by later features. */
type Source = (q: string) => Omit<Item, "score">[];
const sources: Source[] = [];
export const addPaletteSource = (s: Source) => sources.push(s);

export function CommandPalette() {
  const open = useUi((s) => s.paletteOpen);
  const [newList, setNewList] = useState(false);
  if (!open && !newList) return null;
  return (
    <>
      {open && <PaletteBody onNewList={() => (setPalette(false), setNewList(true))} />}
      {newList && <ListDialog onClose={() => setNewList(false)} />}
    </>
  );
}

function PaletteBody({ onNewList }: { onNewList: () => void }) {
  const [q, setQ] = useState("");
  const [cursor, setCursor] = useState(0);
  const derived = useDerived();
  const lists = useData((s) => s.lists);
  const tags = useData((s) => s.tags);
  const update = useSettings((s) => s.update);
  const collapsed = useSettings((s) => s.settings.sidebarCollapsed);
  const close = () => setPalette(false);

  const items = useMemo<Item[]>(() => {
    const navTo = (view: ViewId) => () => (go(view), close());
    const commands: Omit<Item, "score">[] = [
      { id: "new-task", group: "Commands", label: "New task", hint: "N", icon: <Plus size={16} />, run: () => (close(), setTimeout(focusQuickAdd, 50)) },
      { id: "new-list", group: "Commands", label: "New list", icon: <ListPlus size={16} />, run: onNewList },
      ...[...SMART_LIST_NAV, ...MODULE_NAV, SETTINGS_NAV].map((n) => ({
        id: `go-${n.id}`,
        group: "Commands",
        label: `Go to ${n.label}`,
        icon: <n.icon size={16} />,
        run: navTo(n.id),
      })),
      { id: "theme-light", group: "Commands", label: "Switch theme: Light", icon: <Sun size={16} />, run: () => (update({ theme: "light" }), close()) },
      { id: "theme-dark", group: "Commands", label: "Switch theme: Dark", icon: <Moon size={16} />, run: () => (update({ theme: "dark" }), close()) },
      { id: "theme-system", group: "Commands", label: "Switch theme: System", icon: <SunMoon size={16} />, run: () => (update({ theme: "system" }), close()) },
      { id: "sidebar", group: "Commands", label: collapsed ? "Expand sidebar" : "Collapse sidebar", icon: <PanelLeft size={16} />, run: () => (update({ sidebarCollapsed: !collapsed }), close()) },
      { id: "shortcuts", group: "Commands", label: "Keyboard shortcuts", hint: "?", icon: <Keyboard size={16} />, run: () => (close(), setShortcuts(true)) },
    ];
    const listItems = Object.values(lists).map((l) => ({
      id: `list-${l.id}`,
      group: "Lists",
      label: l.name,
      icon: <span className="text-sm">{l.emoji ?? "•"}</span>,
      run: navTo(l.id === "inbox" ? "inbox" : `list:${l.id}`),
    }));
    const tagItems = Object.values(tags).map((t) => ({ id: `tag-${t.id}`, group: "Tags", label: `#${t.name}`, icon: <Hash size={16} />, run: navTo(`tag:${t.id}`) }));
    const query = q.trim();
    if (!query) return commands.slice(0, 8).map((c) => ({ ...c, score: 0 }));
    const taskItems = derived.vms.map((vm) => ({
      id: `task-${vm.task.id}`,
      group: "Tasks",
      label: vm.task.title,
      hint: lists[vm.task.listId]?.name,
      icon: vm.task.status === "open" ? <Circle size={16} /> : <CheckCircle2 size={16} className="text-success" />,
      run: () => (close(), openTask(vm.task.id, vm.key)),
      text: `${vm.task.title} ${vm.task.description}`,
      done: vm.task.status !== "open",
    }));
    const scored: Item[] = [];
    for (const c of [...commands, ...listItems, ...tagItems, ...sources.flatMap((s) => s(query))]) {
      const score = matchScore(c.label, query);
      if (score !== null) scored.push({ ...c, score });
    }
    for (const { text, done, ...t } of taskItems) {
      // Title hits beat description hits; finished tasks rank below open ones.
      const base = matchScore(t.label, query) ?? (matchScore(text, query) !== null ? 10 : null);
      if (base !== null) scored.push({ ...t, score: base + (done ? 1 : 0) });
    }
    const order = ["Commands", "Lists", "Tags", "Habits", "Tasks"];
    return scored
      .sort((a, b) => a.score - b.score || order.indexOf(a.group) - order.indexOf(b.group))
      .slice(0, 40)
      .sort((a, b) => order.indexOf(a.group) - order.indexOf(b.group));
  }, [q, derived, lists, tags, update, collapsed, onNewList]);

  const pick = (i: number) => items[i]?.run();

  return (
    <Dialog label="Command palette" onClose={close} width="max-w-xl" top>
      <div className="flex items-center gap-3 border-b border-border px-4">
        <Search size={18} className="text-muted" />
        <input
          autoFocus
          value={q}
          onChange={(e) => (setQ(e.target.value), setCursor(0))}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") (e.preventDefault(), setCursor((c) => Math.min(c + 1, items.length - 1)));
            if (e.key === "ArrowUp") (e.preventDefault(), setCursor((c) => Math.max(c - 1, 0)));
            if (e.key === "Enter") pick(cursor);
          }}
          placeholder="Search tasks, lists, tags, or type a command…"
          aria-label="Search"
          role="combobox"
          aria-expanded="true"
          aria-controls="palette-results"
          aria-activedescendant={items[cursor] ? `pi-${items[cursor].id}` : undefined}
          className="h-14 flex-1 bg-transparent text-base outline-none placeholder:text-muted"
        />
      </div>
      <ul id="palette-results" role="listbox" className="scroll-thin max-h-[50vh] overflow-y-auto p-2">
        {items.length === 0 && <li className="px-3 py-6 text-center text-sm text-muted">No matches for “{q}”.</li>}
        {items.map((it, i) => (
          <li key={it.id} id={`pi-${it.id}`} role="option" aria-selected={i === cursor}>
            {(i === 0 || items[i - 1].group !== it.group) && <div className="px-3 pb-1 pt-2 text-[0.7rem] font-semibold uppercase tracking-wider text-muted">{it.group}</div>}
            <button
              type="button"
              onMouseMove={() => setCursor(i)}
              onClick={() => pick(i)}
              className={`flex w-full items-center gap-3 rounded-sm px-3 py-2 text-left text-sm ${i === cursor ? "bg-accent-soft text-fg" : "text-fg-2"}`}
            >
              <span className="text-muted">{it.icon}</span>
              <span className="flex-1 truncate">{it.label}</span>
              {it.hint && <span className="truncate text-xs text-muted">{it.hint}</span>}
              {i === cursor && <CornerDownLeft size={14} className="text-muted" />}
            </button>
          </li>
        ))}
      </ul>
    </Dialog>
  );
}
