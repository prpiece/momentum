import { useDraggable, useDroppable } from "@dnd-kit/core";
import { addMonths, format, startOfMonth } from "date-fns";
import { ChevronLeft, ChevronRight, Inbox } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { TaskCheckbox } from "../../components/ui/TaskCheckbox";
import { viewDays } from "../../domain/calendar";
import { daysBetween, fromLocalDate, toLocalDate, todayLocal } from "../../domain/dates";
import { sortVMs, type TaskVM } from "../../domain/taskViews";
import { PRIORITIES, PRIORITY_LABEL, type Priority, type WeekStart } from "../../domain/types";
import { useData } from "../../stores/data";
import { useSettings } from "../../stores/settings";
import { openContextMenu, openTask, setCalAnchor, setCalSpan, useUi } from "../../stores/ui";
import { toggleDone } from "../tasks/actions";
import { taskMenu } from "../tasks/taskMenu";
import { useDerived } from "../tasks/selectors";

/** Longest range a drag shows as day columns; longer drags open the month. */
const MAX_SPAN = 14;

/** Mini month picker + "Arrange tasks": unscheduled tasks to drag onto the calendar. */
export function SidePanel({ weekStart, visible }: { weekStart: WeekStart; visible: string[] }) {
  return (
    <aside aria-label="Calendar panel" className="flex w-72 shrink-0 flex-col border-l border-border">
      <MiniMonth weekStart={weekStart} visible={visible} />
      <ArrangeTasks />
    </aside>
  );
}

function showRange(lo: string, hi: string) {
  const n = daysBetween(lo, hi) + 1;
  setCalAnchor(lo);
  if (n === 1) return;
  if (n <= MAX_SPAN) return setCalSpan(n);
  setCalSpan(null);
  const s = useSettings.getState();
  s.update({ calendar: { ...s.settings.calendar, view: "month" } });
}

