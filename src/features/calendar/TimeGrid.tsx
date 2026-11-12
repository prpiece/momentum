import { useDroppable, type DragMoveEvent } from "@dnd-kit/core";
import { format } from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import { hhmmOf, itemsOnDay, layoutDay, MINUTES_PER_DAY, snap, SNAP, type CalItem } from "../../domain/calendar";
import { atLocalTime, formatTime, fromLocalDate, scheduleDate, timed, todayLocal } from "../../domain/dates";
import { isDragData, onDragMove } from "../../lib/dnd";
import { useData } from "../../stores/data";
import { useSettings } from "../../stores/settings";
import { useUi } from "../../stores/ui";
import { Chip, TimeBlock } from "./Blocks";
import { dragRef, dropMinute, HOUR_PX, minuteAt, previewMinutes } from "./calendarActions";
import { CreatePopover, type Draft } from "./CreatePopover";

const ALL_DAY_ROWS = 3;
const GUTTER = 56; // the 3.5rem time column
const MIN_COL = 112; // narrowest readable day column beside the drawer
const EDGE = 24; // px at the visible edge that slides the days while dragging
const HOLD = 450; // ms at the edge before each next day slides in

/**
 * The days the open task drawer leaves room for (D252). The drawer floats over the grid, so the grid
 * steps out from under it and shows as many days as fit; the rest slide in from the side, by holding
 * a drag at the edge or with the arrows in the time gutter.
 */
function useVisibleDays(root: RefObject<HTMLDivElement | null>, days: string[]) {
  const drawer = useUi((s) => s.drawer);
  const task = useData((s) => (drawer ? s.tasks[drawer.id] : undefined));
  const [box, setBox] = useState({ width: 0, cover: 0, right: true });
  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const aside = drawer ? document.querySelector<HTMLElement>("[data-task-drawer]") : null;
    const measure = () => {
      const r = el.getBoundingClientRect();
      // Offsets, not the drawer's own rect: it is still sliding in (a transform) when this first runs.
      const p = aside?.offsetParent?.getBoundingClientRect();
      const a = aside && p ? { left: p.left + aside.offsetLeft, right: p.left + aside.offsetLeft + aside.offsetWidth } : null;
      const right = !a || a.left > r.left + r.width / 2;
      const cover = !a ? 0 : Math.max(0, right ? r.right - a.left : a.right - r.left);
      // A drawer as wide as the grid (phones) covers it outright: nothing to make room for.
      setBox({ width: r.width, cover: cover >= r.width - GUTTER ? 0 : cover, right });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    if (aside) ro.observe(aside);
    return () => ro.disconnect();
  }, [root, drawer?.id]);

  const n = box.cover ? Math.min(days.length, Math.max(1, Math.floor((box.width - box.cover - GUTTER) / MIN_COL))) : days.length;
  const max = days.length - n;
  // Start with the open task's day in view.
  const at = task ? days.indexOf(scheduleDate(task.schedule) ?? "") : -1;
  const initial = at < n ? 0 : Math.min(max, at - n + 1);
  const key = `${days[0]}|${drawer?.id ?? ""}|${n}`;
  const [pos, setPos] = useState({ key: "", offset: 0, dir: 0 });
  const offset = pos.key === key ? pos.offset : initial;
  const shift = (dir: number) =>
    setPos((p) => {
      const from = p.key === key ? p.offset : initial;
      const to = Math.min(max, Math.max(0, from + dir));
      return to === from ? p : { key, offset: to, dir };
    });

  // Holding a drag at the visible edge slides the next day in, again every HOLD ms.
  const live = useRef({ box, max, shift });
  live.current = { box, max, shift };
  useEffect(() => {
    let timer = 0;
    let dir = 0;
    const stop = () => {
      window.clearInterval(timer);
      dir = 0;
    };
    const off = onDragMove((e) => {
      const { box, max } = live.current;
      const el = root.current;
      const a = e?.activatorEvent;
      const { initial: from, translated } = e?.active.rect.current ?? {};
      if (!e || !el || !max || !(a instanceof MouseEvent) || !from || !translated) return stop();
      const x = a.clientX + translated.left - from.left;
      const r = el.getBoundingClientRect();
      const left = r.left + GUTTER + (box.right ? 0 : box.cover);
      const right = r.right - (box.right ? box.cover : 0);
      const want = x > right - EDGE ? 1 : x < left ? -1 : 0;
      if (want === dir) return;
      stop();
      if (!want) return;
      dir = want;
      timer = window.setInterval(() => live.current.shift(want), HOLD);
    });
    return () => {
      off();
      stop();
    };
  }, [root]);

  return {
    shown: n === days.length ? days : days.slice(offset, offset + n),
    pad: box.cover ? { [box.right ? "paddingRight" : "paddingLeft"]: box.cover } : undefined,
    canBack: offset > 0,
    canForward: offset < max,
    shift,
    slide: pos.key === key && pos.dir ? { key: offset, dir: pos.dir } : null,
  };
}

