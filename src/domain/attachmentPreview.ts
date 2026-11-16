/** How a stored attachment can be previewed in the app (FEAT-25). Images keep their own lightbox. */
export type PreviewKind = "pdf" | "text" | "image" | null;

const EXT = (name: string) => name.slice(name.lastIndexOf(".") + 1).toLowerCase();

export function previewKind(name: string): PreviewKind {
  const e = EXT(name);
  if (e === "pdf") return "pdf";
  if (e === "txt") return "text";
  return ["png", "jpg", "jpeg", "gif", "webp"].includes(e) ? "image" : null;
}

/** A text preview shows at most this many characters; a bigger file is cut and says so. */
export const MAX_TEXT_PREVIEW = 200_000;
export const clipText = (s: string): { text: string; cut: boolean } => (s.length > MAX_TEXT_PREVIEW ? { text: s.slice(0, MAX_TEXT_PREVIEW), cut: true } : { text: s, cut: false });
