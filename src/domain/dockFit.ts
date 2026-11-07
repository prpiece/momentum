/**
 * How many leading items fit in `avail` px (D77, D198). Each item is `widths[i]` wide plus `gap`;
 * if they don't all fit, room is left for a "More" button `more` px wide.
 */
export function fitItems(avail: number, widths: readonly number[], gap: number, more: number): number {
  const span = (k: number) => widths.slice(0, k).reduce((sum, w) => sum + w + gap, 0);
  if (span(widths.length) <= avail) return widths.length;
  let k = widths.length - 1;
  while (k > 0 && span(k) + more > avail) k--;
  return k;
}
