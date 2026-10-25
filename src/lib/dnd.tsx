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
import { useData } from "../stores/data";
import { useUi } from "../stores/ui";

/*
 * One DndContext for the whole app (pointer-based; native HTML5 DnD is never used because
 * Tauri's file-drop handler swallows it on Windows). Features register drop handlers by
 * drop-target type, so the sidebar, list, kanban, calendar and matrix compose without
 * knowing about each other.
 */

export type DragData =
  | { type: "task"; id: string; key: string | null; container?: string }
  /** Calendar block move/resize. `edge` is set when resizing. */
  | { type: "block"; id: string; key: string | null; edge: "start" | "end" | null; source: "task" | "event" };

export type DropData =
  | { type: "list"; listId: string }
  | { type: "smart"; id: "inbox" | "today" | "tomorrow" }
  | { type: "task"; id: string; container: string }
  | { type: "section"; listId: string; sectionId: string | null }
  /** Calendar target: a time-grid column (`time`), the all-day row (`allDay`) or a month cell (`keepTime`). */
  | { type: "slot"; date: string; mode: "time" | "allDay" | "keepTime" }
  | { type: "arrange" }
  | { type: "quadrant"; q: 1 | 2 | 3 | 4 }
  | { type: "kanban-column"; listId: string; sectionId: string | null };

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
  typeof v === "object" && v !== null && "type" in v && (v.type === "task" || v.type === "block");

const DROP_TYPES: readonly DropData["type"][] = ["list", "smart", "task", "section", "slot", "arrange", "quadrant", "kanban-column"];
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
      <DragOverlay dropAnimation={null}>{active?.type === "task" ? <TaskGhost id={active.id} /> : null}</DragOverlay>
    </DndContext>
  );
}

function TaskGhost({ id }: { id: string }) {
  const title = useData((s) => s.tasks[id]?.title ?? "");
  const selection = useUi((s) => s.selection);
  const count = selection.includes(id) ? selection.length : 1;
  return (
    <div className="flex max-w-xs cursor-grabbing items-center gap-2 rounded-md border border-accent bg-surface-2 px-3 py-2 text-sm font-medium shadow-lg">
      <span className="size-3 rounded-full border-2 border-accent" />
      <span className="truncate">{title}</span>
      {count > 1 && <span className="rounded-full bg-accent px-1.5 text-xs text-accent-fg">{count}</span>}
    </div>
  );
}
