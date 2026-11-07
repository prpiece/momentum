import { CalendarRange, CircleCheckBig, Columns3, Grid2x2, ListFilter, ListTodo, Settings2 } from "lucide-react";
import { useMemo } from "react";
import { EmptyState } from "../../components/ui/EmptyState";
import { MenuItem, MenuLabel, MenuSeparator, Popover, useMenu } from "../../components/ui/Popover";
import { todayLocal } from "../../domain/dates";
import type { GroupBy, ListLayout, SortBy } from "../../domain/types";
import { isEmptyFilter, matchesFilter, parseFilter } from "../../domain/filter";
import { toVM } from "../../domain/taskViews";
import { updateList, useData } from "../../stores/data";
import { useSettings } from "../../stores/settings";
import { setImport, useUi } from "../../stores/ui";
import { MatrixView } from "../matrix/MatrixView";
import { setViewOptions, viewOptionsOf } from "./viewOptions";
import { TodayHabits } from "../habits/TodayHabits";
import { TodayStreak } from "../celebrate/TodayStreak";
import { CountdownChips } from "../calendar/CountdownChips";
import { BulkBar } from "./BulkBar";
import { FilterBar } from "./FilterBar";
import { KanbanView } from "./KanbanView";
import { ListDialogButton } from "./ListDialog";
import { QuickAdd } from "./QuickAdd";
import { useDerived } from "./selectors";
import { TaskListView } from "./TaskListView";
import { TimelineView } from "./TimelineView";
import type { TaskViewSpec } from "./viewSpec";

/** What a view shows: a list's own layout, or Matrix (D164, D193). Board needs sections, so only lists offer it. */
type Mode = ListLayout | "matrix";
const MODES: { id: Mode; label: string; icon: typeof ListTodo }[] = [
  { id: "list", label: "List", icon: ListTodo },
  { id: "kanban", label: "Board", icon: Columns3 },
  { id: "matrix", label: "Matrix", icon: Grid2x2 },
  { id: "timeline", label: "Timeline", icon: CalendarRange },
];
const GROUPS: { id: GroupBy; label: string }[] = [
  { id: "none", label: "None" },
  { id: "date", label: "Date" },
  { id: "priority", label: "Priority" },
  { id: "list", label: "List" },
  { id: "tag", label: "Tag" },
];
const SORTS: { id: SortBy; label: string }[] = [
  { id: "manual", label: "Manual" },
  { id: "date", label: "Date" },
  { id: "priority", label: "Priority" },
  { id: "created", label: "Newest first" },
  { id: "title", label: "Title" },
];

