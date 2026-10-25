import { useDroppable, type DragMoveEvent } from "@dnd-kit/core";
import { format } from "date-fns";
import { useEffect, useMemo, useRef, useState } from "react";
import { hhmmOf, itemsOnDay, layoutDay, MINUTES_PER_DAY, snap, SNAP, type CalItem } from "../../domain/calendar";
import { atLocalTime, formatTime, fromLocalDate, timed, todayLocal } from "../../domain/dates";
import { isDragData, onDragMove } from "../../lib/dnd";
import { useSettings } from "../../stores/settings";
import { Chip, TimeBlock } from "./Blocks";
import { dragRef, dropMinute, HOUR_PX, minuteAt, previewMinutes } from "./calendarActions";
import { CreatePopover, type Draft } from "./CreatePopover";

const ALL_DAY_ROWS = 3;

/** Day / 3-day / week grid: header, all-day row, scrolling time columns. */
export function TimeGrid({ days, items, onViewDay }: { days: string[]; items: CalItem[]; onViewDay: (d: string) => void }) {
  const density = useSettings((s) => s.settings.calendar.density);
  const timeFormat = useSettings((s) => s.settings.timeFormat);
  const hourPx = HOUR_PX[density];
  const scroller = useRef<HTMLDivElement>(null);
  const today = todayLocal();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [ghost, setGhost] = useState<{ date: string; top: number; minutes: number } | null>(null);

  // Start scrolled to ~7:00 (or an hour before now when today is visible).
  useEffect(() => {
    const now = new Date();
    const hour = days.includes(today) ? Math.max(0, now.getHours() - 1) : 7;
    scroller.current?.scrollTo({ top: hour * hourPx });
    // Only when the visible range or scale changes, not on every render.
  }, [days[0], hourPx]);

  // Live snapped preview of where a dragged item would land.
  useEffect(
    () =>
      onDragMove((e: DragMoveEvent | null) => {
        const over = e?.over?.data.current;
        const drag = e?.active.data.current;
        if (!e || !over || over.type !== "slot" || over.mode !== "time" || !isDragData(drag)) return setGhost(null);
        const m = dropMinute(e, over.date);
        const ref = dragRef(drag);
        if (m === null || !ref) return setGhost(null);
        setGhost({ date: over.date, top: snap(m), minutes: previewMinutes(ref) });
      }),
    [],
  );

  const byDay = useMemo(() => days.map((d) => ({ day: d, placed: layoutDay(items, d), allDay: itemsOnDay(items, d).filter((i) => i.allDay) })), [days, items]);
  const cols = `3.5rem repeat(${days.length}, minmax(0, 1fr))`;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="grid border-b border-border pr-2" style={{ gridTemplateColumns: cols }}>
        <div />
        {days.map((d) => {
          const date = fromLocalDate(d);
          return (
            <button key={d} type="button" onClick={() => onViewDay(d)} className="flex flex-col items-center py-2 hover:bg-hover">
              <span className={`text-[0.7rem] font-semibold uppercase tracking-wider ${d === today ? "text-accent" : "text-muted"}`}>{format(date, "EEE")}</span>
              <span className={`mt-0.5 grid size-8 place-items-center rounded-full font-mono text-lg ${d === today ? "bg-accent text-accent-fg" : ""}`}>{format(date, "d")}</span>
            </button>
          );
        })}
      </div>

      <div className="grid border-b border-border pr-2" style={{ gridTemplateColumns: cols }}>
        <div className="pr-2 pt-1.5 text-right text-[0.65rem] text-muted">all-day</div>
        {byDay.map(({ day, allDay }) => (
          <AllDayCell key={day} day={day} items={allDay} onCreate={(anchor) => setDraft({ anchor, schedule: { kind: "day", date: day } })} />
        ))}
      </div>

      <div ref={scroller} className="scroll-thin relative min-h-0 flex-1 overflow-y-auto">
        <div className="relative grid" style={{ gridTemplateColumns: cols, height: 24 * hourPx }}>
          <div className="relative">
            {Array.from({ length: 23 }, (_, i) => i + 1).map((h) => (
              <span key={h} className="absolute right-2 -translate-y-1/2 font-mono text-[0.65rem] text-muted" style={{ top: h * hourPx }}>
                {formatTime(new Date(2000, 0, 1, h), timeFormat)}
              </span>
            ))}
          </div>
          {byDay.map(({ day, placed }) => (
            <DayColumn
              key={day}
              day={day}
              hourPx={hourPx}
              isToday={day === today}
              ghost={ghost?.date === day ? ghost : null}
              onCreate={(d) => setDraft(d)}
            >
              {placed.map((p) => (
                <TimeBlock key={p.item.uid} placed={p} day={day} />
              ))}
            </DayColumn>
          ))}
        </div>
      </div>
      {draft && <CreatePopover draft={draft} onClose={() => setDraft(null)} />}
    </div>
  );
}

