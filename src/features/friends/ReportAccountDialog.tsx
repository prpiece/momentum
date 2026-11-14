import { useState } from "react";
import { Button, Dialog } from "../../components/ui/Dialog";
import { isMac } from "../../lib/platform";
import * as api from "../../lib/sync/social";
import { useAppVersion } from "../../lib/updater";
import { toast } from "../../stores/toast";

const platform = isMac ? "macos" : /Linux/.test(navigator.userAgent) ? "linux" : "windows";

/** A short report about an account; reviewed by hand (D258). */
export function ReportAccountDialog({ friend, onClose }: { friend: api.Friend; onClose: () => void }) {
  const version = useAppVersion();
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);

  const send = async () => {
    setBusy(true);
    try {
      await api.reportAccount(friend.id, body.trim(), version ?? "unknown", platform);
      toast("Report sent. Thank you.");
      onClose();
    } catch (e) {
      toast(e instanceof api.SocialError ? e.message : "Couldn't send the report.");
      setBusy(false);
    }
  };

  return (
    <Dialog label="Report account" onClose={onClose} width="max-w-md">
      <form
        className="space-y-4 p-6"
        onSubmit={(e) => {
          e.preventDefault();
          if (body.trim()) void send();
        }}
      >
        <div>
          <h2 className="text-lg font-semibold">Report @{friend.handle}</h2>
          <p className="mt-0.5 text-[length:var(--fs-sm)] text-muted">Tell us what happened in a sentence or two. We read every report.</p>
        </div>
        <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={4} maxLength={1000} aria-label="What happened" className="input h-auto py-2" />
        <div className="flex justify-end gap-2 border-t border-border pt-4">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" disabled={!body.trim() || busy}>
            Send report
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
