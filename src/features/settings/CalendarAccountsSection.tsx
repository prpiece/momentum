import { useCallback, useEffect, useRef, useState } from "react";
import { failureText } from "../../domain/serverStatus";
import type { CalProvider } from "../../domain/types";
import { openExternal } from "../../lib/links";
import * as api from "../../lib/sync/calendar";
import { toast } from "../../stores/toast";
import { confirm } from "../../stores/ui";

const NAME: Record<CalProvider, string> = { google: "Google Calendar", microsoft: "Outlook" };
const BLURB: Record<CalProvider, string> = {
  google: "Your Google events show in Momentum and can be edited here.",
  microsoft: "Your Outlook and Microsoft 365 events show in Momentum and can be edited here.",
};

const message = (e: unknown) => (e instanceof Error ? { message: e.message } : null);

function Account({ p, a, onChange, onConnecting }: { p: CalProvider; a: api.CalendarAccount | undefined; onChange: () => void; onConnecting: () => void }) {
  const [busy, setBusy] = useState(false);
  const [keep, setKeep] = useState(false);
  const run = async (what: string, fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      onChange();
    } catch (e) {
      toast(failureText(what, message(e)));
    } finally {
      setBusy(false);
    }
  };

  const connect = () => run(`connect ${NAME[p]}`, async () => {
    await openExternal(await api.connectUrl(p));
    onConnecting();
    toast("Finish in your browser, then come back here.");
  });
  const choose = (sync: string[], write: string | null) => run("save the calendars", () => api.chooseCalendars(p, sync, write));
  const syncNow = () => run(`sync ${NAME[p]}`, async () => {
    const r = await api.syncCalendars();
    const err = r.find((x) => x.provider === p)?.error;
    toast(err ?? `${NAME[p]} is up to date.`);
  });
  const disconnect = async () => {
    const body = keep ? "Its events stay in Momentum as your own events and stop syncing." : "Its events leave Momentum on every device. They stay in your calendar.";
    if (!(await confirm(`Disconnect ${NAME[p]}?`, body, "Disconnect"))) return;
    await run(`disconnect ${NAME[p]}`, () => api.disconnectCalendar(p, keep));
  };

  if (!a)
    return (
      <li className="flex flex-wrap items-center justify-between gap-2 py-3">
        <div className="min-w-0">
          <div className="font-medium">{NAME[p]}</div>
          <p className="text-[length:var(--fs-sm)] text-muted">{BLURB[p]}</p>
        </div>
        <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => void connect()}>
          Connect
        </button>
      </li>
    );

  const synced = a.calendars.filter((c) => c.sync).map((c) => c.id);
  const toggle = (id: string, on: boolean) => void choose(on ? [...synced, id] : synced.filter((x) => x !== id), a.writeCalendarId);
  const writable = a.calendars.filter((c) => c.canEdit);
  return (
    <li className="space-y-3 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="font-medium">{NAME[p]}</div>
          <p className="truncate text-[length:var(--fs-sm)] text-muted">
            {a.email ? `Connected as ${a.email}` : "Connected"}
            {a.lastSync && <span className="tabular-nums"> · synced {new Date(a.lastSync).toLocaleString()}</span>}
          </p>
        </div>
        <span className="flex gap-2">
          <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => void syncNow()}>
            Sync now
          </button>
          <button type="button" className="btn btn-ghost text-danger" disabled={busy} onClick={() => void disconnect()}>
            Disconnect
          </button>
        </span>
      </div>
      {a.error && (
        <p role="alert" className="text-[length:var(--fs-sm)] text-danger">
          {a.error}
          {a.error.startsWith("Reconnect") && (
            <button type="button" className="btn btn-ghost ml-2" disabled={busy} onClick={() => void connect()}>
              Reconnect
            </button>
          )}
        </p>
      )}
      <fieldset className="space-y-1">
        <legend className="t-label mb-1">Show in Momentum</legend>
        {a.calendars.map((c) => (
          <label key={c.id} className="flex items-center gap-2 text-[length:var(--fs-sm)]">
            <input type="checkbox" className="size-4 accent-[var(--accent)]" disabled={busy} checked={c.sync} onChange={(e) => toggle(c.id, e.target.checked)} />
            <span className="size-2.5 shrink-0 rounded-full" style={{ background: c.color ?? "var(--accent)" }} aria-hidden="true" />
            <span className="min-w-0 truncate">{c.name}</span>
            {!c.canEdit && <span className="text-muted">(read-only)</span>}
          </label>
        ))}
      </fieldset>
      <label className="flex flex-wrap items-center gap-2 text-[length:var(--fs-sm)] text-fg-2">
        New Momentum events go to
        <select
          aria-label={`Calendar for new events in ${NAME[p]}`}
          className="input w-auto"
          disabled={busy}
          value={a.writeCalendarId ?? ""}
          onChange={(e) => void choose(synced, e.target.value || null)}
        >
          <option value="">Momentum only</option>
          {writable.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      {p === "microsoft" && a.writeCalendarId && <p className="text-[length:var(--fs-sm)] text-muted">Repeating events stay in Momentum; Outlook gets single events.</p>}
      <label className="flex items-center gap-2 text-[length:var(--fs-sm)] text-fg-2">
        <input type="checkbox" className="size-4 accent-[var(--accent)]" checked={keep} onChange={(e) => setKeep(e.target.checked)} />
        Keep its events in Momentum if I disconnect
      </label>
    </li>
  );
}

/** Settings → Connections: two-way Google Calendar and Outlook (FEAT-01, D345). Connecting happens on desktop; the phone shows the events. */
export function CalendarAccountsSection() {
  const [accounts, setAccounts] = useState<api.CalendarAccount[] | null>(null);
  const [connecting, setConnecting] = useState(false);
  const load = useCallback(() => {
    api.calendarAccounts().then(setAccounts, () => setAccounts((a) => a ?? []));
  }, []);
  useEffect(load, [load]);
  // Back from the browser's consent screen: reload on every focus until the new connection shows (or 10 minutes pass).
  const before = useRef(0);
  useEffect(() => {
    if (!connecting) return;
    window.addEventListener("focus", load);
    const stop = setTimeout(() => setConnecting(false), 10 * 60_000);
    return () => (window.removeEventListener("focus", load), clearTimeout(stop));
  }, [connecting, load]);
  useEffect(() => {
    if (connecting && accounts && accounts.length > before.current) setConnecting(false);
  }, [connecting, accounts]);

  return (
    <div>
      <span className="font-medium">Calendars</span>
      <p className="text-[length:var(--fs-sm)] text-muted">
        Momentum&apos;s server keeps the connection and syncs every 10 minutes, and right after you change an event here. It stores an encrypted access grant, never your password.
      </p>
      <ul className="divide-y divide-border">
        {(["google", "microsoft"] as const).map((p) => (
          <Account key={p} p={p} a={accounts?.find((a) => a.provider === p)} onChange={load} onConnecting={() => ((before.current = accounts?.length ?? 0), setConnecting(true))} />
        ))}
      </ul>
    </div>
  );
}