function AllDayCell({ day, items, onCreate }: { day: string; items: CalItem[]; onCreate: (anchor: { x: number; y: number }) => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: `allday:${day}`, data: { type: "slot", date: day, mode: "allDay" } });
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? items : items.slice(0, ALL_DAY_ROWS);
  return (
    <div
      ref={setNodeRef}
      onClick={(e) => e.target === e.currentTarget && onCreate({ x: e.clientX, y: e.clientY })}
      className={`min-h-8 space-y-0.5 border-l border-border p-0.5 transition-colors ${isOver ? "bg-accent-soft" : ""}`}
    >
      {shown.map((i) => (
        <Chip key={i.uid} item={i} scope={`allday:${day}`} />
      ))}
      {items.length > ALL_DAY_ROWS && (
        <button type="button" onClick={() => setExpanded(!expanded)} className="px-1 text-[0.65rem] font-medium text-muted hover:text-fg">
          {expanded ? "Show less" : `+${items.length - ALL_DAY_ROWS} more`}
        </button>
      )}
    </div>
  );
}

function DayColumn(props: {
  day: string;
  hourPx: number;
  isToday: boolean;
  ghost: { top: number; minutes: number } | null;
  onCreate: (d: Draft) => void;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `col:${props.day}`, data: { type: "slot", date: props.day, mode: "time" } });
  const [sel, setSel] = useState<{ from: number; to: number } | null>(null);
  const px = props.hourPx / 60;
  const timeFormat = useSettings((s) => s.settings.timeFormat);

  // Click or drag on empty space to create.
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || e.target !== e.currentTarget) return;
    const start = minuteAt(props.day, e.clientY);
    if (start === null) return;
    const from = Math.floor(start / SNAP) * SNAP;
    let to = from + 60;
    let moved = false;
    setSel({ from, to });
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const m = minuteAt(props.day, ev.clientY);
      if (m === null) return;
      moved = true;
      to = Math.max(from + SNAP, Math.min(MINUTES_PER_DAY, Math.ceil(m / SNAP) * SNAP));
      setSel({ from, to });
    };
    const up = (ev: PointerEvent) => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      const length = moved ? to - from : 60;
      props.onCreate({
        anchor: { x: ev.clientX, y: ev.clientY },
        schedule: timed(atLocalTime(props.day, hhmmOf(from)), length),
        onClose: () => setSel(null),
      });
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
  };

  const now = new Date();
  const nowTop = (now.getHours() * 60 + now.getMinutes()) * px;
  useMinuteTick(props.isToday);

  return (
    <div
      ref={setNodeRef}
      data-cal-col={props.day}
      onPointerDown={onPointerDown}
      className={`relative border-l border-border ${isOver ? "bg-accent-soft/40" : props.isToday ? "bg-[color-mix(in_oklch,var(--accent)_3%,transparent)]" : ""}`}
      style={{
        backgroundImage: `repeating-linear-gradient(to bottom, var(--border) 0 1px, transparent 1px ${props.hourPx}px)`,
      }}
    >
      {props.children}
      {sel && (
        <div className="pointer-events-none absolute inset-x-1 z-20 rounded-sm border-2 border-accent bg-accent-soft px-1.5 py-0.5 text-[0.7rem] font-medium" style={{ top: sel.from * px, height: (sel.to - sel.from) * px }}>
          {formatTime(new Date(2000, 0, 1, 0, sel.from), timeFormat)} – {formatTime(new Date(2000, 0, 1, 0, sel.to), timeFormat)}
        </div>
      )}
      {props.ghost && (
        <div className="pointer-events-none absolute inset-x-1 z-30 rounded-sm border-2 border-dashed border-accent bg-accent-soft px-1.5 text-[0.7rem] font-semibold" style={{ top: props.ghost.top * px, height: Math.max(props.ghost.minutes, SNAP) * px }}>
          {formatTime(new Date(2000, 0, 1, 0, props.ghost.top), timeFormat)}
        </div>
      )}
      {props.isToday && (
        <div className="pointer-events-none absolute inset-x-0 z-20" style={{ top: nowTop }} aria-label="Current time">
          <div className="absolute -left-1.5 -top-1.5 size-3 rounded-full bg-accent" />
          <div className="h-0.5 bg-accent" />
        </div>
      )}
    </div>
  );
}

/** Re-render once a minute (moves the now-line). */
function useMinuteTick(active: boolean) {
  const [, setT] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setT((t) => t + 1), 60_000);
    return () => clearInterval(id);
  }, [active]);
}
