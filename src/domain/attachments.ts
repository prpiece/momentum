/** The largest note image the app stores or syncs (the Rust commands and the bucket enforce the same 10 MB). */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

/** Note images are stored as `![](attachment:<file name>)` in a task's Markdown description (D78). */
// The stem is capped at 64 characters, like `valid_name` in src-tauri/src/files.rs.
const NAME = "[A-Za-z0-9_-]{1,64}\\.[A-Za-z0-9]+";
const REF = new RegExp(`attachment:(${NAME})`, "g");
const VALID = new RegExp(`^${NAME}$`);

/** Note text is untrusted (a collaborator can write it): only names of this shape may become a file path, asset URL or storage path. */
export const isAttachmentName = (name: string): boolean => VALID.test(name);

export const attachmentRefs = (texts: Iterable<string>): Set<string> => {
  const out = new Set<string>();
  for (const t of texts) for (const m of t.matchAll(REF)) out.add(m[1]);
  return out;
};

/** Files nothing references and that are older than `days` (modified is unix seconds). */
export const staleAttachments = (files: { name: string; modified: number }[], referenced: Set<string>, nowSec: number, days: number): string[] =>
  files.filter((f) => !referenced.has(f.name) && f.modified < nowSec - days * 86400).map((f) => f.name);

/** Referenced note images this device holds and hasn't settled with the server yet: what to upload (D291). */
export const toUpload = (referenced: Set<string>, local: Iterable<string>, settled: Set<string>): string[] =>
  [...local].filter((n) => referenced.has(n) && !settled.has(n));

const TYPES: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp" };
/** The MIME type the bucket expects for a note image; null for anything else. */
export const imageType = (name: string): string | null => TYPES[name.slice(name.lastIndexOf(".") + 1).toLowerCase()] ?? null;

/**
 * What an upload's reply means: `done` when the file is there now (a duplicate is an earlier upload of
 * the same name) or can never go (too large, not an image); `retry` for anything else (offline, access
 * not there yet, over the storage quota).
 */
export function uploadOutcome(error: { statusCode?: string; message?: string } | null): "done" | "retry" {
  if (!error) return "done";
  return ["409", "413", "415"].includes(error.statusCode ?? "") || /already exists|duplicate/i.test(error.message ?? "") ? "done" : "retry";
}
