import type { SmartListId } from "../domain/types";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  rectIntersection,
  type CollisionDetection,
  type DragEndEvent,
  type DragMoveEvent,
  type DragStartEvent,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { type ReactNode, useState } from "react";
import { IconTile } from "../components/ui/AppIcon";
import { useData } from "../stores/data";
import { useHabits } from "../stores/habits";
import { useUi } from "../stores/ui";
import { QUADRANT_INFO } from "../domain/matrix";
import { reducedMotion } from "./motion";

/*
 * One DndContext for the whole app (pointer-based; native HTML5 DnD is never used because
 * Tauri's file-drop handler swallows it on Windows). Features register drop handlers by
 * drop-target type, so the sidebar, list, kanban, calendar and matrix compose without
 * knowing about each other.
 */

export type DragData =
  /** `date`: the row's day, in views that move tasks between days by dragging (D253). */
  | { type: "task"; id: string; key: string | null; container?: string; date?: string | null }
  /** Calendar block move/resize. `edge` is set when resizing. */
  | { type: "block"; id: string; key: string | null; edge: "start" | "end" | null; source: "task" | "event" }
  | { type: "habit"; id: string }
  /** Board column grabbed by its header. */
  | { type: "column"; id: string; listId: string }
  | { type: "folder"; id: string }
  /** A sidebar list row grabbed to reorder it or move it into a folder. */
  | { type: "listrow"; id: string };

export type DropData =
  | { type: "list"; listId: string }
  | { type: "smart"; id: SmartListId }
  | { type: "task"; id: string; container: string; date?: string | null }
  | { type: "section"; listId: string; sectionId: string | null }
  /** Calendar target: a time-grid column (`time`), the all-day row (`allDay`) or a month cell (`keepTime`). */
  | { type: "slot"; date: string; mode: "time" | "allDay" | "keepTime" }
  | { type: "arrange" }
  | { type: "quadrant"; q: 1 | 2 | 3 | 4 }
  | { type: "kanban-column"; listId: string; sectionId: string | null }
  | { type: "habit"; id: string }
  | { type: "column"; id: string; listId: string }
  /** Sidebar folder; `id: null` is the top level. */
  | { type: "folder"; id: string | null };

type Handler = (drag: DragData, drop: DropData, e: DragEndEvent) => void;
const handlers = new Map<DropData["type"], Handler>();

/** Register at module scope in the feature that owns the drop target. */
export function onDrop<T extends DropData["type"]>(type: T, fn: (drag: DragData, drop: Extract<DropData, { type: T }>, e: DragEndEvent) => void) {
  handlers.set(type, fn as Handler);
}

type MoveListener = (e: DragMoveEvent | null) => void;
const moveListeners = new Set<MoveListener>();
/** Live drag position (calendar uses it for the drop preview). */
export function onDragMove(fn: MoveListener) {
  moveListeners.add(fn);
  return () => void moveListeners.delete(fn);
}

/** Prefer whatever is under the pointer (sidebar targets, calendar slots); fall back to overlap. */
const collision: CollisionDetection = (args) => {
  const hits = pointerWithin(args);
  return hits.length ? hits : rectIntersection(args);
};

export const isDragData = (v: unknown): v is DragData =>
  typeof v === "object" && v !== null && "type" in v && (v.type === "task" || v.type === "block" || v.type === "habit" || v.type === "column" || v.type === "folder" || v.type === "listrow");

const DROP_TYPES: readonly DropData["type"][] = ["list", "smart", "task", "section", "slot", "arrange", "quadrant", "kanban-column", "habit", "column", "folder"];
const isDropData = (v: unknown): v is DropData =>
  typeof v === "object" && v !== null && "type" in v && (DROP_TYPES as readonly unknown[]).includes(v.type);

/**
 * `onKeyDown` for a draggable row that also opens on Enter. Spreading `listeners` and then setting
 * `onKeyDown` would replace dnd-kit's handler and kill keyboard dragging (Space), so chain to it.
 */
export const rowKeys = (open: () => void, dragKeys: Function | undefined) => (e: React.KeyboardEvent) => {
  if (e.target !== e.currentTarget) return;
  if (e.key === "Enter") open();
  else dragKeys?.(e);
};

let lastDragEnd = 0;
/** True right after a drag ended: the trailing click must not open the dragged item. */
export const justDragged = () => Date.now() - lastDragEnd < 250;
/** Custom pointer gestures (calendar resize) call this so their trailing click is ignored too. */
export const markDragged = () => void (lastDragEnd = Date.now());

// ---------- screen-reader text for keyboard drags ----------

function dragName(d: unknown): string {
  if (!isDragData(d)) return "item";
  const { tasks, events, lists, sections } = useData.getState();
  switch (d.type) {
    case "task": return tasks[d.id]?.title ?? "task";
    case "block": return (d.source === "event" ? events[d.id]?.title : tasks[d.id]?.title) ?? "item";
    case "habit": return useHabits.getState().habits[d.id]?.name ?? "habit";
    case "column": return sections[d.id]?.name ?? "column";
    case "listrow": return lists[d.id]?.name ?? "list";
    case "folder": return useData.getState().folders[d.id]?.name ?? "folder";
  }
}

