import { useEffect, useState } from "react";
import { Button, Dialog } from "../../components/ui/Dialog";
import { isMac } from "../../lib/platform";
import { reportProblem, sendReport, SCREENSHOT_TYPES, type Screenshot } from "../../lib/sync/report";
import { supabase, syncConfigured } from "../../lib/sync/supabase";
import { useAppVersion } from "../../lib/updater";
import { toast } from "../../stores/ui";

const platform = isMac ? "macos" : /Linux/.test(navigator.userAgent) ? "linux" : "windows";

/** Settings → Help → Report a problem: name, email, description and an optional screenshot go to the developers. */
export function ReportDialog({ onClose }: { onClose: () => void }) {
  const version = useAppVersion();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [body, setBody] = useState("");
  const [shot, setShot] = useState<Screenshot | null>(null);
  const [state, setState] = useState<"form" | "sending" | "sent">("form");

  // A signed-in account's email is a good default (read from the local session, no network).
  useEffect(() => {
    if (!syncConfigured) return;
    void supabase.auth.getSession().then(({ data }) => setEmail((e) => e || data.session?.user.email || ""));
  }, []);

  const report = () => ({ name, email, body, appVersion: version ?? "unknown", platform, screenshot: shot });
  const invalid = reportProblem(report());

  const pick = async (file: File | undefined) => {
    if (!file) return;
    const next: Screenshot = { name: file.name, type: file.type, bytes: await file.arrayBuffer() };
    const err = reportProblem({ ...report(), screenshot: next });
    if (err && /screenshot/.test(err)) return toast(err);
    setShot(next);
  };

  const send = async () => {
    setState("sending");
    const error = await sendReport(report());
    if (error) {
      setState("form");
      return toast(error);
    }
    setState("sent");
  };

  return (
    <Dialog onClose={onClose} label="Report a problem" width="max-w-lg">
      {state === "sent" ? (
        <div className="space-y-4 p-5">
          <h2 className="text-[length:var(--fs-lg)] font-semibold">Report sent</h2>
          <p className="text-fg-2">Thanks. We'll reply to {email.trim()} if we need more detail.</p>
          <div className="flex justify-end">
            <Button variant="primary" onClick={onClose}>Close</Button>
          </div>
        </div>
      ) : (
        <form
          className="space-y-3 p-5"
          onSubmit={(e) => {
            e.preventDefault();
            if (!invalid && state === "form") void send();
          }}
        >
          <h2 className="text-[length:var(--fs-lg)] font-semibold">Report a problem</h2>
          <input className="input w-full" value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name (optional)" aria-label="Name" maxLength={100} autoComplete="name" />
          <input className="input w-full" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email, so we can reply" aria-label="Email" autoComplete="email" />
          <textarea className="input min-h-32 w-full py-2" value={body} onChange={(e) => setBody(e.target.value)} placeholder="What happened? What did you expect?" aria-label="Description" maxLength={5000} />
          <div className="flex flex-wrap items-center gap-3 text-[length:var(--fs-sm)]">
            <label className="btn btn-secondary cursor-pointer focus-within:ring-2 focus-within:ring-accent-text">
              {shot ? "Replace screenshot…" : "Add a screenshot…"}
              <input type="file" accept={SCREENSHOT_TYPES.join(",")} className="sr-only" onChange={(e) => void pick(e.target.files?.[0])} />
            </label>
            {shot && (
              <>
                <span className="min-w-0 truncate text-fg-2">{shot.name}</span>
                <button type="button" className="text-accent-text hover:underline" onClick={() => setShot(null)}>Remove</button>
              </>
            )}
          </div>
          <p className="text-[length:var(--fs-sm)] text-muted">Sent with your app version ({version ?? "unknown"}) and system ({platform}). Needs an internet connection.</p>
          <div className="flex items-center justify-end gap-2">
            {state === "sending" && <span className="mr-1 inline-block size-4 animate-spin rounded-full border-2 border-border-strong border-t-accent-text" role="status" aria-label="Sending" />}
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" type="submit" disabled={!!invalid || state === "sending"} title={invalid ?? undefined}>
              {state === "sending" ? "Sending…" : "Send report"}
            </Button>
          </div>
        </form>
      )}
    </Dialog>
  );
}