function MiniMonth({ weekStart, visible }: { weekStart: WeekStart; visible: string[] }) {
  const anchor = useUi((s) => s.calAnchor);
  const [month, setMonth] = useState(() => toLocalDate(startOfMonth(fromLocalDate(anchor))));
  const days = viewDays("month", month, weekStart);
  const today = todayLocal();
  const m = fromLocalDate(month).getMonth();
  const shift = (n: number) => setMonth(toLocalDate(addMonths(fromLocalDate(month), n)));
  // Click a day to jump there; press and drag across days to show exactly that range.
  const [drag, setDragState] = useState<{ from: string; to: string } | null>(null);
  const dragRef = useRef(drag);
  const setDrag = (d: typeof drag) => setDragState((dragRef.current = d));
  const lo = drag && (drag.from < drag.to ? drag.from : drag.to);
  const hi = drag && (drag.from < drag.to ? drag.to : drag.from);
  const startDrag = (d: string) => {
    setDrag({ from: d, to: d });
    window.addEventListener(
      "pointerup",
      () => {
        const r = dragRef.current;
        setDrag(null);
        if (r) showRange(r.from < r.to ? r.from : r.to, r.from < r.to ? r.to : r.from);
      },
      { once: true },
    );
  };
  return (
    <div className="border-b border-border p-3">
      <div className="mb-2 flex items-center">
        <span className="flex-1 text-sm font-semibold">{format(fromLocalDate(month), "MMMM yyyy")}</span>
        <button type="button" aria-label="Previous month" onClick={() => shift(-1)} className="grid size-7 place-items-center rounded-sm text-muted hover:bg-hover">
          <ChevronLeft size={15} />
        </button>
        <button type="button" aria-label="Next month" onClick={() => shift(1)} className="grid size-7 place-items-center rounded-sm text-muted hover:bg-hover">
          <ChevronRight size={15} />
        </button>
      </div>
      <div className="grid grid-cols-7 text-center">
        {days.slice(0, 7).map((d) => (
          <span key={d} className="pb-1 text-[0.65rem] font-semibold text-muted">
            {format(fromLocalDate(d), "EEEEE")}
          </span>
        ))}
        {days.map((d) => {
          const dragging = !!lo && !!hi && d >= lo && d <= hi;
          const inRange = drag ? dragging : visible.includes(d);
          return (
            <button
              key={d}
              type="button"
              onPointerDown={(e) => e.button === 0 && startDrag(d)}
              onPointerEnter={() => dragRef.current && setDrag({ ...dragRef.current, to: d })}
              onClick={(e) => e.detail === 0 && setCalAnchor(d)}
              aria-label={format(fromLocalDate(d), "EEEE, MMMM d")}
              className={`mx-auto grid size-7 select-none place-items-center rounded-full font-mono text-xs transition-colors ${
                d === today && !dragging ? "bg-accent font-semibold text-accent-fg" : dragging ? "bg-accent/70 text-accent-fg" : inRange ? "bg-accent-soft text-fg" : fromLocalDate(d).getMonth() === m ? "text-fg hover:bg-hover" : "text-muted hover:bg-hover"
              }`}
            >
              {format(fromLocalDate(d), "d")}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ArrangeTasks() {
  const derived = useDerived();
  const lists = useData((s) => s.lists);
  const [listId, setListId] = useState("");
  const [minPriority, setMinPriority] = useState<Priority>(0);
  const { setNodeRef, isOver } = useDroppable({ id: "arrange", data: { type: "arrange" } });
  const tasks = useMemo(
    () =>
      sortVMs(
        derived.active.filter((v) => v.task.status === "open" && v.schedule.kind === "none" && (!listId || v.task.listId === listId) && v.task.priority >= minPriority),
        "priority",
      ),
    [derived, listId, minPriority],
  );
  return (
    <div ref={setNodeRef} className={`flex min-h-0 flex-1 flex-col transition-colors ${isOver ? "bg-accent-soft" : ""}`}>
      <div className="px-3 pt-3">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">Arrange tasks · {tasks.length}</h3>
        <p className="mt-0.5 text-[0.7rem] text-muted">Drag onto the calendar to schedule; drag a block here to unschedule.</p>
        <div className="mt-2 flex gap-1.5">
          <select value={listId} onChange={(e) => setListId(e.target.value)} aria-label="Filter by list" className="h-7 min-w-0 flex-1 rounded-sm border border-border bg-surface px-1.5 text-xs">
            <option value="">All lists</option>
            {Object.values(lists)
              .filter((l) => !l.archived)
              .map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
          </select>
          <select value={minPriority} onChange={(e) => setMinPriority(PRIORITIES.find((x) => x === Number(e.target.value)) ?? 0)} aria-label="Minimum priority" className="h-7 rounded-sm border border-border bg-surface px-1.5 text-xs">
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {p === 0 ? "Any priority" : `${PRIORITY_LABEL[p]}+`}
              </option>
            ))}
          </select>
        </div>
      </div>
      <ul className="scroll-thin mt-2 min-h-0 flex-1 space-y-1 overflow-y-auto px-2 pb-3">
        {tasks.map((vm) => (
          <ArrangeItem key={vm.task.id} vm={vm} />
        ))}
        {!tasks.length && (
          <li className="flex flex-col items-center gap-2 px-3 py-8 text-center text-xs text-muted">
            <Inbox size={22} />
            Every task has a date.
          </li>
        )}
      </ul>
    </div>
  );
}

function ArrangeItem({ vm }: { vm: TaskVM }) {
  const t = vm.task;
  const { setNodeRef, attributes, listeners, isDragging } = useDraggable({ id: `arrange:${t.id}`, data: { type: "task", id: t.id, key: null } });
  return (
    <li
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onClick={() => openTask(t.id)}
      onContextMenu={(e) => openContextMenu(e, taskMenu(t.id, null))}
      className={`flex cursor-grab items-center gap-2 rounded-sm border border-border bg-surface-2 px-2 py-1.5 text-sm shadow-sm hover:border-accent ${isDragging ? "opacity-40" : ""}`}
    >
      <TaskCheckbox status={t.status} priority={t.priority} onToggle={() => toggleDone(t.id)} label={`Complete ${t.title}`} size={15} />
      <span className="truncate">{t.title}</span>
    </li>
  );
}
