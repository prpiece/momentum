import { useDroppable } from "@dnd-kit/core";
import { format } from "date-fns";
import { useRef, useState } from "react";
import { Popover } from "../../components/ui/Popover";
import { itemsOnDay, type CalItem } from "../../domain/calendar";
import { fromLocalDate, todayLocal } from "../../domain/dates";
import type { WeekStart } from "../../domain/types";
import { Chip } from "./Blocks";
import { CreatePopover, type Draft } from "./CreatePopover";

const VISIBLE = 3;

export function MonthView({ days, anchor, items, onViewDay }: { days: string[]; anchor: string; items: CalItem[]; weekStart: WeekStart; onViewDay: (d: string) => void }) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const month = fromLocalDate(anchor).getMonth();
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="grid grid-cols-7 border-b border-border">
        {days.slice(0, 7).map((d) => (
          <div key={d} className="py-2 text-center text-[0.7rem] font-semibold uppercase tracking-wider text-muted">
            {format(fromLocalDate(d), "EEE")}
          </div>
        ))}
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-7 grid-rows-6">
        {days.map((d) => (
          <MonthCell
            key={d}
            day={d}
            inMonth={fromLocalDate(d).getMonth() === month}
            items={itemsOnDay(items, d)}
            onViewDay={onViewDay}
            onCreate={(a) => setDraft({ anchor: a, schedule: { kind: "day", date: d } })}
          />
        ))}
      </div>
      {draft && <CreatePopover draft={draft} onClose={() => setDraft(null)} />}
    </div>
  );
}

function MonthCell(props: { day: string; inMonth: boolean; items: CalItem[]; onViewDay: (d: string) => void; onCreate: (a: { x: number; y: number }) => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: `month:${props.day}`, data: { type: "slot", date: props.day, mode: "keepTime" } });
  const more = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const isToday = props.day === todayLocal();
  const hidden = props.items.length - VISIBLE;
  return (
    <div
      ref={setNodeRef}
      onClick={(e) => e.target === e.currentTarget && props.onCreate({ x: e.clientX, y: e.clientY })}
      className={`flex min-h-0 flex-col gap-0.5 overflow-hidden border-b border-l border-border p-1 transition-colors ${isOver ? "bg-accent-soft" : ""} ${props.inMonth ? "" : "bg-bg/60"}`}
    >
      <button
        type="button"
        onClick={() => props.onViewDay(props.day)}
        className={`mb-0.5 grid size-6 place-items-center self-start rounded-full font-mono text-xs ${isToday ? "bg-accent font-semibold text-accent-fg" : props.inMonth ? "text-fg hover:bg-hover" : "text-muted hover:bg-hover"}`}
      >
        {format(fromLocalDate(props.day), "d")}
      </button>
      {props.items.slice(0, VISIBLE).map((i) => (
        <Chip key={i.uid} item={i} scope={`month:${props.day}`} showTime />
      ))}
      {hidden > 0 && (
        <button ref={more} type="button" onClick={() => setOpen(true)} className="px-1 text-left text-[0.7rem] font-medium text-muted hover:text-fg">
          +{hidden} more
        </button>
      )}
      {open && (
        <Popover anchor={more} onClose={() => setOpen(false)} className="w-64 p-2">
          <div className="mb-1.5 px-1 text-xs font-semibold">{format(fromLocalDate(props.day), "EEEE, MMM d")}</div>
          <div className="space-y-0.5">
            {props.items.map((i) => (
              <Chip key={i.uid} item={i} scope={`more:${props.day}`} showTime />
            ))}
          </div>
        </Popover>
      )}
    </div>
  );
}
