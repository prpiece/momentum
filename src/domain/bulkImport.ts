export const IMPORT_CAP = 500;

/** Leading list markers: `-`, `*`, `•`, `1.`, `1)`, `[ ]`, `[x]`, in any stack ("- [ ] 1. x"). */
const MARKER = /^(?:[-*•]\s+|\d+[.)]\s+|\[[ xX]?\]\s*)+/;

/**
 * Pasted text → task lines (D92). Split on new lines, or on `separator` when given; bullets and
 * numbering are stripped, blanks skipped, and the result capped at IMPORT_CAP.
 */
export function splitImport(text: string, separator?: string): { items: string[]; total: number } {
  const all = (separator ? text.split(separator) : text.split(/\r?\n/))
    .map((s) => s.replace(/\s+/g, " ").trim().replace(MARKER, "").trim())
    .filter(Boolean);
  return { items: all.slice(0, IMPORT_CAP), total: all.length };
}
