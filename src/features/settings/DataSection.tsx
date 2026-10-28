import { CalendarPlus, Download, Upload } from "lucide-react";
import { useEffect, useState } from "react";
import { Logo } from "../../components/Logo";
import { isTauri } from "../../db/client";
import { exportBackup, importIcs, pickFile, readBackup, restoreBackup } from "../../db/backup";
import { ACCENT_PRESETS } from "../../domain/color";
import { confirm, toast } from "../../stores/ui";

const btn = "flex h-9 items-center gap-2 rounded-sm border border-border px-3 text-sm hover:bg-hover disabled:opacity-50";

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

  const importIt = run(async () => {
    const path = await pickFile("json", "Momentum backup");
    if (!path) return;
    const r = await readBackup(path);
    if (!r.ok) return toast(r.error);
    const d = r.data;
    const summary = `${d.tasks.length} tasks, ${d.lists.length - 1} lists, ${d.events.length} events, ${d.habits.length} habits, ${d.countdowns.length} countdowns${r.dropped ? ` (${r.dropped} unreadable rows skipped)` : ""}.`;
    if (!(await confirm("Replace all data with this backup?", `${summary} Everything currently in Momentum is replaced. A copy of the current database is saved first.`, "Replace"))) return;
    const snapshot = await restoreBackup(d);
    toast(`Backup restored. Previous data saved to ${snapshot}`);
  });

  const icsIt = run(async () => {
    const path = await pickFile("ics", "Calendar file");
    if (!path) return;
    const { count, skipped } = await importIcs(path, ACCENT_PRESETS[1].hex);
    toast(`Imported ${count} event${count === 1 ? "" : "s"}${skipped ? `, skipped ${skipped}` : ""}. They're read-only; re-importing the same file updates them.`);
  });

  return (
    <div className="space-y-3">
      {!isTauri && <p className="text-xs text-muted">Backups and imports work in the desktop app.</p>}
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={!isTauri || busy} onClick={exportIt} className={btn}>
          <Download size={15} /> Export backup (.json)
        </button>
        <button type="button" disabled={!isTauri || busy} onClick={importIt} className={btn}>
          <Upload size={15} /> Restore from backup
        </button>
        <button type="button" disabled={!isTauri || busy} onClick={icsIt} className={btn}>
          <CalendarPlus size={15} /> Import calendar (.ics)
        </button>
      </div>
      <p className="text-xs text-muted">
        Everything lives on this computer in <span className="font-mono">%APPDATA%\com.momentum.planner</span>. The database is copied to its <span className="font-mono">backups</span> folder automatically before every upgrade.
      </p>
    </div>
  );
}

export function AboutSection() {
  const [version, setVersion] = useState("0.1.0");
  useEffect(() => {
    if (!isTauri) return;
    void import("@tauri-apps/api/app").then(({ getVersion }) => getVersion().then(setVersion));
  }, []);
  return (
    <div className="flex items-center gap-4">
      <Logo size={48} />
      <div>
        <div className="text-base font-semibold">Momentum</div>
        <div className="font-mono text-xs text-muted">Version {version}</div>
        <div className="mt-1 text-xs text-fg-2">An offline planner for tasks, calendar, habits and focus. Your data never leaves this device. MIT licensed.</div>
        <div className="mt-1 text-xs text-muted">Created by prpiece and d1.</div>
      </div>
    </div>
  );
}
