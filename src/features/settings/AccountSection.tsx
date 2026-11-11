import { useEffect, useState } from "react";
import { loadAccount, saveHandle, sendCode, statusText, verifyCode, type Device, type Profile } from "../../lib/sync/account";
import { signOut, syncNow, useSync } from "../../lib/sync/engine";
import { syncConfigured } from "../../lib/sync/supabase";
import { SiteLink } from "./SiteLink";
import { confirm, toast } from "../../stores/ui";

const btn = "btn btn-secondary";

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
    const error = await sendCode(email);
    setBusy(false);
    if (error) return toast(error);
    setSent(true);
  };

  const verify = async () => {
    setBusy(true);
    const { message } = await verifyCode(email, code, () =>
      confirm(
        "Add this device's data to your account?",
        "The data here belongs to another account. Add it to the account you're signing in to, or remove it from this device (a backup is kept).",
        "Add it",
      ),
    );
    setBusy(false);
    toast(message);
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
    void loadAccount(account).then((a) => {
      if (!live) return;
      setEmail(a.email);
      setProfile(a.profile);
      setDevices(a.devices);
      setMe(a.me);
    });
    return () => void (live = false);
  }, [account, status.kind]);

  const saveProfile = async () => {
    const res = await saveHandle(account, handle, name);
    if (!res.ok) return toast(res.message);
    setProfile(res.profile);
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
            <label className="input-wrap w-48 gap-0.5">
              <span className="text-muted" aria-hidden>
                @
              </span>
              <input value={handle} onChange={(e) => setHandle(e.target.value.replace(/^\s*@+/, ""))} placeholder="handle" aria-label="Handle" autoCapitalize="none" autoCorrect="off" spellCheck={false} />
            </label>
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
