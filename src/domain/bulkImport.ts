import { MAX_SUBTASK_DEPTH } from "./types";

export const IMPORT_CAP = 500;

/**
 * Leading list markers, in any stack ("- [ ] 1. x"): bullets `-` `*` `•`, numbers `1.` `1)`,
 * single letters `a.` `B)`, roman numerals `iv.` `ii)`, any of those in brackets `(a)` `(3)`,
 * and checkboxes `[ ]` `[x]`.
 */
const MARKER = /^(?:[-*•]\s+|(?:\d+|[a-zA-Z]|[ivxIVX]{1,4})[.)]\s+|\((?:\d+|[a-zA-Z]|[ivxIVX]{1,4})\)\s+|\[[ xX]?\]\s*)+/;

/** One task to create. `parent` is the index of its parent item, or null for a top-level task. */
export type ImportItem = { text: string; parent: number | null };

/** Leading indentation in columns; a tab counts as 4. */
const indentOf = (line: string) => {
  let n = 0;
  for (const c of line) {
    if (c === " ") n += 1;
    else if (c === "\t") n += 4;
    else break;
  }
  return n;
};

/**
 * Pasted text → tasks (D92). Split on new lines, or on `separator` when given; markers are
 * stripped, blanks skipped, and the result capped at IMPORT_CAP. With new lines, a line indented
 * deeper than the one above becomes its subtask, nesting at most MAX_SUBTASK_DEPTH levels.
 */
export function splitImport(text: string, separator?: string): { items: ImportItem[]; total: number } {
  const lines = separator ? text.split(separator) : text.split(/\r?\n/);
  const all: ImportItem[] = [];
  // Open ancestors: indentation and item index, shallowest first.
  const stack: { indent: number; index: number }[] = [];
  for (const line of lines) {
    const title = line.replace(/\s+/g, " ").trim().replace(MARKER, "").trim();
    if (!title) continue;
    const indent = separator ? 0 : indentOf(line);
    while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
    // Deeper than the limit: a sibling of the deepest allowed level.
    if (stack.length > MAX_SUBTASK_DEPTH) stack.length = MAX_SUBTASK_DEPTH;
    all.push({ text: title, parent: stack.length ? stack[stack.length - 1].index : null });
    stack.push({ indent, index: all.length - 1 });
  }
  return { items: all.slice(0, IMPORT_CAP), total: all.length };
}
