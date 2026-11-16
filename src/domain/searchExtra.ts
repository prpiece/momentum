/** The part of `text` around the first hit of `query`, with ellipses, for a palette hint (FEAT-22). Null when it doesn't contain it. */
export function snippet(text: string, query: string, radius = 28): string | null {
  const flat = text.replace(/\s+/g, " ").trim();
  const q = query.trim().toLowerCase();
  const at = q ? flat.toLowerCase().indexOf(q) : -1;
  if (at < 0) return null;
  const from = Math.max(0, at - radius);
  const to = Math.min(flat.length, at + q.length + radius);
  return `${from > 0 ? "…" : ""}${flat.slice(from, to)}${to < flat.length ? "…" : ""}`;
}
