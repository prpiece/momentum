/*
 * "Report a problem" (PLAN D232 batch), shared by the desktop dialog and the phone screen: validates the
 * form, uploads an optional screenshot to the insert-only `reports` bucket, then inserts the row.
 * Needs a network and the Supabase project, but not an account. Returns an error message, or null when sent.
 */
import { supabase, syncConfigured } from "./supabase";

export const SCREENSHOT_MAX = 5 * 1024 * 1024;
export const SCREENSHOT_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;
export type Screenshot = { name: string; type: string; bytes: ArrayBuffer | Uint8Array };
export type Report = { name: string; email: string; body: string; appVersion: string; platform: string; screenshot: Screenshot | null };

/** The first thing wrong with the form, or null. The server checks the same limits. */
export function reportProblem(r: Report): string | null {
  if (r.name.trim().length > 100) return "That name is too long.";
  if (!/^[^@\s]+@[^@\s]+$/.test(r.email.trim()) || r.email.trim().length > 254) return "Enter an email address so we can reply.";
  const n = r.body.trim().length;
  if (n < 10) return "Describe the problem in at least a few words.";
  if (n > 5000) return "The description is too long (5000 characters at most).";
  const s = r.screenshot;
  if (s && !(SCREENSHOT_TYPES as readonly string[]).includes(s.type)) return "The screenshot must be a PNG, JPEG, WebP or GIF image.";
  if (s && s.bytes.byteLength > SCREENSHOT_MAX) return "The screenshot is over 5 MB.";
  return null;
}

export async function sendReport(r: Report): Promise<string | null> {
  const invalid = reportProblem(r);
  if (invalid) return invalid;
  if (!syncConfigured) return "Reports can be sent from the installed app.";
  try {
    const id = crypto.randomUUID();
    let screenshot_path: string | null = null;
    if (r.screenshot) {
      const ext = r.screenshot.type.split("/")[1];
      screenshot_path = `${id}/screenshot.${ext}`;
      const { error } = await supabase.storage.from("reports").upload(screenshot_path, r.screenshot.bytes, { contentType: r.screenshot.type });
      if (error) return `Couldn't upload the screenshot: ${error.message}`;
    }
    const { error } = await supabase.from("reports").insert({ id, name: r.name.trim(), email: r.email.trim(), body: r.body.trim(), app_version: r.appVersion, platform: r.platform, screenshot_path });
    return error ? `Couldn't send the report: ${error.message}` : null;
  } catch {
    return "Couldn't reach the server. Check your connection and try again.";
  }
}
