import { reorder } from "../../domain/order";

type Ordered = { id: string; sortOrder: number };

/** New sortOrders that put `ids` (in order) at `index` among `items` (a column's cards without them). */
export function placeAt(items: readonly Ordered[], ids: readonly string[], index: number): Map<string, number> {
  const cur = items.map((i) => ({ ...i }));
  const out = new Map<string, number>();
  ids.forEach((id, k) => {
    for (const c of reorder(cur, id, index + k)) {
      out.set(c.id, c.sortOrder);
      const hit = cur.find((x) => x.id === c.id);
      if (hit) hit.sortOrder = c.sortOrder;
      else cur.push({ ...c });
    }
  });
  return out;
}

/** How many cards sit wholly above the dropped card's centre: where it lands. */
export const insertionIndex = (mids: readonly number[], y: number) => mids.filter((m) => m < y).length;
