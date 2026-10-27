import { CalendarRange, Columns3, ListFilter, ListTodo, Settings2 } from "lucide-react";
import { useMemo } from "react";
import { EmptyState } from "../../components/ui/EmptyState";
import { MenuItem, MenuLabel, MenuSeparator, Popover, useMenu } from "../../components/ui/Popover";
import { todayLocal } from "../../domain/dates";
import { DEFAULT_VIEW_OPTIONS } from "../../domain/settings";
import type { GroupBy, ListLayout, SortBy, ViewOptions } from "../../domain/types";
import { isEmptyFilter, matchesFilter, parseFilter } from "../../domain/filter";
import { toVM } from "../../domain/taskViews";
import { updateList, useData } from "../../stores/data";
import { useSettings } from "../../stores/settings";
import { go, useUi } from "../../stores/ui";
import { TodayHabits } from "../habits/TodayHabits";
import { BulkBar } from "./BulkBar";
import { FilterBar } from "./FilterBar";
import { KanbanView } from "./KanbanView";
import { ListDialogButton } from "./ListDialog";
import { QuickAdd } from "./QuickAdd";
import { useDerived } from "./selectors";
import { TaskListView } from "./TaskListView";
import { TimelineView } from "./TimelineView";
import type { TaskViewSpec } from "./viewSpec";

const LAYOUTS: { id: ListLayout; label: string; icon: typeof ListTodo }[] = [
  { id: "list", label: "List", icon: ListTodo },
  { id: "kanban", label: "Board", icon: Columns3 },
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
  const update = useSettings((s) => s.update);
  const list = useData((s) => (spec.list ? s.lists[spec.list.id] : undefined));
  const lists = useData((s) => s.lists);
  const tags = useData((s) => s.tags);
  const query = useUi((s) => s.filters[spec.id] ?? "");
  const adhoc = useMemo(() => parseFilter(query, new Date()), [query]);
  const options: ViewOptions =
    settings.viewOptions[spec.id] ?? (spec.list ? DEFAULT_VIEW_OPTIONS : { groupBy: spec.id === "upcoming" ? "date" : "none", sortBy: "date" });
  const setOptions = (o: Partial<ViewOptions>) => update({ viewOptions: { ...settings.viewOptions, [spec.id]: { ...options, ...o } } });
  const layout: ListLayout = list?.layout ?? "list";
  const menu = useMenu();

  const source = spec.list ? derived.vms : derived.active;
  const vms = useMemo(
    () => source.filter((v) => spec.filter(v, today) && (isEmptyFilter(adhoc) || matchesFilter(v, adhoc, { today, lists, tags }))),
    [source, spec, today, adhoc, lists, tags],
  );
  const openCount = vms.filter((v) => v.task.status === "open").length;
  const tint = list?.tint && list.color ? { background: `color-mix(in oklch, ${list.color} 6%, var(--surface))` } : undefined;

  return (
    <div className="flex h-full min-h-0 flex-col" style={tint}>
      <div className="flex items-center gap-1 px-6 pb-3 pt-1">
        <span className="mr-2 shrink-0 font-mono text-sm text-muted">{openCount} open</span>
        <FilterBar view={spec.id} />
        <div className="flex-1" />
        {list && (
          <div role="radiogroup" aria-label="Layout" className="mr-1 flex rounded-sm border border-border bg-bg p-0.5">
            {LAYOUTS.map((l) => (
              <button
                key={l.id}
                type="button"
                role="radio"
                aria-checked={layout === l.id}
                title={l.label}
                onClick={() => updateList(list.id, { layout: l.id })}
                className={`flex h-7 items-center gap-1.5 rounded-[6px] px-2 text-xs ${layout === l.id ? "bg-surface-2 font-medium text-fg shadow-sm" : "text-muted hover:text-fg"}`}
              >
                <l.icon size={14} /> {l.label}
              </button>
            ))}
          </div>
        )}
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
            <MenuItem onSelect={() => (go("logbook"), menu.close())}>Open Logbook</MenuItem>
          </Popover>
        )}
        {list && list.id !== "inbox" && (
          <ListDialogButton list={list}>
            <Settings2 size={16} />
          </ListDialogButton>
        )}
      </div>

      {spec.canAdd && layout !== "kanban" && (
        <div className="px-4 pb-2">
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
  logbook: ["Nothing finished yet", "Completed and “Won't do” tasks collect here."],
};
