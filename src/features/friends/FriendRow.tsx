import { Ban, Flag, MoreHorizontal, UserMinus, UserPlus } from "lucide-react";
import { useState } from "react";
import * as api from "../../lib/sync/social";
import { toast } from "../../stores/toast";
import { confirm, openMenuAt, type MenuEntry } from "../../stores/ui";
import { InviteToShareDialog } from "./InviteToShareDialog";
import { ReportAccountDialog } from "./ReportAccountDialog";
import { attempt } from "./attempt";

/** One friend (or a request you sent) with its menu: invite to a share, remove, block, report. */
export function FriendRow({ friend: f }: { friend: api.Friend }) {
  const [dialog, setDialog] = useState<"invite" | "report" | null>(null);
  const name = f.displayName || `@${f.handle}`;
  const waiting = f.status === "pending";

  const items = (): MenuEntry[] => [
    ...(waiting ? [] : [{ label: "Invite to a share…", icon: <UserPlus size={14} />, run: () => setDialog("invite") }]),
    ...(waiting ? [] : ["sep" as const]),
    {
      label: waiting ? "Cancel request" : "Remove friend",
      icon: <UserMinus size={14} />,
      run: async () => {
        if (waiting || (await confirm(`Remove ${name}?`, "You stop being friends. Lists you share stay shared until someone leaves.", "Remove"))) void attempt(() => api.removeFriend(f.id));
      },
    },
    {
      label: "Block",
      icon: <Ban size={14} />,
      danger: true,
      run: async () => {
        if (await confirm(`Block ${name}?`, "This ends the friendship and cancels requests both ways, and you stop seeing each other in search. Shares aren't touched.", "Block")) {
          if (await attempt(() => api.blockAccount(f.id))) toast(`Blocked ${name}.`);
        }
      },
    },
    { label: "Report…", icon: <Flag size={14} />, danger: true, run: () => setDialog("report") },
  ];

  return (
    <li className="group/nav relative flex min-h-[var(--row)] items-center gap-3 px-3.5">
      <span aria-hidden className="grid size-7 shrink-0 place-items-center rounded-full bg-accent-soft text-[length:var(--fs-sm)] font-semibold uppercase">
        {(f.displayName || f.handle).slice(0, 1)}
      </span>
      <span className="min-w-0 flex-1 truncate">
        <b className="font-medium">{f.displayName || `@${f.handle}`}</b>
        {f.displayName && <span className="ml-2 text-muted">@{f.handle}</span>}
      </span>
      {waiting && <span className="text-[length:var(--fs-sm)] text-muted">Requested</span>}
      <button type="button" aria-label={`Options for ${name}`} onClick={(e) => openMenuAt(e.currentTarget, items())} className="btn btn-ghost icon-btn size-8 text-muted">
        <MoreHorizontal size={16} />
      </button>
      {dialog === "invite" && <InviteToShareDialog friend={f} onClose={() => setDialog(null)} />}
      {dialog === "report" && <ReportAccountDialog friend={f} onClose={() => setDialog(null)} />}
    </li>
  );
}
