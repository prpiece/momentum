import { SocialError } from "../../lib/sync/social";
import { act } from "../../stores/social";
import { toast } from "../../stores/toast";

/** Runs a social action, refreshes, and shows a server error as a toast. Resolves false when it failed. */
export async function attempt(fn: () => Promise<unknown>, pull = false): Promise<boolean> {
  try {
    await act(fn, pull);
    return true;
  } catch (e) {
    toast(e instanceof SocialError ? e.message : `Couldn't finish that${e instanceof Error && e.message ? `: ${e.message}` : "."}`);
    return false;
  }
}

/** The name to show for a person: their display name, else their @handle. */
export const who = (p: { handle: string; displayName: string | null }) => (p.displayName ? `${p.displayName} (@${p.handle})` : `@${p.handle}`);

/** Copies text; false when the clipboard isn't available. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