function dropName(d: unknown): string {
  if (!isDropData(d)) return "a drop target";
  const { tasks, lists, sections } = useData.getState();
  switch (d.type) {
    case "list": return lists[d.listId]?.name ?? "list";
    case "smart": return d.id;
    case "task": return `${tasks[d.id]?.title ?? "task"}`;
    case "section": return d.sectionId ? (sections[d.sectionId]?.name ?? "section") : "no section";
    case "kanban-column": return d.sectionId ? (sections[d.sectionId]?.name ?? "column") : "Unsectioned";
    case "slot": return d.mode === "allDay" ? `${d.date}, all day` : d.date;
    case "arrange": return "the unscheduled panel";
    case "quadrant": return QUADRANT_INFO[d.q].title;
    case "habit": return useHabits.getState().habits[d.id]?.name ?? "habit";
    case "column": return sections[d.id]?.name ?? "column";
    case "folder": return d.id ? (useData.getState().folders[d.id]?.name ?? "folder") : "the top level";
  }
}

const ANNOUNCEMENTS = {
  onDragStart: ({ active }: { active: { data: { current?: unknown } } }) => `Picked up ${dragName(active.data.current)}.`,
  onDragOver: ({ active, over }: { active: { data: { current?: unknown } }; over: { data: { current?: unknown } } | null }) =>
    over ? `${dragName(active.data.current)} is over ${dropName(over.data.current)}.` : `${dragName(active.data.current)} is not over a drop target.`,
  onDragEnd: ({ active, over }: { active: { data: { current?: unknown } }; over: { data: { current?: unknown } } | null }) =>
    over ? `Dropped ${dragName(active.data.current)} on ${dropName(over.data.current)}.` : `${dragName(active.data.current)} was dropped. Nothing changed.`,
  onDragCancel: ({ active }: { active: { data: { current?: unknown } } }) => `Cancelled. ${dragName(active.data.current)} was not moved.`,
};

const DRAG_INSTRUCTIONS = "To pick up, press Space. Use the arrow keys to choose where to drop it, Space to drop, Escape to cancel.";

export function DndRoot({ children }: { children: ReactNode }) {
  const [active, setActive] = useState<DragData | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const end = (e: DragEndEvent) => {
    lastDragEnd = Date.now();
    setActive(null);
    moveListeners.forEach((fn) => fn(null));
    const drag = e.active.data.current;
    const drop = e.over?.data.current;
    if (!isDragData(drag) || !isDropData(drop)) return;
    handlers.get(drop.type)?.(drag, drop, e);
  };

  return (
    <DndContext
      sensors={sensors}
      accessibility={{ announcements: ANNOUNCEMENTS, screenReaderInstructions: { draggable: DRAG_INSTRUCTIONS } }}
      collisionDetection={collision}
      onDragStart={(e: DragStartEvent) => {
        const d = e.active.data.current;
        setActive(isDragData(d) ? d : null);
      }}
      onDragMove={(e) => moveListeners.forEach((fn) => fn(e))}
      onDragEnd={end}
      onDragCancel={() => {
        setActive(null);
        moveListeners.forEach((fn) => fn(null));
      }}
    >
      {children}
      {/* The ghost settles into its slot; reduced motion drops it instantly. */}
      <DragOverlay dropAnimation={reducedMotion() ? null : { duration: 180, easing: "cubic-bezier(.4, 0, .2, 1)" }}>
        {active?.type === "task" ? <TaskGhost id={active.id} /> : active?.type === "habit" ? <HabitGhost id={active.id} /> : null}
      </DragOverlay>
    </DndContext>
  );
}

/** Shared by every vertical sortable: neighbours slide into place over the same 180ms move curve (CSS drops it under reduced motion). */
export const SORT_TRANSITION = { duration: 180, easing: "cubic-bezier(.4, 0, .2, 1)" };

/** Which edge of this row the dragged item will land on, or null. Moving down lands below the target, moving up above it. */
export function dropSide(s: { isOver: boolean; isDragging: boolean; index: number; activeIndex: number }): "above" | "below" | null {
  return s.isOver && !s.isDragging && s.activeIndex >= 0 ? (s.activeIndex < s.index ? "below" : "above") : null;
}

/** The insertion indicator: a 2px accent line on a row's top or bottom edge. The row must be `relative`. Stays under reduced motion. */
export function DropLine({ side }: { side: "above" | "below" | null }) {
  if (!side) return null;
  return <span aria-hidden className={`pointer-events-none absolute inset-x-0 z-10 h-0.5 rounded-full bg-accent-text ${side === "above" ? "top-0" : "bottom-0"}`} />;
}

function HabitGhost({ id }: { id: string }) {
  const h = useHabits((s) => s.habits[id]);
  if (!h) return null;
  return (
    <div className="flex max-w-xs cursor-grabbing items-center gap-3 rounded-card border border-accent bg-raised px-3 py-2 font-medium shadow-float">
      <IconTile name={h.icon} color={h.color} size={28} />
      <span className="truncate">{h.name}</span>
    </div>
  );
}

function TaskGhost({ id }: { id: string }) {
  const title = useData((s) => s.tasks[id]?.title ?? "");
  const selection = useUi((s) => s.selection);
  const count = selection.includes(id) ? selection.length : 1;
  return (
    <div className="flex max-w-xs cursor-grabbing items-center gap-2 rounded-card border border-accent bg-raised px-3 py-2 text-sm font-medium shadow-float">
      <span className="size-3 rounded-full border-2 border-accent" />
      <span className="truncate">{title}</span>
      {count > 1 && <span className="rounded-full bg-accent px-1.5 text-xs text-accent-fg">{count}</span>}
    </div>
  );
}