/** Day / 3-day / week grid: header, all-day row, scrolling time columns. */
export function TimeGrid({ days, items, onViewDay }: { days: string[]; items: CalItem[]; onViewDay: (d: string) => void }) {
  const density = useSettings((s) => s.settings.calendar.density);
  const timeFormat = useSettings((s) => s.settings.timeFormat);
  const hourPx = HOUR_PX[density];
  const scroller = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const { shown, pad, canBack, canForward, shift, slide } = useVisibleDays(root, days);
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

  const byDay = useMemo(() => shown.map((d) => ({ day: d, placed: layoutDay(items, d), allDay: itemsOnDay(items, d).filter((i) => i.allDay) })), [shown, items]);
  const cols = `3.5rem repeat(${shown.length}, minmax(0, 1fr))`;
  // The day columns slide in from the side the new day came from.
  const anim = slide ? { animation: `${slide.dir > 0 ? "days-from-right" : "days-from-left"} var(--dur) var(--ease-move)` } : undefined;

  // One day: a left-aligned date header; the Day view puts the brief beside the grid (PLAN D209).
  const single = shown.length === 1;
  return (
    <div ref={root} className="flex min-h-0 min-w-0 flex-1 flex-col" style={pad}>
      <div key={`head${slide?.key}`} className="grid border-b border-border pr-2" style={{ gridTemplateColumns: cols, ...anim }}>
        <div className="flex items-center justify-center">
          {(canBack || canForward) && (
            <>
              <button type="button" className="btn btn-ghost btn-sm icon-btn !w-6 !px-0" aria-label="Earlier day" disabled={!canBack} onClick={() => shift(-1)}>
                <ChevronLeft size={16} strokeWidth={1.75} />
              </button>
              <button type="button" className="btn btn-ghost btn-sm icon-btn !w-6 !px-0" aria-label="Later day" disabled={!canForward} onClick={() => shift(1)}>
                <ChevronRight size={16} strokeWidth={1.75} />
              </button>
            </>
          )}
        </div>
        {shown.map((d) => {
          const date = fromLocalDate(d);
          return (
            <button key={d} type="button" onClick={() => onViewDay(d)} className={`@container flex min-w-0 items-center gap-1.5 border-l border-border px-1 hover:bg-surface-2 ${single ? "h-12 justify-start px-3" : "h-16 justify-center"}`}>
              <span className={`t-label ${single ? "" : "hidden @min-[4.25rem]:inline"} ${d === today ? "text-accent-text" : "text-muted"}`}>{format(date, "EEE")}</span>
              <span className={`grid size-7 shrink-0 place-items-center rounded-full text-[length:var(--fs-lg)] font-semibold tabular-nums ${d === today ? "bg-accent text-accent-fg" : ""}`}>{format(date, "d")}</span>
            </button>
          );
        })}
      </div>

      <div key={`allday${slide?.key}`} className="grid border-b border-border pr-2" style={{ gridTemplateColumns: cols, ...anim }}>
        <div className="flex items-center justify-end pr-2 text-[length:var(--fs-xs)] text-muted">all-day</div>
        {byDay.map(({ day, allDay }) => (
          <AllDayCell key={day} day={day} items={allDay} onCreate={(anchor) => setDraft({ anchor, schedule: { kind: "day", date: day } })} />
        ))}
      </div>

      <div ref={scroller} className="relative min-h-0 flex-1 overflow-y-auto">
        <div key={`body${slide?.key}`} className="relative grid" style={{ gridTemplateColumns: cols, height: 24 * hourPx, ...anim }}>
          <div className="relative">
            {Array.from({ length: 23 }, (_, i) => i + 1).map((h) => (
              <span key={h} className="absolute right-2 -translate-y-1/2 tabular-nums text-[length:var(--fs-xs)] text-muted" style={{ top: h * hourPx }}>
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
      className={`min-h-9 space-y-1 border-l border-border p-1 transition-colors ${isOver ? "bg-accent-soft" : ""}`}
    >
      {shown.map((i) => (
        <Chip key={i.uid} item={i} scope={`allday:${day}`} />
      ))}
      {items.length > ALL_DAY_ROWS && (
        <button type="button" onClick={() => setExpanded(!expanded)} className="px-1 pb-0.5 text-[length:var(--fs-xs)] font-medium text-muted hover:text-fg">
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
      className={`relative border-l border-border ${isOver ? "bg-accent-soft/40" : props.isToday ? "bg-[color-mix(in_srgb,var(--accent-soft)_40%,transparent)]" : ""}`}
      style={{
        backgroundImage: `repeating-linear-gradient(to bottom, var(--border) 0 1px, transparent 1px ${props.hourPx}px)`,
      }}
    >
      {props.children}
      {sel && (
        <div className="pointer-events-none absolute inset-x-1 z-20 rounded-control border-2 border-accent-text bg-accent-soft px-1.5 py-0.5 text-[length:var(--fs-xs)] font-medium" style={{ top: sel.from * px, height: (sel.to - sel.from) * px }}>
          {formatTime(new Date(2000, 0, 1, 0, sel.from), timeFormat)} – {formatTime(new Date(2000, 0, 1, 0, sel.to), timeFormat)}
        </div>
      )}
      {props.ghost && (
        <div className="pointer-events-none absolute inset-x-1 z-30 rounded-control border-2 border-dashed border-accent-text bg-accent-soft px-1.5 text-[length:var(--fs-xs)] font-semibold" style={{ top: props.ghost.top * px, height: Math.max(props.ghost.minutes, SNAP) * px }}>
          {formatTime(new Date(2000, 0, 1, 0, props.ghost.top), timeFormat)}
        </div>
      )}
      {props.isToday && (
        <div className="pointer-events-none absolute inset-x-0 z-20" style={{ top: nowTop }} aria-label="Current time">
          <div className="absolute -left-1 -top-[3px] size-2 rounded-full bg-accent" />
          <div className="h-0.5 bg-accent" />
        </div>
      )}
    </div>
  );
}

/** Re-render once a minute (moves the now-line). */
export function useMinuteTick(active: boolean) {
  const [, setT] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setT((t) => t + 1), 60_000);
    return () => clearInterval(id);
  }, [active]);
}
