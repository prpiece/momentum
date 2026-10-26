import { useDraggable } from "@dnd-kit/core";
import { Check, PanelRightOpen, Repeat, Trash2 } from "lucide-react";
import { memo, useState } from "react";
import { minutesInDay, resizedSchedule, type CalItem, type Placed } from "../../domain/calendar";
import { formatTime } from "../../domain/dates";
import type { Schedule } from "../../domain/types";
import { justDragged, markDragged } from "../../lib/dnd";
import { useSettings } from "../../stores/settings";
import { go, openContextMenu, openEvent, openTask, type MenuEntry } from "../../stores/ui";
import { toggleDone } from "../tasks/actions";
import { taskMenu } from "../tasks/taskMenu";
import { applySchedule, deleteEvent, minuteAt, pxPerMinute } from "./calendarActions";

export function openItem(item: CalItem) {
  if (justDragged()) return;
  if (item.source === "task") openTask(item.id, item.key);
  else if (item.source === "event") openEvent(item.id, item.key);
  else go(item.source === "habit" ? "habits" : "focus");
}

function itemMenu(item: CalItem): MenuEntry[] {
  if (item.source === "task") return taskMenu(item.id, item.key);
  if (item.source !== "event") return [];
  return [
    { label: "Open event", icon: <PanelRightOpen size={14} />, run: () => openEvent(item.id, item.key) },
    ...(item.readOnly ? [] : ["sep" as const, { label: "Delete event", icon: <Trash2 size={14} />, danger: true, run: () => void deleteEvent(item.id, item.key) }]),
  ];
}

/** Right-click handler for any calendar item (blocks, chips, agenda rows). */
export const onItemMenu = (item: CalItem) => (e: React.MouseEvent) => {
  const items = itemMenu(item);
  if (items.length) openContextMenu(e, items);
};

const tint = (color: string, done: boolean) => ({
  background: `color-mix(in oklch, ${color} ${done ? 8 : 18}%, var(--surface-2))`,
  borderLeftColor: color,
});

function useBlockDrag(item: CalItem, scope: string) {
  return useDraggable({
    id: `block:${item.uid}:${scope}`,
    data: { type: "block", id: item.id, key: item.key, edge: null, source: item.source === "task" ? "task" : "event" },
    disabled: item.readOnly,
  });
}

function DoneCheck({ item }: { item: CalItem }) {
  if (item.source !== "task") return null;
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={item.done}
      aria-label={`Complete ${item.title}`}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        toggleDone(item.id, item.key);
      }}
      className="mt-px grid size-3.5 shrink-0 place-items-center rounded-full border-[1.5px]"
      style={{ borderColor: item.color, background: item.done ? item.color : "transparent" }}
    >
      {item.done && <Check size={9} strokeWidth={4} className="text-white" />}
    </button>
  );
}

/** A timed block in a day column: drag to move, drag the top/bottom edge to resize. */
export const TimeBlock = memo(function TimeBlock({ placed, day }: { placed: Placed; day: string }) {
  const { item, col, cols } = placed;
  const timeFormat = useSettings((s) => s.settings.timeFormat);
  const { setNodeRef, attributes, listeners, isDragging } = useBlockDrag(item, day);
  const [preview, setPreview] = useState<{ top: number; bottom: number } | null>(null);
  const px = pxPerMinute();
  const top = preview?.top ?? placed.top;
  const bottom = preview?.bottom ?? placed.bottom;
  const height = (bottom - top) * px;

  const startResize = (edge: "start" | "end") => (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    e.preventDefault();
    if (item.readOnly || !item.start || !item.end) return;
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const schedule: Schedule = { kind: "timed", start: item.start.toISOString(), end: item.end.toISOString() };
    let next: Schedule = schedule;
    const move = (ev: PointerEvent) => {
      const m = minuteAt(day, ev.clientY);
      if (m === null) return;
      next = resizedSchedule(schedule, edge, m, day);
      if (next.kind !== "timed") return;
      setPreview({
        top: edge === "start" ? minutesInDay(new Date(next.start), day) : placed.top,
        bottom: edge === "end" ? minutesInDay(new Date(next.end), day) : placed.bottom,
      });
    };
    const up = () => {
      markDragged();
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      setPreview(null);
      if (next !== schedule) void applySchedule(item, next);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
  };

  const label = item.start && item.end ? `${formatTime(item.start, timeFormat)} – ${formatTime(item.end, timeFormat)}` : "";
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onClick={() => openItem(item)}
      onContextMenu={onItemMenu(item)}
      onKeyDown={(e) => e.key === "Enter" && openItem(item)}
      aria-label={`${item.title}, ${label}`}
      className={`group absolute overflow-hidden rounded-sm border-l-[3px] px-1.5 py-0.5 text-xs leading-tight shadow-sm transition-[opacity,box-shadow] duration-[var(--dur)] hover:z-10 hover:shadow-lg ${
        item.readOnly ? "cursor-default" : "cursor-grab"
      } ${isDragging ? "opacity-30" : ""} ${item.done ? "opacity-60" : ""} ${preview ? "z-20 ring-2 ring-accent" : ""}`}
      style={{
        top: top * px,
        height: Math.max(height, 14),
        left: `calc(${(col / cols) * 100}% + 1px)`,
        width: `calc(${100 / cols}% - 3px)`,
        ...tint(item.color, item.done),
      }}
    >
      {!item.readOnly && (
        <div onPointerDown={startResize("start")} className="absolute inset-x-0 top-0 h-1.5 cursor-ns-resize" aria-hidden="true" />
      )}
      <div className="flex items-start gap-1">
        <DoneCheck item={item} />
        <span className={`min-w-0 flex-1 truncate font-medium ${item.done ? "line-through" : ""}`}>{item.title}</span>
        {item.recurring && <Repeat size={10} className="mt-0.5 shrink-0 opacity-60" />}
      </div>
      {height > 30 && <div className="truncate font-mono text-[0.65rem] text-fg-2">{preview ? "…" : label}</div>}
      {!item.readOnly && (
        <div onPointerDown={startResize("end")} className="absolute inset-x-0 bottom-0 h-2 cursor-ns-resize" aria-hidden="true" />
      )}
    </div>
  );
});

/** Compact pill for all-day rows, month cells and popovers. */
export const Chip = memo(function Chip({ item, scope, showTime }: { item: CalItem; scope: string; showTime?: boolean }) {
  const timeFormat = useSettings((s) => s.settings.timeFormat);
  const { setNodeRef, attributes, listeners, isDragging } = useBlockDrag(item, scope);
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onClick={() => openItem(item)}
      onContextMenu={onItemMenu(item)}
      onKeyDown={(e) => e.key === "Enter" && openItem(item)}
      className={`flex h-5 min-w-0 items-center gap-1 rounded-[5px] border-l-[3px] px-1.5 text-[0.7rem] leading-none ${item.readOnly ? "" : "cursor-grab"} ${
        isDragging ? "opacity-30" : ""
      } ${item.done ? "opacity-60" : ""}`}
      style={item.allDay ? tint(item.color, item.done) : { borderLeftColor: "transparent" }}
    >
      {!item.allDay && <span className="size-1.5 shrink-0 rounded-full" style={{ background: item.color }} />}
      <DoneCheck item={item} />
      {showTime && item.start && <span className="shrink-0 font-mono text-[0.65rem] text-muted">{formatTime(item.start, timeFormat)}</span>}
      <span className={`truncate font-medium ${item.done ? "line-through" : ""}`}>{item.title}</span>
    </div>
  );
});
