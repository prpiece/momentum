/** Note images are stored as `![](attachment:<file name>)` in a task's Markdown description (D78). */
const REF = /attachment:([A-Za-z0-9_-]+\.[A-Za-z0-9]+)/g;

export const attachmentRefs = (texts: Iterable<string>): Set<string> => {
  const out = new Set<string>();
  for (const t of texts) for (const m of t.matchAll(REF)) out.add(m[1]);
  return out;
};

/** Files nothing references and that are older than `days` (modified is unix seconds). */
export const staleAttachments = (files: { name: string; modified: number }[], referenced: Set<string>, nowSec: number, days: number): string[] =>
  files.filter((f) => !referenced.has(f.name) && f.modified < nowSec - days * 86400).map((f) => f.name);

/** Files `before` referenced that neither `after` nor any of `others` still reference (D100). */
export const droppedAttachments = (before: string, after: string, others: Iterable<string>): string[] => {
  const kept = attachmentRefs([after, ...others]);
  return [...attachmentRefs([before])].filter((n) => !kept.has(n));
};
