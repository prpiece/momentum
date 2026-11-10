import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { isTauri } from "../db/client";
import { attachmentRefs, staleAttachments } from "../domain/attachments";

/**
 * Images kept in the app's config dir (D78 attachments). Rust validates every
 * folder/name/size (src-tauri/src/files.rs); the webview reads them through the asset protocol.
 */
export type ImageFolder = "attachments" | "backgrounds";
export type StoredImage = { name: string; modified: number };

export const IMAGE_EXTS = ["png", "jpg", "jpeg", "gif", "webp"] as const;
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

const dirs: Partial<Record<ImageFolder, Promise<string>>> = {};
const dirOf = (kind: ImageFolder) => (dirs[kind] ??= invoke<string>("image_dir", { kind }));

/** `<uuid>.<ext>` for a new image; the extension comes from the MIME type or the source name. */
export function newImageName(source: string): string | null {
  const raw = (source.includes("/") && !source.includes(".") ? source.split("/")[1] : source.split(".").pop()) ?? "";
  const ext = raw.toLowerCase() === "jpeg" ? "jpg" : raw.toLowerCase();
  return (IMAGE_EXTS as readonly string[]).includes(ext) ? `${crypto.randomUUID()}.${ext}` : null;
}

export const importImage = (kind: ImageFolder, name: string, src: string) => invoke<void>("import_image", { kind, name, src });
// ponytail: bytes travel as a JSON number array (fine up to the 10 MB cap); switch to a raw IPC body if pasting big images feels slow.
export const writeImage = async (kind: ImageFolder, name: string, data: Blob) =>
  invoke<void>("write_image", { kind, name, bytes: Array.from(new Uint8Array(await data.arrayBuffer())) });
export const listImages = async (kind: ImageFolder): Promise<StoredImage[]> =>
  (await invoke<[string, number][]>("list_images", { kind })).map(([name, modified]) => ({ name, modified }));
export const deleteImage = (kind: ImageFolder, name: string) => invoke<void>("delete_image", { kind, name });

/** URL the webview can load; null in the browser build (no files there). */
export async function imageUrl(kind: ImageFolder, name: string): Promise<string | null> {
  if (!isTauri) return null;
  const dir = await dirOf(kind);
  return convertFileSrc(`${dir}${dir.includes("\\") ? "\\" : "/"}${name}`);
}

/** Startup cleanup: delete attachments no note references, once a day old (D78, D100: the day keeps an image pasted but not yet saved). */
export async function sweepAttachments(descriptions: Iterable<string>): Promise<void> {
  if (!isTauri) return;
  const refs = attachmentRefs(descriptions);
  for (const name of staleAttachments(await listImages("attachments"), refs, Date.now() / 1000, 1)) await deleteImage("attachments", name);
}
