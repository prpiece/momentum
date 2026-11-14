import { pickFile, readTextFile } from "../../db/backup";
import { isTauri } from "../../db/client";
import { parseExternalImport } from "../../domain/importExternal";
import { setExternalImport, setImport, toast } from "../../stores/ui";

/** Pick a Todoist or TickTick export, parse it and open the preview. Desktop only (it reads a file from disk). */
export async function startExternalImport() {
  setImport(false);
  if (!isTauri) return toast("Importing from Todoist or TickTick works in the desktop app.");
  try {
    const path = await pickFile(["csv", "json"], "Todoist or TickTick export");
    if (!path) return;
    const name = (path.split(/[\\/]/).pop() ?? "").replace(/\.[^.]*$/, "");
    const r = parseExternalImport(await readTextFile(path), name);
    if (r.ok) setExternalImport({ source: r.source, plan: r.plan });
    else toast(r.error);
  } catch (err) {
    console.error(err);
    toast(`Couldn't read that file: ${err instanceof Error ? err.message : String(err)}`);
  }
}
