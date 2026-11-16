import { CalendarPlus, Download, FileSpreadsheet, ListPlus, Upload } from "lucide-react";
import { useState } from "react";
import { Logo } from "../../components/Logo";
import { isTauri } from "../../db/client";
import { exportBackup, importIcs, pickFile, readBackup, restoreBackup } from "../../db/backup";
import { ACCENT_PRESETS } from "../../domain/color";
import { tasksToCsv } from "../../domain/csv";
import { useData } from "../../stores/data";
import { dataDirLabel } from "../../lib/platform";
import { useAppVersion } from "../../lib/updater";
import { confirm, toast } from "../../stores/ui";
import { SiteLink } from "./SiteLink";
import { startExternalImport } from "../tasks/startExternalImport";

const btn = "btn btn-secondary";

/** Backup export / restore and one-time .ics import. */
export function DataSection() {
  const [busy, setBusy] = useState(false);
  const run = (fn: () => Promise<void>) => async () => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      console.error(err);
      toast(`Something went wrong: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  const exportIt = run(async () => {
    const path = await exportBackup();
    if (path) toast(`Backup saved to ${path}`);
  });

  const csvIt = run(async () => {
    const { lists, tags, tasks } = useData.getState();
    const { invoke } = await import("@tauri-apps/api/core");
    const path = await invoke<string | null>("pick_path", { save: true, name: "CSV", extensions: ["csv"], defaultName: `momentum-tasks-${new Date().toISOString().slice(0, 10)}.csv` });
    if (!path) return;
    const all = Object.values(tasks);
    await invoke("write_text_file", { path, contents: tasksToCsv(all, (id) => lists[id]?.name ?? "", (id) => tags[id]?.name ?? id) });
    toast(`Exported ${all.filter((t) => !t.deletedAt).length} tasks to ${path}`);
  });

  const importIt = run(async () => {
    const path = await pickFile(["zip", "json"], "Momentum backup");
    if (!path) return;
    const r = await readBackup(path);
    if (!r.ok) return toast(r.error);
    const d = r.data;
    const summary = `${d.tasks.length} tasks, ${d.lists.length - 1} lists, ${d.events.length} events, ${d.habits.length} habits${r.dropped ? ` (${r.dropped} unreadable rows skipped)` : ""}.`;
    if (!(await confirm("Replace all data with this backup?", `${summary} Everything currently in Momentum is replaced. A copy of the current database is saved first.`, "Replace"))) return;
    const snapshot = await restoreBackup(d, path);
    toast(`Backup restored. Previous data saved to ${snapshot}`);
  });

  const icsIt = run(async () => {
    const path = await pickFile(["ics"], "Calendar file");
    if (!path) return;
    const { count, skipped } = await importIcs(path, ACCENT_PRESETS[1].hex);
    toast(`Imported ${count} event${count === 1 ? "" : "s"}${skipped ? `, skipped ${skipped}` : ""}. They're read-only; re-importing the same file updates them.`);
  });

  return (
    <div className="space-y-3">
      {!isTauri && <p className="text-xs text-muted">Backups and imports work in the desktop app.</p>}
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={!isTauri || busy} onClick={exportIt} className={btn}>
          <Download size={15} /> Export backup (.zip)
        </button>
        <button type="button" disabled={!isTauri || busy} onClick={csvIt} className={btn}>
          <FileSpreadsheet size={15} /> Export tasks (.csv)
        </button>
        <button type="button" disabled={!isTauri || busy} onClick={importIt} className={btn}>
          <Upload size={15} /> Restore from backup
        </button>
        <button type="button" disabled={!isTauri || busy} onClick={icsIt} className={btn}>
          <CalendarPlus size={15} /> Import calendar (.ics)
        </button>
        <button type="button" disabled={!isTauri || busy} onClick={() => void startExternalImport()} className={btn}>
          <ListPlus size={15} /> Import from Todoist or TickTick
        </button>
      </div>
      <p className="text-xs text-muted">
        Everything lives on this computer in <span className="tabular-nums">{dataDirLabel}</span>. The database is copied to its <span className="tabular-nums">backups</span> folder automatically before every upgrade.
      </p>
    </div>
  );
}

/**
 * The privacy promise (D268), also in the README. Each line was checked against the code for v1.3:
 * no analytics or crash reporting; the clipboard is only written (copy buttons) or read from a paste
 * you make; Settings → Data → Export holds every task, list, event, subscription, habit and focus
 * session; nothing needs an account; there is no built-in AI, agents come in through `momentum mcp`.
 */
export const PRIVACY_PROMISE = [
  "No telemetry: no analytics, no tracking, no crash reports.",
  "Never reads your clipboard. Only a paste you make goes in.",
  "A full export of everything, any time, in Settings → Data.",
  "Works without an account. Sync is optional.",
  "No AI built in. If you want one, connect your own agent (AI agents).",
  "It goes online only to check for updates, to sync once you sign in, to fetch calendars you subscribe to, to download the voice model if you ask, and to send a problem report you write.",
];

export function AboutSection() {
  const version = useAppVersion() ?? "dev";
  return (
    <div className="flex items-center gap-4">
      <Logo size={48} />
      <div>
        <div className="text-base font-semibold">Momentum</div>
        <div className="tabular-nums text-xs text-muted">Version {version}</div>
        <div className="mt-1 text-xs text-fg-2">An offline planner for tasks, calendar, habits and focus. Your data stays on this device unless you sign in to sync it. MIT licensed.</div>
        <ul className="mt-2 list-disc space-y-0.5 pl-4 text-xs text-fg-2" aria-label="Our privacy promise">
          {PRIVACY_PROMISE.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
        <div className="mt-1 flex gap-3 text-xs">
          <SiteLink page="terms.html">Terms</SiteLink>
          <SiteLink page="privacy.html">Privacy policy</SiteLink>
        </div>
        <div className="mt-1 text-xs text-muted">Created by prpiece and d1.</div>
      </div>
    </div>
  );
}
