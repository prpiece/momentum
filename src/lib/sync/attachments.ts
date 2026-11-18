/*
 * Note images through Supabase Storage (PLAN D291). Each image a note references goes up once to
 * `attachments/notes/<file>`; the server lets every account that can see a referencing task read it.
 * A device missing an image downloads it. Shared with the phone: each app passes its own file access.
 */
import { attachmentRefs, imageType, isAttachmentName, MAX_IMAGE_BYTES, toUpload, uploadOutcome } from "../../domain/attachments";
import { setLocalState, state, useSync } from "./engine";
import { supabase } from "./supabase";

const bucket = () => supabase.storage.from("attachments");
const remote = (name: string) => `notes/${name}`;
/** Names this device has settled with the server (uploaded, or downloaded from it), per account. */
const settledKey = (account: string) => `attachments_settled:${account}`;

async function readSettled(account: string): Promise<Set<string>> {
  try {
    const v: unknown = JSON.parse((await state(settledKey(account))) ?? "[]");
    return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  } catch {
    return new Set(); // a bad list costs one duplicate upload per image, which the server refuses
  }
}

export type LocalImages = { list(): Promise<string[]>; read(name: string): Promise<Blob> };

let uploading = false;
/**
 * Uploads the referenced note images this device holds that aren't settled yet. Runs after a push (the
 * referencing task must be on the server first), in the background, one at a time; a failed one is
 * retried on the next sync, and a re-upload of a name already there counts as done.
 */
export async function uploadNoteImages(files: LocalImages, descriptions: Iterable<string>): Promise<void> {
  const account = useSync.getState().account;
  if (uploading || !account) return;
  uploading = true;
  try {
    const refs = attachmentRefs(descriptions);
    const settled = await readSettled(account);
    const size = settled.size;
    // Names no note references any more drop out, so the list stays the size of the notes.
    for (const n of settled) if (!refs.has(n)) settled.delete(n);
    let changed = settled.size !== size;
    for (const name of toUpload(refs, await files.list(), settled)) {
      try {
        const blob = await files.read(name);
        const type = imageType(name);
        const ok = blob.size > MAX_IMAGE_BYTES || !type ? "done" : uploadOutcome((await bucket().upload(remote(name), blob, { contentType: type, upsert: false })).error);
        if (ok === "done") settled.add(name), (changed = true);
      } catch (err) {
        console.warn(`Note image ${name} didn't upload; retrying next sync`, err);
      }
    }
    if (changed) await setLocalState(settledKey(account), JSON.stringify([...settled]));
  } finally {
    uploading = false;
  }
}

/** A note image from the server; null when signed out, offline, or no task this account sees references it. */
export async function downloadNoteImage(name: string): Promise<Blob | null> {
  const account = useSync.getState().account;
  if (!account || !isAttachmentName(name) || !imageType(name)) return null;
  const { data, error } = await bucket().download(remote(name));
  if (error || !data || data.size > MAX_IMAGE_BYTES) return null;
  // Came from the server, so this device needn't upload it back.
  const settled = await readSettled(account);
  settled.add(name);
  await setLocalState(settledKey(account), JSON.stringify([...settled]));
  return data;
}

/** A one-hour URL for a note image, for the phone, which shows it without keeping a file. */
export async function noteImageUrl(name: string): Promise<string | null> {
  if (!useSync.getState().account || !isAttachmentName(name) || !imageType(name)) return null;
  const { data, error } = await bucket().createSignedUrl(remote(name), 3600);
  return error ? null : (data?.signedUrl ?? null);
}
