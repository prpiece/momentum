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
import { reducedMotion } from "./motion";

/*
 * One DndContext for the whole app (pointer-based; native HTML5 DnD is never used because
 * Tauri's file-drop handler swallows it on Windows). Features register drop handlers by
 * drop-target type, so the sidebar, list, kanban, calendar and matrix compose without
 * knowing about each other.
 */

export type DragData =
  | { type: "task"; id: string; key: string | null; container?: string }
  /** Calendar block move/resize. `edge` is set when resizing. */
  | { type: "block"; id: string; key: string | null; edge: "start" | "end" | null; source: "task" | "event" }
  | { type: "habit"; id: string }
  /** Board column grabbed by its header. */
  | { type: "column"; id: string; listId: string }
  | { type: "folder"; id: string };

export type DropData =
  | { type: "list"; listId: string }
  | { type: "smart"; id: "inbox" | "today" | "upcoming" }
  | { type: "task"; id: string; container: string }
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
  typeof v === "object" && v !== null && "type" in v && (v.type === "task" || v.type === "block" || v.type === "habit" || v.type === "column" || v.type === "folder");

const DROP_TYPES: readonly DropData["type"][] = ["list", "smart", "task", "section", "slot", "arrange", "quadrant", "kanban-column", "habit", "column", "folder"];
const isDropData = (v: unknown): v is DropData =>
  typeof v === "object" && v !== null && "type" in v && (DROP_TYPES as readonly unknown[]).includes(v.type);

let lastDragEnd = 0;
/** True right after a drag ended: the trailing click must not open the dragged item. */
export const justDragged = () => Date.now() - lastDragEnd < 250;
/** Custom pointer gestures (calendar resize) call this so their trailing click is ignored too. */
export const markDragged = () => void (lastDragEnd = Date.now());

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
