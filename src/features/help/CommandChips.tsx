import { Keys } from "../../components/ui/Keys";
import type { FeatureCommand } from "../../domain/features";

/** A feature's shortcuts and tokens as chips. Palette commands are found by name, so they're left out. */
export function CommandChips({ commands }: { commands: FeatureCommand[] }) {
  const chips = commands.flatMap((c) =>
    c.kind === "keys" ? [{ text: c.keys, title: c.text, token: false }] : c.kind === "token" ? [{ text: c.token, title: c.text, token: true }] : [],
  );
  if (!chips.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {chips.map((c) =>
        c.token ? (
          <span key={c.text} title={c.title} className="token">
            {c.text}
          </span>
        ) : (
          <Keys key={c.text} keys={c.text} title={c.title} />
        ),
      )}
    </div>
  );
}
