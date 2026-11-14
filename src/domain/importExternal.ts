import type { ImportPlan } from "./importPlan";
import { parseTickTick } from "./importTickTick";
import { parseTodoist } from "./importTodoist";

export type ImportSource = "todoist" | "ticktick";
export type ImportResult = { ok: true; source: ImportSource; plan: ImportPlan } | { ok: false; error: string };

/**
 * Detect an export's format from its content and parse it. `name` (the file name without extension) names the
 * list of a Todoist per-project CSV. A system boundary: never throws, an unknown or broken file is an error message.
 */
export function parseExternalImport(text: string, name = "Todoist"): ImportResult {
  try {
    const head = text.replace(/^﻿/, "").trimStart();
    if (head.startsWith("{") || head.startsWith("[")) {
      const plan = parseTodoist(head, name);
      return plan ? { ok: true, source: "todoist", plan } : { ok: false, error: "That JSON isn't a Todoist backup with tasks in it." };
    }
    if (/^"?Folder Name"?\s*,/im.test(head)) {
      const plan = parseTickTick(head);
      return plan ? { ok: true, source: "ticktick", plan } : { ok: false, error: "That TickTick file has no readable tasks." };
    }
    if (/^"?TYPE"?\s*,\s*"?CONTENT"?/im.test(head)) {
      const plan = parseTodoist(head, name);
      return plan ? { ok: true, source: "todoist", plan } : { ok: false, error: "That Todoist file has no readable tasks." };
    }
    return { ok: false, error: "This doesn't look like a Todoist (CSV or JSON) or TickTick (CSV) export." };
  } catch {
    return { ok: false, error: "That file couldn't be read as a Todoist or TickTick export." };
  }
}
