import { looksLikeGoogleTasks, parseGoogleTasks } from "./importGoogle";
import type { ImportPlan } from "./importPlan";
import { parseTickTick } from "./importTickTick";
import { parseTodoist } from "./importTodoist";
import { parseVtodo } from "./importVtodo";

export type ImportSource = "todoist" | "ticktick" | "google" | "reminders";
export type ImportResult = { ok: true; source: ImportSource; plan: ImportPlan } | { ok: false; error: string };

/**
 * Detect an export's format from its content and parse it. `name` (the file name without extension) names the
 * list of a Todoist per-project CSV or a Reminders .ics. A system boundary: never throws, an unknown or broken file is an error message.
 * Things and Microsoft To Do have no documented file export; Reminders and Outlook tasks come in as VTODO .ics.
 */
export function parseExternalImport(text: string, name = "Todoist"): ImportResult {
  try {
    const head = text.replace(/^﻿/, "").trimStart();
    if (/^BEGIN:VCALENDAR/i.test(head)) {
      const plan = parseVtodo(head, name);
      return plan ? { ok: true, source: "reminders", plan } : { ok: false, error: "That calendar file has no tasks (VTODO) in it." };
    }
    if (head.startsWith("{") && /"kind"\s*:\s*"tasks#taskList/.test(head)) {
      const json: unknown = JSON.parse(head);
      const plan = looksLikeGoogleTasks(json) ? parseGoogleTasks(json) : null;
      return plan ? { ok: true, source: "google", plan } : { ok: false, error: "That Google Tasks file has no tasks in it." };
    }
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
    return { ok: false, error: "This doesn't look like a Todoist (CSV or JSON), TickTick (CSV), Google Tasks (JSON) or Reminders (.ics) export. Microsoft To Do and Things have no file export: copy their tasks and paste them into Import tasks instead." };
  } catch {
    return { ok: false, error: "That file couldn't be read as an export from Todoist, TickTick, Google Tasks or Reminders." };
  }
}
