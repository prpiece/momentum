import { formatDistanceToNow } from "date-fns";
import { RefreshCw, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { ColorField } from "../../components/ui/ColorField";
import { isTauri } from "../../db/client";
import { ACCENT_PRESETS } from "../../domain/color";
import { feedHost } from "../../domain/subscriptions";
import { addSubscription, refreshAll, refreshSubscription, removeSubscription, updateSubscription, useSubscriptions } from "../../stores/subscriptions";
import { confirm } from "../../stores/ui";

const HELP: [string, string][] = [
  ["Google Calendar", "Settings → your calendar → Secret address in iCal format"],
  ["Outlook", "Settings → Calendar → Shared calendars → Publish a calendar → ICS link"],
  ["iCloud", "Share the calendar and turn on Public Calendar, then copy the link"],
  ["Proton, Fastmail", "Share the calendar as a link and copy the .ics address"],
];

function Row({ id }: { id: string }) {
  const sub = useSubscriptions((s) => s.subs[id]);
  const st = useSubscriptions((s) => s.status[id]);
  const [open, setOpen] = useState(false);
  if (!sub) return null;
  const color = sub.color ?? ACCENT_PRESETS[1].hex;
  return (
    <li className="space-y-2 py-2.5">
      <div className="flex items-center gap-3">
        <button type="button" aria-expanded={open} aria-label={`Edit ${sub.name}`} onClick={() => setOpen(!open)} className="size-5 shrink-0 rounded-full" style={{ background: color }} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{sub.name}</div>
          <div className={`truncate text-xs ${st?.error ? "text-danger" : "text-muted"}`} role="status">
            {st?.busy ? "Refreshing…" : st?.error ? st.error : st?.at ? `${feedHost(sub.url)} · refreshed ${formatDistanceToNow(new Date(st.at), { addSuffix: true })}` : `${feedHost(sub.url)} · not refreshed yet`}
          </div>
        </div>
        {isTauri && (
          <button type="button" disabled={st?.busy} onClick={() => void refreshSubscription(id)} className="btn btn-secondary" aria-label={`Refresh ${sub.name}`}>
            <RefreshCw size={15} className={st?.busy ? "animate-spin" : ""} />
          </button>
        )}
        <button
          type="button"
          className="btn btn-secondary"
          aria-label={`Remove ${sub.name}`}
          onClick={async () => {
            if (await confirm(`Remove ${sub.name}?`, "Its events disappear from Momentum (and your phone). The calendar itself isn't touched.", "Remove")) removeSubscription(id);
          }}
        >
          <Trash2 size={15} />
        </button>
      </div>
      {open && (
        <div className="space-y-2 pl-8">
          <input className="input w-full" aria-label="Name" maxLength={80} defaultValue={sub.name} onBlur={(e) => void updateSubscription(id, { name: e.target.value })} />
          <ColorField value={color} onChange={(hex) => void updateSubscription(id, { color: hex })} />
        </div>
      )}
    </li>
  );
}

/** Calendar subscriptions (v1.3): read-only calendars that follow an .ics address. */
export function SubscriptionsPanel() {
  const subs = useSubscriptions((s) => s.subs);
  const ids = useMemo(() => Object.values(subs).sort((a, b) => a.sortOrder - b.sortOrder).map((s) => s.id), [subs]);
  const [url, setUrl] = useState("");
  const [color, setColor] = useState<string>(ACCENT_PRESETS[2].hex);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const add = async () => {
    if (busy || !url.trim()) return;
    setBusy(true);
    setError(null);
    const err = await addSubscription(url, "", color);
    setBusy(false);
    if (err) setError(err);
    else setUrl("");
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted">Follow a calendar from anywhere. Its events appear here and on your phone, read-only, and refresh every 30 minutes while Momentum is open.</p>
      {ids.length > 0 && (
        <>
          <ul className="divide-y divide-border">{ids.map((id) => <Row key={id} id={id} />)}</ul>
          {isTauri && (
            <button type="button" className="btn btn-secondary" onClick={() => void refreshAll()}>
              <RefreshCw size={15} /> Refresh all now
            </button>
          )}
        </>
      )}
      <form
        className="space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          void add();
        }}
      >
        <div className="flex gap-2">
          <input className="input min-w-0 flex-1" aria-label="Calendar address" placeholder="Paste a calendar address (https:// or webcal://)" value={url} onChange={(e) => setUrl(e.target.value)} disabled={!isTauri} spellCheck={false} autoComplete="off" />
          <button type="submit" className="btn btn-secondary" disabled={!isTauri || busy || !url.trim()}>
            {busy ? "Adding…" : "Add"}
          </button>
        </div>
        <ColorField value={color} onChange={setColor} />
        {error && <p className="text-xs text-danger" role="alert">{error}</p>}
        {!isTauri && <p className="text-xs text-muted">Calendar subscriptions work in the desktop app.</p>}
      </form>
      <details className="text-xs text-muted">
        <summary className="cursor-pointer">Where do I find the address?</summary>
        <ul className="mt-1.5 space-y-1">
          {HELP.map(([who, how]) => (
            <li key={who}>
              <span className="font-medium text-fg-2">{who}:</span> {how}
            </li>
          ))}
        </ul>
        <p className="mt-1.5">Treat the address like a password: anyone with it can read that calendar.</p>
      </details>
    </div>
  );
}