export function TaskView({ spec }: { spec: TaskViewSpec }) {
  const derived = useDerived();
  const today = todayLocal();
  const settings = useSettings((s) => s.settings);
  const list = useData((s) => (spec.list ? s.lists[spec.list.id] : undefined));
  const lists = useData((s) => s.lists);
  const tags = useData((s) => s.tags);
  const query = useUi((s) => s.filters[spec.id] ?? "");
  const adhoc = useMemo(() => parseFilter(query, new Date()), [query]);
  const options = viewOptionsOf(spec.id, settings.viewOptions);
  const setOptions = (o: Parameters<typeof setViewOptions>[1]) => setViewOptions(spec.id, o);
  const layout: Mode = options.mode === "matrix" ? "matrix" : list ? list.layout : options.mode;
  const setMode = (m: Mode) => {
    if (m === "matrix" || !list) return setOptions({ mode: m === "kanban" ? "list" : m });
    updateList(list.id, { layout: m });
    setOptions({ mode: "list" });
  };
  // A view whose own filter picks a status (a saved "done" filter), or a typed `done`, ignores the toggle.
  const showDone = options.showCompleted || !spec.splitCompleted || adhoc.status !== null;
  const menu = useMenu();

  const source = spec.list ? derived.vms : derived.active;
  const vms = useMemo(
    () => source.filter((v) => (showDone || v.task.status === "open") && spec.filter(v, today) && (isEmptyFilter(adhoc) || matchesFilter(v, adhoc, { today, lists, tags }))),
    [source, spec, today, adhoc, lists, tags, showDone],
  );
  const openCount = vms.filter((v) => v.task.status === "open").length;
  const tint = list?.tint && list.color ? { background: `color-mix(in oklch, ${list.color} 6%, var(--surface))` } : undefined;

  return (
    <div className="flex h-full min-h-0 flex-col" style={tint}>
      <div data-tour="toolbar" className="flex items-center gap-1 px-6 pb-3 pt-1">
        <span className="mr-2 shrink-0 font-mono text-sm text-muted">{openCount} open</span>
        <FilterBar view={spec.id} />
        <div className="flex-1" />
        {spec.id === "today" && <TodayStreak />}
        {spec.splitCompleted && (
          <button
            type="button"
            aria-pressed={options.showCompleted}
            title="Show completed"
            onClick={() => setOptions({ showCompleted: !options.showCompleted })}
            className={`mr-1 flex h-8 items-center gap-1.5 rounded-sm px-2.5 text-xs focus-visible:ring-2 focus-visible:ring-accent ${options.showCompleted ? "bg-accent-soft font-medium text-fg" : "text-fg-2 hover:bg-hover"}`}
          >
            <CircleCheckBig size={15} /> Completed
          </button>
        )}
        <div role="radiogroup" aria-label="View mode" className="mr-1 flex rounded-sm border border-border bg-bg p-0.5">
          {MODES.filter((m) => m.id !== "kanban" || list).map((l) => (
            <button
              key={l.id}
              type="button"
              role="radio"
              aria-checked={layout === l.id}
              title={l.label}
              onClick={() => setMode(l.id)}
              className={`flex h-7 items-center gap-1.5 rounded-[6px] px-2 text-xs ${layout === l.id ? "bg-surface-2 font-medium text-fg shadow-sm" : "text-muted hover:text-fg"}`}
            >
              <l.icon size={14} /> {l.label}
            </button>
          ))}
        </div>
        {layout === "list" && (
          <button ref={menu.anchor} type="button" onClick={menu.toggle} className="flex h-8 items-center gap-1.5 rounded-sm px-2.5 text-xs text-fg-2 hover:bg-hover">
            <ListFilter size={15} />
            {options.groupBy !== "none" ? `Grouped by ${options.groupBy}` : `Sort: ${SORTS.find((s) => s.id === options.sortBy)?.label}`}
          </button>
        )}
        {menu.open && (
          <Popover anchor={menu.anchor} onClose={menu.close} align="end">
            <MenuLabel>Group by</MenuLabel>
            {GROUPS.map((g) => (
              <MenuItem key={g.id} active={options.groupBy === g.id} onSelect={() => setOptions({ groupBy: g.id })}>
                {g.label}
              </MenuItem>
            ))}
            <MenuSeparator />
            <MenuLabel>Sort by</MenuLabel>
            {SORTS.map((s) => (
              <MenuItem key={s.id} active={options.sortBy === s.id} onSelect={() => setOptions({ sortBy: s.id })}>
                {s.label}
              </MenuItem>
            ))}
            <MenuSeparator />
            <MenuItem onSelect={() => (setImport(true), menu.close())}>Import tasks…</MenuItem>
          </Popover>
        )}
        {list && list.id !== "inbox" && (
          <ListDialogButton list={list}>
            <Settings2 size={16} />
          </ListDialogButton>
        )}
      </div>
      {spec.id === "today" && <CountdownChips />}

      {spec.canAdd && layout !== "kanban" && layout !== "matrix" && (
        <div data-tour="quickadd" className="px-4 pb-2">
          <QuickAdd
            defaults={spec.defaults(today)}
            isVisible={(t) => {
              const vm = toVM(t);
              return !!vm && spec.filter(vm, today);
            }}
          />
        </div>
      )}

      {spec.id === "today" && <TodayHabits />}

      {vms.length === 0 ? (
        <EmptyState icon={spec.icon} title={query ? "No matches" : (EMPTY[spec.id]?.[0] ?? "Nothing here yet")}>
          {query ? "No task in this view matches the filter." : (EMPTY[spec.id]?.[1] ?? "Add a task above. Try “Plan trip next friday #travel”.")}
        </EmptyState>
      ) : layout === "kanban" && list ? (
        <KanbanView list={list} vms={vms} />
      ) : layout === "matrix" ? (
        <MatrixView vms={vms} defaults={spec.defaults(today)} />
      ) : layout === "timeline" ? (
        <TimelineView vms={vms} />
      ) : (
        <TaskListView spec={spec} vms={vms} derived={derived} options={options} />
      )}
      <BulkBar />
    </div>
  );
}

const EMPTY: Record<string, [string, string]> = {
  today: ["A clear day", "Nothing due today. Add something above, or enjoy the quiet."],
  upcoming: ["Nothing coming up", "Tasks with a future date show up here. Ones you add here are due tomorrow."],
};
