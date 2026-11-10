import { useEffect, useState } from "react";
import { deviceId, enableSync, signInSituation, signOut, syncNow, useSync, wipeLocal, type SyncStatus } from "../../lib/sync/engine";
import { supabase, syncConfigured } from "../../lib/sync/supabase";
import { SiteLink } from "./SiteLink";
import { confirm, toast } from "../../stores/ui";

const btn = "btn btn-secondary";
const HANDLE = /^[a-z0-9_]{3,20}$/;

type Profile = { handle: string | null; display_name: string | null };
type Device = { id: string; platform: string | null; last_seen: string };

/** Settings → Account (v1.1): email-code sign-in, handle, sync status, devices, sign-out. */
export function AccountSection() {
  const account = useSync((s) => s.account);
  if (!syncConfigured) return <p className="text-muted">Accounts and sync work in the desktop app.</p>;
  return account ? <SignedIn account={account} /> : <SignIn />;
}

function SignIn() {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);

  const send = async () => {
    setBusy(true);
    const { error } = await supabase.auth.signInWithOtp({ email: email.trim(), options: { shouldCreateUser: true } });
    setBusy(false);
    if (error) return toast(`Couldn't send the code: ${error.message}`);
    setSent(true);
  };

  const verify = async () => {
    setBusy(true);
    try {
      const { data, error } = await supabase.auth.verifyOtp({ email: email.trim(), token: code.trim(), type: "email" });
      if (error || !data.user) return toast(error ? `That code didn't work: ${error.message}` : "That code didn't work.");
      const uid = data.user.id;
      const situation = await signInSituation(uid);
      if (situation === "otherAccount") {
        const add = await confirm(
          "Add this device's data to your account?",
          "The data here belongs to another account. Add it to the account you're signing in to, or remove it from this device (a backup is kept).",
          "Add it",
        );
        if (!add) await wipeLocal();
      }
      const { counts } = await enableSync(uid, situation === "resume" ? "resume" : "fresh");
      const total = Object.values(counts).reduce((a, b) => a + (b ?? 0), 0);
      toast(situation === "resume" ? "Signed in. Sync is back on." : `Signed in. Added ${counts.tasks ?? 0} tasks, ${counts.lists ?? 0} lists and ${counts.habits ?? 0} habits (${total} items) to your account.`);
    } catch (err) {
      console.error(err);
      toast(`Sign-in failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-fg-2">Sign in to keep your tasks, habits and settings in step on every device. Without an account, Momentum keeps working exactly as before.</p>
      {!sent ? (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (agreed && email.includes("@")) void send();
          }}
        >
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" aria-label="Email" className="input w-full max-w-sm" autoComplete="email" />
          <label className="flex items-start gap-2 text-[length:var(--fs-sm)] text-fg-2">
            <input type="checkbox" className="mt-0.5 size-4 accent-[var(--accent)]" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
            <span>
              I'm 13 or older and I accept the <SiteLink page="terms.html">Terms</SiteLink> and the <SiteLink page="privacy.html">Privacy policy</SiteLink>.
            </span>
          </label>
          <button type="submit" disabled={busy || !agreed || !email.includes("@")} className="btn btn-primary">
            Email me a code
          </button>
        </form>
      ) : (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (/^\d{6}$/.test(code.trim())) void verify();
          }}
        >
          <p className="text-[length:var(--fs-sm)] text-fg-2">We sent a 6-digit code to {email.trim()}.</p>
          <input inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="123456" aria-label="Code" className="input w-40 tabular-nums" />
          <div className="flex gap-2">
            <button type="submit" disabled={busy || !/^\d{6}$/.test(code.trim())} className="btn btn-primary">
              Sign in
            </button>
            <button type="button" disabled={busy} onClick={() => setSent(false)} className={btn}>
              Use another email
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

function statusText(s: SyncStatus): string {
  switch (s.kind) {
    case "off":
      return "Sync is off.";
    case "syncing":
      return "Syncing…";
    case "offline":
      return "Offline. Changes sync when you're back online.";
    case "updateRequired":
      return "Update Momentum to keep syncing. Everything still works on this device.";
    case "error":
      return `Sync failed: ${s.message}`;
    case "idle":
      return s.at ? `Synced at ${new Date(s.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.` : "Ready to sync.";
  }
}

function SignedIn({ account }: { account: string }) {
  const status = useSync((s) => s.status);
  const issues = useSync((s) => s.issues);
  const [email, setEmail] = useState<string | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [devices, setDevices] = useState<Device[]>([]);
  const [me, setMe] = useState<string | null>(null);
  const [leaving, setLeaving] = useState<null | "here" | "everywhere">(null);
  const [handle, setHandle] = useState("");
  const [name, setName] = useState("");

  useEffect(() => {
    let live = true;
    void (async () => {
      const [{ data: user }, { data: p }, { data: d }, id] = await Promise.all([
        supabase.auth.getUser(),
        supabase.from("profiles").select("handle, display_name").eq("id", account).maybeSingle(),
        supabase.from("devices").select("id, platform, last_seen").order("last_seen", { ascending: false }),
        deviceId(),
      ]);
      if (!live) return;
      setEmail(user.user?.email ?? null);
      setProfile((p as Profile | null) ?? { handle: null, display_name: null });
      setDevices((d as Device[] | null) ?? []);
      setMe(id);
    })();
    return () => void (live = false);
  }, [account, status.kind]);

  const saveProfile = async () => {
    const h = handle.trim().toLowerCase();
    if (!HANDLE.test(h)) return toast("A handle is 3–20 letters, digits or _.");
    const row = { id: account, handle: h, display_name: name.trim() || h };
    const { error } = await supabase.from("profiles").upsert(row);
    if (error) return toast(/reserved/.test(error.message) ? "That handle is reserved." : /duplicate|unique/i.test(error.message) ? "That handle is taken." : error.message);
    setProfile({ handle: row.handle, display_name: row.display_name });
  };

  const leave = async (how: "keep" | "remove") => {
    const everywhere = leaving === "everywhere";
    setLeaving(null);
    await signOut(how, everywhere);
    toast(how === "keep" ? "Signed out. Your data stays on this device." : "Signed out and removed this device's data. A backup was kept.");
  };

  return (
    <div className="space-y-4">
      {profile && !profile.handle ? (
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            void saveProfile();
          }}
        >
          <p className="font-medium">Choose your handle</p>
          <p className="text-[length:var(--fs-sm)] text-fg-2">Friends will find you by it later. You can change it once every 30 days.</p>
          <div className="flex flex-wrap gap-2">
            <input value={handle} onChange={(e) => setHandle(e.target.value)} placeholder="handle" aria-label="Handle" className="input w-48" />
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Display name" aria-label="Display name" className="input w-48" />
            <button type="submit" className="btn btn-primary">
              Save
            </button>
          </div>
        </form>
      ) : (
        <div>
          <p className="font-medium">{profile?.display_name ?? "…"}</p>
          <p className="text-[length:var(--fs-sm)] text-fg-2">
            {profile?.handle ? `@${profile.handle} · ` : ""}
            {email}
          </p>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-fg-2" aria-live="polite">
          {statusText(status)}
        </span>
        <button type="button" disabled={status.kind === "syncing"} onClick={() => void syncNow()} className={btn}>
          Sync now
        </button>
      </div>

      {devices.length > 0 && (
        <div>
          <p className="t-label mb-1 text-muted">Signed-in devices</p>
          <ul className="space-y-1 text-[length:var(--fs-sm)] text-fg-2">
            {devices.map((d) => (
              <li key={d.id} className="tabular-nums">
                {d.platform ?? "Device"}
                {d.id === me ? " (this device)" : ` · last seen ${new Date(d.last_seen).toLocaleString()}`}
              </li>
            ))}
          </ul>
        </div>
      )}

      {issues.length > 0 && (
        <div>
          <p className="t-label mb-1 text-muted">Sync issues</p>
          <ul className="space-y-1 text-[length:var(--fs-sm)] text-fg-2">
            {issues.slice(0, 10).map((i, n) => (
              <li key={n}>
                {new Date(i.at).toLocaleString()}: a change to {i.tbl.replace(/_/g, " ")} wasn't synced ({i.reason}).
              </li>
            ))}
          </ul>
        </div>
      )}

      {leaving ? (
        <div className="space-y-2">
          <p className="font-medium">Keep a copy of your data on this device?</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => void leave("keep")} className="btn btn-primary">
              Keep a copy
            </button>
            <button type="button" onClick={() => void leave("remove")} className="btn btn-danger">
              Remove from this device
            </button>
            <button type="button" onClick={() => setLeaving(null)} className={btn}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => setLeaving("here")} className={btn}>
            Sign out
          </button>
          <button type="button" onClick={() => setLeaving("everywhere")} className={btn}>
            Sign out everywhere
          </button>
        </div>
      )}
    </div>
  );
}
