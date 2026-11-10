import { CalendarRange, Columns3, Grid2x2, ListFilter, ListTodo, Settings2 } from "lucide-react";
import { format } from "date-fns";
import { useMemo } from "react";
import { ListGlyph } from "../../components/ui/AppIcon";
import { EmptyState } from "../../components/ui/EmptyState";
import { PageHead } from "../../components/ui/PageHead";
import { Tip } from "../../components/ui/Tip";
import { ToolbarActions } from "../../components/ui/Toolbar";
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
import { GettingStartedCard } from "../help/GettingStartedCard";
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
const MODES: { id: Mode; label: string; desc: string; keys?: string; icon: typeof ListTodo }[] = [
  { id: "list", label: "List", desc: "tasks in a single column", icon: ListTodo },
  { id: "kanban", label: "Board", desc: "tasks in columns by group", icon: Columns3 },
  { id: "timeline", label: "Timeline", desc: "tasks on a date strip", icon: CalendarRange },
  { id: "matrix", label: "Matrix", desc: "sort by urgency and importance", keys: "G M", icon: Grid2x2 },
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
  const showDone = settings.showCompleted || !spec.splitCompleted || adhoc.status !== null;
  const menu = useMenu();

  const source = spec.list ? derived.vms : derived.active;
  const vms = useMemo(
    () => source.filter((v) => (showDone || v.task.status === "open") && spec.filter(v, today) && (isEmptyFilter(adhoc) || matchesFilter(v, adhoc, { today, lists, tags }))),
    [source, spec, today, adhoc, lists, tags, showDone],
  );
  const openCount = vms.filter((v) => v.task.status === "open").length;
  const tint = list?.tint && list.color ? { background: `color-mix(in oklch, ${list.color} 6%, var(--surface))` } : undefined;
  // List mode reads as a page (880px, centred); Board, Timeline and Matrix use the full width (D198).
  const page = layout === "list" ? "mx-auto w-full max-w-[var(--content-max)]" : "w-full";

  return (
    <div className="flex h-full min-h-0 flex-col" style={tint}>
      <div className={`${page} px-[var(--gutter)] pb-5 pt-6`}>
        <PageHead
          title={spec.title}
          lead={list?.icon && list.id !== "inbox" ? <ListGlyph icon={list.icon} color={list.color} size={20} /> : undefined}
          sub={
            <span className="tabular-nums">
              {spec.id === "today" && `${format(new Date(), "EEEE d MMMM")} · `}
              <span key={openCount} className="anim-count">{openCount}</span> open
            </span>
          }
        >
          {spec.id === "today" && <TodayStreak />}
          <FilterBar view={spec.id} />
        </PageHead>
      </div>
      <ToolbarActions>
        <div data-tour="toolbar" className="flex items-center gap-1.5">
        <div role="radiogroup" aria-label="View mode" className="seg">
          {MODES.filter((m) => m.id !== "kanban" || list).map((l) => (
            <Tip key={l.id} label={l.label} desc={l.desc} keys={l.keys}>
              <button type="button" role="radio" aria-checked={layout === l.id} aria-label={`${l.label}: ${l.desc}`} onClick={() => setMode(l.id)} className={`seg-item ${layout === l.id ? "is-on" : ""}`}>
                <l.icon size={16} strokeWidth={1.75} /> <span className="@max-[44rem]/tb:sr-only">{l.label}</span>
              </button>
            </Tip>
          ))}
        </div>
        <span className="tb-sep" aria-hidden />
        {layout === "list" && (
          <button ref={menu.anchor} type="button" title="Sort and group" onClick={menu.toggle} aria-haspopup="menu" aria-expanded={menu.open} className="btn btn-ghost">
            <ListFilter size={16} strokeWidth={1.75} />
            <span className="@max-[44rem]/tb:sr-only">{options.groupBy !== "none" ? `Group: ${GROUPS.find((g) => g.id === options.groupBy)?.label}` : `Sort: ${SORTS.find((s) => s.id === options.sortBy)?.label}`}</span>
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
            <Settings2 size={16} strokeWidth={1.75} />
          </ListDialogButton>
        )}
        </div>
      </ToolbarActions>
      {spec.id === "today" && (
        <div className={`${page} px-[var(--gutter)]`}>
          <GettingStartedCard />
          <CountdownChips />
        </div>
      )}

      {spec.canAdd && layout !== "kanban" && layout !== "matrix" && (
        <div data-tour="quickadd" className={`${page} px-[var(--gutter)] pb-3`}>
          <QuickAdd
            defaults={spec.defaults(today)}
            isVisible={(t) => {
              const vm = toVM(t);
              return !!vm && spec.filter(vm, today);
            }}
          />
        </div>
      )}

      {spec.id === "today" && (
        <div className={`${page} px-[var(--gutter)]`}>
          <TodayHabits />
        </div>
      )}

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
