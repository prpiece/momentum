import { hhmm, scheduleDate } from "./dates";
import { PRIORITY_LABEL, type Task } from "./types";

/** RFC 4180 CSV → rows of cells. Handles quotes, doubled quotes, embedded newlines, CRLF and a BOM. Never throws. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const s = text.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c !== '"') cell += c;
      else if (s[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = false;
    } else if (c === '"' && cell === "") quoted = true;
    else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

/** A cell: quoted when it needs it, and a leading = + - @ is defused so a spreadsheet won't run it as a formula. */
const cell = (v: string) => {
  const t = /^[=+\-@]/.test(v) ? `'${v}` : v;
  return /[",\r\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
};

/** Live tasks as RFC 4180 CSV (DATA-14), one row per task, a repeating task once with its rule. */
export function tasksToCsv(tasks: Task[], listName: (id: string) => string, tagName: (id: string) => string): string {
  const head = ["Title", "List", "Status", "Priority", "Date", "Time", "Deadline", "Repeat", "Tags", "Description", "Completed"];
  const rows = tasks
    .filter((t) => !t.deletedAt)
    .map((t) => [
      t.title,
      listName(t.listId),
      t.status,
      PRIORITY_LABEL[t.priority],
      t.schedule.kind === "someday" ? "someday" : (scheduleDate(t.schedule) ?? ""),
      t.schedule.kind === "timed" ? hhmm(new Date(t.schedule.start)) : "",
      t.deadline ?? "",
      t.recurrence?.rule ?? "",
      t.tags.map(tagName).join(";"),
      t.description,
      t.completedAt ?? "",
    ]);
  return `﻿${[head, ...rows].map((r) => r.map(cell).join(",")).join("\r\n")}\r\n`;
}
