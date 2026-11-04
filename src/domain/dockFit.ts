/**
 * How many equal-width items fit in `avail` px when the rest collapse into one more
 * button of the same width (D77). All fit -> `count`; otherwise leave room for "More".
 */
export function fitModules(avail: number, item: number, gap: number, count: number): number {
  if (count * item + Math.max(0, count - 1) * gap <= avail) return count;
  return Math.max(0, Math.min(count, Math.floor((avail - item) / (item + gap))));
}
