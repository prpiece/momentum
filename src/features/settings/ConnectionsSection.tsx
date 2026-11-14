import { useCallback, useEffect, useState } from "react";
import { useSync } from "../../lib/sync/engine";
import * as api from "../../lib/sync/social";
import { toast } from "../../stores/toast";
import { confirm } from "../../stores/ui";
import { openSettingsPage } from "../../stores/settings";
import { copyText } from "../friends/attempt";
import { useNow } from "../focus/FocusView";

const CODE_MS = 10 * 60_000;
const SOURCE: Record<api.Connection["source"], string> = { discord: "Discord", slack: "Slack", telegram: "Telegram" };

const fail = (e: unknown, fallback: string) => toast(e instanceof api.SocialError ? e.message : fallback);

function LinkChat({ onLinked }: { onLinked: () => void }) {
  const [code, setCode] = useState<{ value: string; until: number } | null>(null);
  const now = useNow(code !== null);
  const left = code ? Math.max(0, code.until - now) : 0;

  // A linked chat shows up shortly after the code is used; check every few seconds while it's valid.
  useEffect(() => {
    if (!code || left <= 0) return;
    const id = setInterval(onLinked, 5000);
    return () => clearInterval(id);
  }, [code, left <= 0, onLinked]);

  const make = async () => {
    try {
      setCode({ value: await api.createLinkCode(), until: Date.now() + CODE_MS });
    } catch (e) {
      fail(e, "Couldn't make a code.");
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium">Link a chat</span>
        <button type="button" className="btn btn-secondary" onClick={() => void make()}>
          {code && left > 0 ? "New code" : "Get a code"}
        </button>
      </div>
      {code && left > 0 ? (
        <div className="flex items-center gap-4">
          <span className="text-[length:var(--fs-xl)] font-semibold tabular-nums tracking-widest" aria-label={`Code ${code.value.split("").join(" ")}`}>
            {code.value}
          </span>
          <span className="text-[length:var(--fs-sm)] tabular-nums text-muted">
            expires in {Math.floor(left / 60_000)}:{String(Math.floor((left % 60_000) / 1000)).padStart(2, "0")}
          </span>
        </div>
      ) : (
        code && <p className="text-[length:var(--fs-sm)] text-muted">That code expired. Get a new one.</p>
      )}
      <ul className="space-y-1 text-[length:var(--fs-sm)] text-muted">
        <li>
          Discord: <code>/task link {code?.value ?? "123456"}</code>
        </li>
        <li>
          Slack: <code>/momentum link {code?.value ?? "123456"}</code>
        </li>
        <li>
          Telegram: send <code>link {code?.value ?? "123456"}</code> to the bot
        </li>
      </ul>
    </div>
  );
}

function Chat({ c, onChange }: { c: api.Connection; onChange: () => void }) {
  const setDigest = async (time: string | null) => {
    try {
      await api.setDigest(c.id, time);
      onChange();
    } catch (e) {
      fail(e, "Couldn't change the Digest.");
    }
  };
  const remove = async () => {
    if (!(await confirm(`Remove ${SOURCE[c.source]}${c.label ? ` · ${c.label}` : ""}?`, "The chat stops adding tasks and sending its Digest. Link it again any time.", "Remove"))) return;
    try {
      await api.removeConnection(c.id);
      onChange();
    } catch (e) {
      fail(e, "Couldn't remove it.");
    }
  };
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2">
      <span className="min-w-0 flex-1">
        <b className="font-medium">{SOURCE[c.source]}</b>
        {c.label && <span className="ml-2 text-muted">{c.label}</span>}
      </span>
      <label className="flex items-center gap-2 text-[length:var(--fs-sm)] text-muted">
        Digest
        <input type="time" aria-label={`Digest time for ${SOURCE[c.source]}`} value={c.digestTime ?? ""} onChange={(e) => e.target.value && void setDigest(e.target.value)} className="input w-auto tabular-nums" />
      </label>
      {c.digestTime && (
        <button type="button" className="btn btn-ghost" onClick={() => void setDigest(null)}>
          Digest off
        </button>
      )}
      <button type="button" className="btn btn-ghost text-danger" onClick={() => void remove()}>
        Remove
      </button>
    </li>
  );
}

function Webhook() {
  const [has, setHas] = useState<boolean | null>(null);
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    api.hasWebhook().then(setHas, () => setHas(null));
  }, []);

  const create = async () => {
    if (has && !(await confirm("Make a new webhook URL?", "The old URL stops working right away.", "Make new"))) return;
    try {
      const u = api.webhookUrl(await api.createWebhook());
      setUrl(u);
      setHas(true);
      toast((await copyText(u)) ? "Webhook URL copied. It's shown only once." : "Webhook made. Copy it now; it's shown only once.");
    } catch (e) {
      fail(e, "Couldn't make a webhook.");
    }
  };
  const remove = async () => {
    if (!(await confirm("Delete the webhook?", "Anything posting to it stops adding tasks.", "Delete"))) return;
    try {
      await api.deleteWebhook();
      setHas(false);
      setUrl(null);
    } catch (e) {
      fail(e, "Couldn't delete it.");
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium">Webhook</span>
        <span className="flex items-center gap-2">
          {has && (
            <button type="button" className="btn btn-ghost text-danger" onClick={() => void remove()}>
              Delete
            </button>
          )}
          <button type="button" className="btn btn-secondary" onClick={() => void create()}>
            {has ? "Make a new URL" : "Create webhook"}
          </button>
        </span>
      </div>
      {url && (
        <div className="flex items-center gap-2">
          <input readOnly aria-label="Webhook URL" value={url} onFocus={(e) => e.currentTarget.select()} className="input min-w-0 flex-1 tabular-nums" />
          <button type="button" className="btn btn-secondary" onClick={() => void copyText(url).then((ok) => toast(ok ? "Copied." : "Select the URL and copy it."))}>
            Copy
          </button>
        </div>
      )}
      <p className="text-[length:var(--fs-sm)] text-muted">Anything that can post to a URL can add a task to your Inbox. The URL is a secret: keep it private.</p>
      <pre className="overflow-x-auto rounded-control bg-surface-2 px-3 py-2 text-[length:var(--fs-xs)]">{`curl -X POST ${url ?? "<your webhook URL>"} -H "Content-Type: application/json" -d '{"text":"Buy milk tomorrow"}'`}</pre>
    </div>
  );
}

/** Settings → Connections: chats that add tasks and send a Digest, and a private webhook (D263, ADR 0008). */
export function ConnectionsSection() {
  const account = useSync((s) => s.account);
  const [chats, setChats] = useState<api.Connection[]>([]);
  const load = useCallback(() => {
    if (account) api.myConnections().then(setChats, () => undefined);
  }, [account]);
  useEffect(load, [load]);

  if (!account)
    return (
      <div className="space-y-3">
        <p className="text-fg-2">Connections need an account. Sign in to link Discord, Slack or Telegram, or to make a webhook.</p>
        <button type="button" className="btn btn-secondary" onClick={() => openSettingsPage("settings-account")}>
          Go to Account
        </button>
      </div>
    );

  return (
    <>
      <LinkChat onLinked={load} />
      <div>
        <span className="font-medium">Linked chats</span>
        {chats.length ? (
          <ul className="mt-1 divide-y divide-border">
            {chats.map((c) => (
              <Chat key={c.id} c={c} onChange={load} />
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-[length:var(--fs-sm)] text-muted">No chats linked yet.</p>
        )}
      </div>
      <Webhook />
      {/* Track B: <AgentsPanel /> and <CalendarSubscriptionsPanel /> mount here after v1.3 merges */}
    </>
  );
}
