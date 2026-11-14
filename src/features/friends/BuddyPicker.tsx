import { Switch } from "../../components/ui/Switch";
import { useMemo } from "react";
import { useSync } from "../../lib/sync/engine";
import { useSocial } from "../../stores/social";

/** In a habit's settings: friends who see its name and today's check-in, and whether they may nudge (D260). */
export function BuddyPicker({ buddies, nudges, onChange }: { buddies: string[]; nudges: boolean; onChange: (buddies: string[], nudges: boolean) => void }) {
  const account = useSync((s) => s.account);
  const all = useSocial((s) => s.friends);
  const friends = useMemo(() => all.filter((f) => f.status === "accepted"), [all]);
  if (!account) return null;
  return (
    <fieldset>
      <legend className="mb-1.5 t-label text-muted">Check-in buddies</legend>
      {friends.length === 0 ? (
        <p className="text-[length:var(--fs-sm)] text-muted">Add friends first. A buddy sees this habit's name and today's check-in, nothing else.</p>
      ) : (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-1.5">
            {friends.map((f) => {
              const on = buddies.includes(f.id);
              return (
                <button
                  key={f.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => onChange(on ? buddies.filter((x) => x !== f.id) : [...buddies, f.id], nudges)}
                  className={`h-8 rounded-control px-2.5 text-xs ${on ? "bg-accent text-accent-fg" : "bg-surface-2 text-fg-2"}`}
                >
                  @{f.handle}
                </button>
              );
            })}
          </div>
          {buddies.length > 0 && (
            <label className="flex items-center gap-2.5 text-[length:var(--fs-sm)] text-fg-2">
              <Switch checked={nudges} onChange={(v) => onChange(buddies, v)} label="Allow nudges" />
              Allow nudges (at most one a day)
            </label>
          )}
        </div>
      )}
    </fieldset>
  );
}
