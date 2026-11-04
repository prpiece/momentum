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
