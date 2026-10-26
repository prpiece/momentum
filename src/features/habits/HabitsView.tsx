import { AppIcon, IconTile } from "../../components/ui/AppIcon";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { format } from "date-fns";
import { ArchiveRestore, Flame, MoreHorizontal, Plus, Target, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { EmptyState } from "../../components/ui/EmptyState";
import { addDaysLocal, fromLocalDate, todayLocal } from "../../domain/dates";
import { currentStreak, frequencyLabel, isScheduled, type Habit } from "../../domain/habits";
import { onDrop } from "../../lib/dnd";
import { removeGroup, reorderHabit, updateHabit, useHabits, valuesOf } from "../../stores/habits";
import { useSettings } from "../../stores/settings";
import { confirm, openContextMenu, openMenuAt } from "../../stores/ui";
import { confirmRemoveHabit, habitMenu } from "./habitMenu";
import { addPaletteSource } from "../shell/CommandPalette";
import { CheckinButton } from "./CheckinButton";
import { cellFill, cellTitle, HabitDetail } from "./HabitDetail";
import { HabitDialog } from "./HabitDialog";
import { HabitReview } from "./HabitReview";
import { NoteButton } from "./NoteButton";
import { matchScore } from "../../domain/taskViews";
import { go } from "../../stores/ui";

// Drop a habit row on another to reorder (and adopt that row's group).
onDrop("habit", (drag, drop) => {
  if (drag.type !== "habit" || drag.id === drop.id) return;
  const { habits } = useHabits.getState();
  const target = habits[drop.id];
  if (!target) return;
  if (habits[drag.id]?.groupId !== target.groupId) updateHabit(drag.id, { groupId: target.groupId });
  const sibs = Object.values(useHabits.getState().habits)
    .filter((h) => h.groupId === target.groupId && !h.archived)
    .sort((a, b) => a.sortOrder - b.sortOrder);
  reorderHabit(drag.id, sibs.findIndex((h) => h.id === drop.id), sibs.map((h) => h.id));
});

addPaletteSource((q) =>
  Object.values(useHabits.getState().habits)
    .filter((h) => matchScore(h.name, q) !== null)
    .map((h) => ({ id: `habit-${h.id}`, group: "Habits", label: h.name, icon: <AppIcon name={h.icon} size={16} color={h.color} />, run: () => go("habits") })),
);

export function HabitsView() {
  const habitMap = useHabits((s) => s.habits);
  const groupMap = useHabits((s) => s.groups);
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState<"habits" | "review">("habits");
  const [dialog, setDialog] = useState<{ habit?: Habit } | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const today = todayLocal();
  const [date, setDate] = useState(today);

  const habits = useMemo(() => Object.values(habitMap).sort((a, b) => a.sortOrder - b.sortOrder), [habitMap]);
  const active = habits.filter((h) => !h.archived);
  const archived = habits.filter((h) => h.archived);
  const groups = useMemo(() => {
    const gs = Object.values(groupMap).sort((a, b) => a.sortOrder - b.sortOrder);
    return [{ id: null, name: "" }, ...gs].map((g) => ({ ...g, items: active.filter((h) => h.groupId === g.id || (g.id === null && h.groupId !== null && !groupMap[h.groupId])) }));
  }, [groupMap, active]);
  const current = (selected && habitMap[selected]) || active[0] || null;
  const week = Array.from({ length: 7 }, (_, i) => addDaysLocal(today, i - 6));

  if (!habits.length)
    return (
      <>
        <EmptyState icon={Target} title="Build a habit">
          <p>Track daily routines, counts like glasses of water, or amounts like km run.</p>
          <button type="button" onClick={() => setDialog({})} className="mt-4 h-9 rounded-sm bg-accent px-4 text-sm font-medium text-accent-fg hover:bg-accent-hover">
            New habit
          </button>
        </EmptyState>
        {dialog && <HabitDialog onClose={() => setDialog(null)} />}
      </>
    );

  return (
    <div className="flex h-full min-h-0">
      <div className="flex w-[26rem] shrink-0 flex-col border-r border-border">
        <div className="flex items-center gap-2 px-4 pb-3">
          <div role="tablist" className="flex rounded-sm border border-border bg-bg p-0.5">
            {(["habits", "review"] as const).map((t) => (
              <button key={t} role="tab" type="button" aria-selected={tab === t} onClick={() => setTab(t)} className={`h-7 rounded-[6px] px-3 text-xs capitalize ${tab === t ? "bg-surface-2 font-semibold shadow-sm" : "text-muted"}`}>
                {t}
              </button>
            ))}
          </div>
          <div className="flex-1" />
          <button type="button" onClick={() => setDialog({})} className="flex h-8 items-center gap-1.5 rounded-sm bg-accent px-3 text-xs font-medium text-accent-fg hover:bg-accent-hover">
            <Plus size={14} /> New habit
          </button>
        </div>
        {/* Day picker: check in for today or catch up on the past week. */}
        <div className="grid grid-cols-7 gap-1 px-4 pb-3" role="radiogroup" aria-label="Check-in day">
          {week.map((d) => (
            <button
              key={d}
              type="button"
              role="radio"
              aria-checked={date === d}
              onClick={() => setDate(d)}
              className={`flex flex-col items-center rounded-sm py-1 text-xs ${date === d ? "bg-accent text-accent-fg" : "text-fg-2 hover:bg-hover"}`}
            >
              <span className="text-[0.65rem] uppercase">{format(fromLocalDate(d), "EEE")}</span>
              <span className="font-mono font-semibold">{format(fromLocalDate(d), "d")}</span>
            </button>
          ))}
        </div>
        <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-2 pb-4">
          <SortableContext items={active.map((h) => `habit:${h.id}`)} strategy={verticalListSortingStrategy}>
            {groups.map(
              (g) =>
                g.items.length > 0 && (
                  <section key={g.id ?? "none"} className="mb-2">
                    {g.name && <GroupHeader id={g.id} name={g.name} />}
                    <ul className="space-y-0.5">
                      {g.items.map((h) => (
                        <HabitRow key={h.id} habit={h} date={date} week={week} selected={current?.id === h.id} onSelect={() => setSelected(h.id)} onEdit={() => setDialog({ habit: h })} />
                      ))}
                    </ul>
                  </section>
                ),
            )}
          </SortableContext>
          {archived.length > 0 && (
            <div className="mt-3 px-2">
              <button type="button" onClick={() => setShowArchived(!showArchived)} className="text-xs text-muted hover:text-fg">
                {showArchived ? "Hide" : "Show"} archived · {archived.length}
              </button>
              {showArchived && (
                <ul className="mt-1 space-y-0.5 opacity-70">
                  {archived.map((h) => (
                    <li key={h.id} onContextMenu={(e) => openContextMenu(e, habitMenu(h, date))} className="group flex items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-hover">
                      <AppIcon name={h.icon} size={15} color={h.color} />
                      <span className="flex-1 truncate">{h.name}</span>
                      <button type="button" aria-label="Unarchive" onClick={() => updateHabit(h.id, { archived: false })} className="grid size-7 place-items-center rounded-sm text-muted hover:bg-hover">
                        <ArchiveRestore size={14} />
                      </button>
                      <button type="button" aria-label={`Delete ${h.name}`} onClick={() => void confirmRemoveHabit(h)} className="grid size-7 place-items-center rounded-sm text-muted hover:bg-hover hover:text-danger">
                        <Trash2 size={14} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </div>
      <div className="min-w-0 flex-1">{tab === "review" ? <HabitReview habits={active} /> : current ? <HabitDetail habit={current} onEdit={() => setDialog({ habit: current })} /> : null}</div>
      {dialog && <HabitDialog habit={dialog.habit} onClose={() => setDialog(null)} />}
    </div>
  );
}

function GroupHeader({ id, name }: { id: string | null; name: string }) {
  return (
    <div className="group/g flex items-center px-2 pb-1 pt-2 text-[0.7rem] font-semibold uppercase tracking-wider text-muted">
      <span className="flex-1">{name}</span>
      {id && (
        <button
          type="button"
          aria-label={`Delete group ${name}`}
          onClick={async () => (await confirm(`Delete group “${name}”?`, "Its habits stay; they just leave the group.")) && removeGroup(id)}
          className="opacity-0 hover:text-danger group-hover/g:opacity-100"
        >
          <Trash2 size={12} />
        </button>
      )}
    </div>
  );
}

function HabitRow(props: { habit: Habit; date: string; week: string[]; selected: boolean; onSelect: () => void; onEdit: () => void }) {
  const h = props.habit;
  const records = useHabits((s) => s.checkins[h.id]);
  const ws = useSettings((s) => s.settings.weekStart);
  const values = valuesOf(records);
  const streak = currentStreak(h, values, todayLocal(), ws);
  const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({ id: `habit:${h.id}`, data: { type: "habit", id: h.id } });
  const scheduled = isScheduled(h, props.date) || h.frequency.kind === "perWeek";

  return (
    <li
      ref={setNodeRef}
      style={{ transform: transform ? `translate3d(0, ${transform.y}px, 0)` : undefined, transition }}
      {...attributes}
      {...listeners}
      onClick={props.onSelect}
      onContextMenu={(e) => openContextMenu(e, habitMenu(h, props.date, props.onEdit))}
      className={`group flex items-center gap-3 rounded-md px-2 py-2 transition-colors ${props.selected ? "bg-accent-soft" : "hover:bg-hover"} ${isDragging ? "opacity-50" : ""} ${scheduled ? "" : "opacity-60"}`}
    >
      <IconTile name={h.icon} color={h.color} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{h.name}</div>
        <div className="flex items-center gap-2 text-xs text-muted">
          <span>{frequencyLabel(h.frequency)}</span>
          {streak.count > 0 && (
            <span className="inline-flex items-center gap-0.5 font-mono">
              <Flame size={11} className="text-p3" />
              {streak.count}
              {streak.unit === "week" ? "w" : "d"}
            </span>
          )}
        </div>
        <div className="mt-1 flex gap-[2px]" aria-hidden="true">
          {props.week.map((d) => (
            <span key={d} title={cellTitle(h, d, values.get(d))} className="h-1.5 flex-1 rounded-full" style={{ background: cellFill(h, values.get(d), isScheduled(h, d)) }} />
          ))}
        </div>
      </div>
      <NoteButton habit={h} date={props.date} />
      <div onPointerDown={(e) => e.stopPropagation()}>
        {scheduled ? <CheckinButton habit={h} date={props.date} /> : <span className="grid size-9 place-items-center text-[0.65rem] text-muted">Rest</span>}
      </div>
      <button type="button" aria-label={`${h.name} options`} onPointerDown={(e) => e.stopPropagation()} onClick={(e) => (e.stopPropagation(), openMenuAt(e.currentTarget, habitMenu(h, props.date, props.onEdit)))} className="grid size-7 shrink-0 place-items-center rounded-sm text-muted opacity-40 transition-opacity hover:bg-hover focus:opacity-100 group-hover:opacity-100">
        <MoreHorizontal size={15} />
      </button>
    </li>
  );
}
