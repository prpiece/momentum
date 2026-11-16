import { CalendarPlus, Download, FileJson, FileSpreadsheet, ListPlus, Upload } from "lucide-react";
import { useState } from "react";
import { Logo } from "../../components/Logo";
import { isTauri } from "../../db/client";
import { autoBackupSettings, backupNow, exportBackup, importIcs, pickFile, readBackup, restoreBackup, saveAutoBackupSettings } from "../../db/backup";
import { ACCENT_PRESETS } from "../../domain/color";
import { tasksToCsv } from "../../domain/csv";
import { tasksToJson } from "../../domain/export";
import { toIcs } from "../../domain/ics";
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

  /** Ask for a file name, then write `contents()`; returns the path or null when cancelled. */
  const saveText = async (ext: string, base: string, contents: () => string) => {
    const { invoke } = await import("@tauri-apps/api/core");
    const path = await invoke<string | null>("pick_path", { save: true, name: ext.toUpperCase(), extensions: [ext], defaultName: `${base}-${new Date().toISOString().slice(0, 10)}.${ext}` });
    if (path) await invoke("write_text_file", { path, contents: contents() });
    return path;
  };

  const csvIt = run(async () => {
    const { lists, tags, tasks } = useData.getState();
    const all = Object.values(tasks);
    const path = await saveText("csv", "momentum-tasks", () => tasksToCsv(all, (id) => lists[id]?.name ?? "", (id) => tags[id]?.name ?? id));
    if (path) toast(`Exported ${all.filter((t) => !t.deletedAt).length} tasks to ${path}`);
  });

  const jsonIt = run(async () => {
    const { lists, tags, tasks, events } = useData.getState();
    const path = await saveText("json", "momentum-tasks", () => tasksToJson(Object.values(tasks), Object.values(lists), (id) => tags[id]?.name ?? id, Object.values(events)));
    if (path) toast(`Exported tasks and lists to ${path}`);
  });

  const icsOut = run(async () => {
    const { tasks, events } = useData.getState();
    const path = await saveText("ics", "momentum-calendar", () => toIcs(Object.values(tasks), Object.values(events)));
    if (path) toast(`Exported dated tasks and your events to ${path}`);
  });

  const [auto, setAuto] = useState(autoBackupSettings);
  const changeAuto = (next: typeof auto) => (saveAutoBackupSettings(next), setAuto(next));
  const backupIt = run(async () => {
    const path = await backupNow();
    setAuto(autoBackupSettings());
    toast(`Backup saved to ${path}`);
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
        <button type="button" disabled={!isTauri || busy} onClick={jsonIt} className={btn}>
          <FileJson size={15} /> Export tasks (.json)
        </button>
        <button type="button" disabled={!isTauri || busy} onClick={icsOut} className={btn}>
          <CalendarPlus size={15} /> Export calendar (.ics)
        </button>
        <button type="button" disabled={!isTauri || busy} onClick={importIt} className={btn}>
          <Upload size={15} /> Restore from backup
        </button>
        <button type="button" disabled={!isTauri || busy} onClick={icsIt} className={btn}>
          <CalendarPlus size={15} /> Import calendar (.ics)
        </button>
        <button type="button" disabled={!isTauri || busy} onClick={() => void startExternalImport()} className={btn}>
          <ListPlus size={15} /> Import from another app
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <label className="flex items-center gap-2">
          <input type="checkbox" disabled={!isTauri} checked={auto.on} onChange={(e) => changeAuto({ ...auto, on: e.target.checked })} />
          Back up automatically every day
        </label>
        <label className="flex items-center gap-2 text-fg-2">
          Keep
          <input type="number" min={1} max={60} disabled={!isTauri} value={auto.keep} onChange={(e) => changeAuto({ ...auto, keep: Math.min(60, Math.max(1, Math.floor(Number(e.target.value)) || 1)) })} className="input w-16 tabular-nums" aria-label="Automatic backups to keep" />
        </label>
        <button type="button" disabled={!isTauri || busy} onClick={backupIt} className={btn}>
          Back up now
        </button>
        <span className="text-xs text-muted tabular-nums">{auto.last ? `Last backup ${new Date(auto.last).toLocaleString()}` : "No automatic backup yet"}</span>
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
