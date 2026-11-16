/**
 * Fractional ordering: moving an item writes one row (the midpoint of its new neighbours).
 * When floats get too close, every sibling is renumbered.
 */
const EPS = 1e-6;

type Ordered = { id: string; sortOrder: number };

/** Order value for appending after the last item. */
export const after = (items: readonly Ordered[]): number =>
  items.length ? Math.max(...items.map((i) => i.sortOrder)) + 1 : 0;

/** Order value for prepending before the first item. */
export const before = (items: readonly Ordered[]): number =>
  items.length ? Math.min(...items.map((i) => i.sortOrder)) - 1 : 0;

/**
 * Move `movedId` to `toIndex` among `items` (sorted, may include the moved item).
 * Returns only the items whose sortOrder changed.
 */
export function reorder(items: readonly Ordered[], movedId: string, toIndex: number): Ordered[] {
  const rest = items.filter((i) => i.id !== movedId).sort((a, b) => a.sortOrder - b.sortOrder);
  const index = Math.max(0, Math.min(toIndex, rest.length));
  const prev = rest[index - 1];
  const next = rest[index];
  let value: number;
  if (!prev && !next) value = 0;
  else if (!prev) value = next.sortOrder - 1;
  else if (!next) value = prev.sortOrder + 1;
  else value = (prev.sortOrder + next.sortOrder) / 2;

  const tooTight = (prev && value - prev.sortOrder < EPS) || (next && next.sortOrder - value < EPS);
  if (!tooTight) return [{ id: movedId, sortOrder: value }];

  const ids = rest.map((i) => i.id);
  ids.splice(index, 0, movedId);
  const current = new Map(items.map((i) => [i.id, i.sortOrder]));
  return ids.map((id, i) => ({ id, sortOrder: i })).filter((o) => current.get(o.id) !== o.sortOrder);
}

const byOrder = (items: readonly Ordered[]) => [...items].sort((a, b) => a.sortOrder - b.sortOrder);

/** One step up (-1) or down (+1) among `items`; empty at either end. */
export function moveBy(items: readonly Ordered[], id: string, delta: -1 | 1): Ordered[] {
  const i = byOrder(items).findIndex((x) => x.id === id);
  const to = i + delta;
  return i < 0 || to < 0 || to >= items.length ? [] : reorder(items, id, to);
}

/**
 * Drop `movedId` on `targetId` among `items` (the target's siblings, which may or may not hold the
 * moved item): from above it lands after the target, from below or from another container, before it.
 */
export function moveNear(items: readonly Ordered[], movedId: string, targetId: string): Ordered[] {
  if (movedId === targetId) return [];
  const sorted = byOrder(items);
  const from = sorted.findIndex((x) => x.id === movedId);
  const rest = sorted.filter((x) => x.id !== movedId);
  const t = rest.findIndex((x) => x.id === targetId);
  if (t < 0) return [];
  return reorder(items, movedId, from >= 0 && from < sorted.findIndex((x) => x.id === targetId) ? t + 1 : t);
}

const asItems = (ids: readonly string[]) => ids.map((id, sortOrder) => ({ id, sortOrder }));
const applied = (ids: readonly string[], changes: Ordered[]): string[] => {
  const m = new Map(changes.map((c) => [c.id, c.sortOrder]));
  return asItems(ids).sort((a, b) => (m.get(a.id) ?? a.sortOrder) - (m.get(b.id) ?? b.sortOrder)).map((i) => i.id);
};

/** `moveNear` on a plain id list (a view's saved manual order): the new order. */
export const idsMoveNear = (ids: readonly string[], movedId: string, targetId: string): string[] => applied(ids, moveNear(asItems(ids), movedId, targetId));

/** `moveBy` on a plain id list: the new order. */
export const idsMoveBy = (ids: readonly string[], id: string, delta: -1 | 1): string[] => applied(ids, moveBy(asItems(ids), id, delta));
