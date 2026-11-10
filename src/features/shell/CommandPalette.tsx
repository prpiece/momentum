import { ListGlyph } from "../../components/ui/AppIcon";
import { CornerDownLeft, Hash, Search, ListFilter, CheckCircle2, Circle } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { Dialog } from "../../components/ui/Dialog";
import { Keys } from "../../components/ui/Keys";
import { matchScore } from "../../domain/taskViews";
import { FEATURES, type PaletteId } from "../../domain/features";
import type { ViewId } from "../../domain/types";
import { useData } from "../../stores/data";
import { openSettingsPage, trackDone, useSettings } from "../../stores/settings";
import { go, openTask, setImport, setPalette, setShortcuts, useUi } from "../../stores/ui";
import { ListDialog } from "../tasks/ListDialog";
import { openTour } from "./Tour";
import { focusQuickAdd } from "../tasks/QuickAdd";
import { useDerived } from "../tasks/selectors";
import { FEATURE_ICON, HELP_SECTION_ID } from "../help/featureIcons";
import { showInCurrentView } from "../tasks/viewOptions";

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
  const savedFilters = useSettings((s) => s.settings.savedFilters);
  const update = useSettings((s) => s.update);
  const collapsed = useSettings((s) => s.settings.sidebarCollapsed);
  const showCompleted = useSettings((s) => s.settings.showCompleted);
  const close = () => setPalette(false);
  useEffect(() => trackDone("palette:opened"), []);

  const items = useMemo<Item[]>(() => {
    const navTo = (view: ViewId) => () => (go(view), close());
    const run: Record<PaletteId, () => void> = {
      "new-task": () => (close(), setTimeout(focusQuickAdd, 50)),
      "new-list": onNewList,
      import: () => (close(), setImport(true)),
      "go-inbox": navTo("inbox"),
      "go-today": navTo("today"),
      "go-upcoming": navTo("upcoming"),
      "go-calendar": navTo("calendar"),
      "go-habits": navTo("habits"),
      "go-focus": navTo("focus"),
      "go-progress": navTo("progress"),
      "go-settings": navTo("settings"),
      "matrix-mode": () => (close(), showInCurrentView({ mode: "matrix" })),
      "show-completed": () => (update({ showCompleted: !showCompleted }), close()),
      "theme-light": () => (update({ theme: "light" }), close()),
      "theme-dark": () => (update({ theme: "dark" }), close()),
      "theme-system": () => (update({ theme: "system" }), close()),
      sidebar: () => (update({ sidebarCollapsed: !collapsed }), close()),
      tour: () => (close(), openTour()),
      help: () => (openSettingsPage(HELP_SECTION_ID), navTo("settings")()),
      shortcuts: () => (close(), setShortcuts(true)),
    };
    // Every static command comes from the feature registry (D167), so each has help text.
    const commands: Omit<Item, "score">[] = FEATURES.flatMap((f) =>
      f.commands.flatMap((c) => {
        if (c.kind !== "palette") return [];
        const Icon = FEATURE_ICON[f.icon];
        const label = c.id === "sidebar" ? (collapsed ? "Expand sidebar" : "Collapse sidebar") : c.text;
        return [{ id: c.id, group: "Commands", label, hint: c.hint, icon: <Icon size={16} />, run: run[c.id] }];
      }),
    );
    const listItems = Object.values(lists).map((l) => ({
      id: `list-${l.id}`,
      group: "Lists",
      label: l.name,
      icon: <ListGlyph icon={l.icon} color={l.color} size={16} />,
      run: navTo(l.id === "inbox" ? "inbox" : `list:${l.id}`),
    }));
    const tagItems = Object.values(tags).map((t) => ({ id: `tag-${t.id}`, group: "Tags", label: `#${t.name}`, icon: <Hash size={16} />, run: navTo(`tag:${t.id}`) }));
    const filterItems = savedFilters.map((f) => ({ id: `filter-${f.id}`, group: "Lists", label: f.name, hint: f.query, icon: <ListFilter size={16} />, run: navTo(`filter:${f.id}`) }));
    const query = q.trim();
    if (!query) return commands.slice(0, 8).map((c) => ({ ...c, score: 0 }));
    const taskItems = derived.vms.map((vm) => ({
      id: `task-${vm.task.id}`,
      group: "Tasks",
      label: vm.task.title,
      hint: (vm.task.parentId && derived.byId.get(vm.task.parentId)?.task.title) || lists[vm.task.listId]?.name,
      icon: vm.task.status === "open" ? <Circle size={16} /> : <CheckCircle2 size={16} className="text-success" />,
      run: () => (close(), openTask(vm.task.id, vm.key)),
      text: `${vm.task.title} ${vm.task.description}`,
      done: vm.task.status !== "open",
    }));
    const scored: Item[] = [];
    for (const c of [...commands, ...listItems, ...filterItems, ...tagItems, ...sources.flatMap((s) => s(query))]) {
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
  }, [q, derived, lists, tags, savedFilters, update, collapsed, showCompleted, onNewList]);

  const pick = (i: number) => items[i]?.run();

  return (
    <Dialog label="Command palette" onClose={close} width="max-w-[var(--palette)]" top>
      <div className="flex h-14 items-center gap-3 border-b border-border px-4">
        <Search size={18} strokeWidth={1.75} className="text-muted" />
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
          className="h-full flex-1 bg-transparent text-[length:var(--fs-lg)] outline-none placeholder:text-muted focus-visible:outline-none"
        />
      </div>
      <ul id="palette-results" role="listbox" className="max-h-[50vh] overflow-y-auto px-2 pb-2 pt-1">
        {items.length === 0 && <li className="px-3 py-6 text-center text-[length:var(--fs-sm)] text-muted">No matches for “{q}”.</li>}
        {items.map((it, i) => (
          <li key={it.id} id={`pi-${it.id}`} role="option" aria-selected={i === cursor}>
            {(i === 0 || items[i - 1].group !== it.group) && <div className="t-label px-3 pb-1 pt-2.5 text-muted">{it.group}</div>}
            <button
              type="button"
              onMouseMove={() => setCursor(i)}
              onClick={() => pick(i)}
              className={`flex h-9 w-full items-center gap-2.5 rounded-control px-3 text-left ${i === cursor ? "bg-surface-2" : ""}`}
            >
              <span className="text-fg-2">{it.icon}</span>
              <span className="flex-1 truncate">{it.label}</span>
              {it.hint && <span className="truncate text-[length:var(--fs-sm)] text-muted">{it.hint}</span>}
              {i === cursor && <CornerDownLeft size={14} strokeWidth={1.75} className="text-muted" />}
            </button>
          </li>
        ))}
      </ul>
      <div className="flex h-10 items-center gap-4 border-t border-border px-4 text-[length:var(--fs-xs)] text-muted">
        <span className="inline-flex items-center gap-1.5">
          <Keys keys="↑ ↓" /> move
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Keys keys="Enter" /> open
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Keys keys="Esc" /> close
        </span>
      </div>
    </Dialog>
  );
}
