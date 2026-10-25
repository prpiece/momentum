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
